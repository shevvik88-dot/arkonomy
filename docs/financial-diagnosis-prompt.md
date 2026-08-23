# TASK: Financial Diagnosis Feature

## Context

Arkonomy is a personal finance coaching app (Supabase project `hvnkxxazjfesbxdkzuba`).
Existing conventions to respect:
- Color system: champagne gold `#E8C97D` = "coach speaking" (identity/narrative UI only). Ruby `#D64F5E`/`#E4677A` = "action required" (urgency only). Emerald `#2FB37D` = positive values. Background `#12161F`. Text primary `#F5F6F8`. Gold and ruby must NEVER share a UI signal.
- Existing "Today's Lesson" streak feature already generates a daily lesson card — this task extends/replaces its data source, do not break the streak logic.
- Coach voice: serif typography, warm-but-direct tone, already has a system prompt used for AI chat — reuse/extend that voice, don't invent a new persona.
- Test user UUID: `90eb11c3-c1e9-4241-8362-9e15ce231c33`. QA account `Camek88@gmail.com` (no bank connected, 4 seeded transactions) — feature must degrade gracefully with sparse/no transaction data (show an empty/insufficient-data state, never crash or fabricate numbers).
- Use existing Sentry monitoring and PostHog analytics (with privacy masking) conventions for any new edge functions.

## Goal

Build a "Financial Diagnosis" feature: user taps a button, the app analyzes their real financial data, classifies their top 1-3 concrete money problems from a closed taxonomy, explains it in coach voice, and reconfigures daily lessons + home screen priorities around solving those problems. The point is that the user visibly sees the app "doing analysis" and understands the app exists to solve THEIR specific problem, not generic tips.

## Phase 1: Diagnosis Engine (do this PR first, stop and let me review before Phase 2)

### 1a. Database migration

Create `diagnosis_profiles` table:

```sql
create table diagnosis_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  metrics jsonb not null,
  primary_issues text[] not null,
  narrative jsonb not null,
  status text default 'active' check (status in ('active','resolved','stale'))
);

create index on diagnosis_profiles (user_id, status);

-- RLS: users can only read/write their own profile, standard pattern used elsewhere in this project
```

Follow the existing RLS pattern used in other tables in this project — check how other user-scoped tables handle it before writing policies.

### 1b. Edge function: `financial-diagnosis`

Input: `user_id` (from auth context, not client-supplied).

**Step 1 — deterministic metrics (plain code, NOT AI):**

```
monthlyIncomeAvg      = avg monthly income, last 90 days
monthlyExpenseAvg     = avg monthly expense, last 90 days
savingsRate           = (income - expense) / income
emergencyFundMonths   = liquid savings / monthlyExpenseAvg
debts[]               = all debt/credit accounts with balance, APR, min_payment,
                         sorted by APR descending (avalanche method priority)
subscriptionTotal     = sum of detected recurring charges
subscriptionUnusedEstimate = recurring charges with no matching usage signal in 60+ days
trend90d              = spending trend classification (rising/flat/declining vs income)
```

**Step 2 — issue classification (rule-based, NOT AI, must be deterministic/reproducible):**

Closed taxonomy — do not let the AI invent categories outside this list:
- `high_apr_debt` — **CORRECTED 2026-08-22 (real APR not available — no Plaid
  Liabilities product connected, see `BACKLOG.md` and commit `bb748d6`):
  trigger is now `creditUtilizationPct > 30%` (worst single card, reusing
  `get-insights`' existing `creditUtilizationPct` calc — same 30% threshold
  already used in the credit-utilization lesson in `src/utils/lessons.js`).
  Taxonomy KEY stays `high_apr_debt` (frontend/Phase 2 reference it by this
  string), but all user-facing narrative/copy must talk about credit
  utilization % and balance — never mention or imply an APR number. The
  Claude narrative prompt must be told explicitly: no APR claims.**
- `no_emergency_fund` — emergencyFundMonths < 1
- `subscription_leak` — subscriptionUnusedEstimate > $30/mo — **OPEN
  QUESTION 2026-08-22: this app has no usage-tracking signal per merchant
  (a Netflix charge doesn't tell us if Netflix was watched), so
  `subscriptionUnusedEstimate` as literally specified is not computable
  without fabricating data. Not yet decided how to adapt this one —
  candidate is triggering on `subscriptionTotal` (real, already computed by
  `_shared/recurringDetector.ts`'s `computeRecurringSummary()`) crossing
  $30/mo instead, with narrative framed as "you have $X/mo in recurring
  charges, worth a look" rather than claiming anything is unused. Needs a
  decision before Phase 1's classification step is implemented.**
- `overspending` — savingsRate < 0
- `lifestyle_inflation` — income flat/rising but expense rising faster over 90d
- `unstable_income_no_buffer` — high income variance + low emergencyFundMonths
- `no_goal` — no active savings goal AND positive savings rate (money sitting idle)

Score each triggered issue by severity, return top 3 max. If zero issues triggered, return a "healthy" status with encouragement narrative, not an empty state.

**Step 3 — narrative generation (Claude API call):**

Pass `metrics` + `primary_issues` to Claude using the existing coach-voice system prompt (find and reuse it — do not write a new one). Request structured JSON output:

```json
{
  "headline": "1 sentence, references a real number from metrics",
  "problems": [
    {
      "issue": "high_apr_debt",
      "explanation": "2-3 sentences, human, specific, references actual account/numbers",
      "action": "1 concrete recommended action, specific dollar amount or account name"
    }
  ]
}
```

Enforce JSON-only output from Claude (system prompt instructs no preamble/markdown fences), parse defensively, log to Sentry on parse failure, do not crash — fall back to a generic templated narrative built from metrics if the AI call fails.

**Step 4:** Upsert into `diagnosis_profiles`, set status `active`, mark any prior active profile as `stale`.

### 1c. Insufficient-data handling

If user has less than ~14 days of transaction history or no linked accounts, return a distinct response type the frontend can render as "not enough data yet, check back after connecting accounts / a few days of activity" — never fabricate numbers to fill the taxonomy.

### 1d. Frontend: diagnosis flow

- Entry point: button "See what's really going on with my money" (or similar coach-voice copy — not "AI Insights"). **CORRECTED 2026-08-22: "existing home screen context menu" was a wrong assumption — no such component exists.** Exact placement TBD — pending a set of real candidate locations on the actual home screen, to be picked before building this part.
- Analysis screen: sequential status lines while the edge function runs (e.g. "Checking your debt load…", "Looking at subscriptions…", "Comparing income and spending…") — use a short artificial minimum duration per line (~1.2-1.5s) so the steps are visible even if the API responds fast. Use gold for this "coach working" state, per the color system.
- Result screen: headline + up to 3 problem cards, each with the explanation and one action button. Ruby accents only on the action/urgency elements, never on the headline or narrative text.
- On confirmation, write the returned `primary_issues` somewhere the home screen and daily lesson can read them (e.g. a lightweight client-side cache of the active diagnosis_profiles row, refetched on app open).

## Phase 2 (do not start until Phase 1 is reviewed): Daily Lesson Integration

**CORRECTED 2026-08-22 — original wording ("extend the existing daily lesson
edge function") was wrong: there is no daily-lesson edge function.**
`src/utils/lessons.js` is a static, curated, client-side content bank with no
AI call at all ("v1 scope, deliberate... No AI call for personalization").
Revised plan:

- Create a **new** edge function `daily-lesson-v2` that takes an active
  `diagnosis_profiles` row (if any) + yesterday's transactions, and generates
  ONE personalized lesson via Claude (2-3 sentences, references a specific
  transaction from yesterday if relevant, ties it to one of `primary_issues`,
  gives a concrete number or action — not generic advice). Same output shape
  the client already expects from a lesson (title/body/tip).
- Client-side: the "Today's Lesson" card checks for an active
  `diagnosis_profiles` row first — if present, call `daily-lesson-v2`; if
  absent, fall back to the existing static `lessons.js` bank, unchanged.
- Do **not** modify or remove `lessons.js` — it stays as the fallback content
  bank, not replaced.

## Constraints

- Do not touch the existing Alpaca/trading integration or Plaid webhook logic.
- Do not introduce any new npm dependencies without flagging them first.
- All new edge functions must have Sentry error capture matching the pattern used in the other 23 edge functions.
- Follow existing PostHog event naming conventions for any new tracked events (e.g. `diagnosis_started`, `diagnosis_completed`, `diagnosis_action_tapped`).
- Write tests using the existing test-runner subagent conventions before marking Phase 1 done.
- Stop after Phase 1 and summarize what was built, any deviations from this spec, and open questions before proceeding to Phase 2.
