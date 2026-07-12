# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

---

# Arkonomy

## Current status (2026-07-12)
- Production live at app.arkonomy.com
- Security audit complete (Items 1–8): CSP headers, session storage hardening, Plaid webhook verification, SW cache audit, logout global scope, Stripe idempotency, input validation, password policy
- **Firebase App Check live** — reCAPTCHA v3 on web; JWKS-based RS256 verification in `_shared/appCheck.ts`; protects ai-chat, get-insights, weekly-report, plaid-sync-transactions; cron/service-role paths bypass check; `callEdgeFunction()` in `src/lib/` injects token automatically
- **Plaid webhook receiver live** — `supabase/functions/plaid-webhook/` deployed; JWT-verified (ES256, not HMAC); handles TRANSACTIONS/SYNC_UPDATES_AVAILABLE (triggers sync_item) and ITEM/ERROR (sets error_code on plaid_items); register URL in Plaid Dashboard: `https://hvnkxxazjfesbxdkzuba.supabase.co/functions/v1/plaid-webhook`
- `plaid_items.error_code` column added (migration 20260625000000) — populated by webhook on ITEM/ERROR, cleared on successful sync; `check-bank-connection` now returns `error_code` for reconnect prompt UI
- CI: Semgrep + dependency-review GitHub Actions added; Dependabot weekly npm updates enabled
- Security: CSP live on app.arkonomy.com — script/connect/frame/manifest-src all locked down
- Security: signOut uses `scope: 'global'` — invalidates all sessions across devices
- **Recurring-payments staleness filter live** — `computeRecurringSummary` (src/utils/recurringSummary.js) excludes merchants whose last charge exceeds an adaptive threshold (2× typical billing interval, floor 45 days) into `possiblyCancelled`; shown read-only in Insights ("Possibly cancelled?" section), excluded from Subscriptions/Regular Payments totals and ai-chat context (single source, no separate fix needed). Verified against real account data: OpenAI (124d stale) and Dental Insurance (236d stale) correctly flagged; Lemonade Insurance (9d, monthly cadence) correctly stayed active.
- **"Ask about subscription" action live in Insights** — search-icon button on each Subscriptions row opens ai-chat with a neutral prompt ("...is it worth keeping, and how would I cancel it if I wanted to?"), not a direct cancel prompt. Regular Payments has no such action by design (rent/insurance/loans aren't one-click cancellable). `findDuplicateSubscriptions()` renders a "Similar service" badge for 2+ *distinct-brand* duplicates in one category (e.g. Netflix+Hulu) — correctly does not fire for same-brand/different-descriptor duplicates, since that's the merchant-alias problem below, not this detector's job.
- **Merchant-alias merge live** — new `merchant_aliases` table (migration `20260711120000`, RLS user-scoped) + `findMerchantAliasCandidates()`/`resolveAlias()` in `recurringSummary.js` let a user confirm that two differently-worded bank descriptions are the same real payment (bank changed its ACH descriptor). Never auto-merged — surfaced as a "Same payment, different name?" section in Insights (renders only when candidates exist), user taps confirm/reject. `computeRecurringSummary` takes an optional `aliasMap` param, resolved transitively via `resolveAlias` so 3+ descriptor chains merge into one canonical key instead of splitting across hops. Confirmed live in prod: Claude.ai/Anthropic.comca ($40→$20/mo), Turbotenant/Sheviakov/RENT:SHEVIAKOV rent (3 variants → one $2,001.50/mo entry), plus a bonus find via the same detector (Progressive Insurance/Prog Select Ins). Regular Payments total dropped from $5,218.62 to $3,116.63/mo once confirmed — ~$2,100/mo of phantom duplication removed.
- **ai-chat prompt hardened** (`buildSystemPrompt()`) — fixed a real structural conflict where RESPONSE FORMULA's "one concrete action, no options" was overriding REGULAR PAYMENTS' "frame as a question, never a verdict" (model was producing directive tone like "canceling it would be a concrete win"); added debt payoff as an explicit PRIORITY ORDER tier (wins the ONE NEXT ACTION slot over cash_risk when `INTEREST CHARGES THIS MONTH > $0`); clarified PRIORITY ORDER decides content, FINANCIAL STATE TIER decides tone only; extended the "don't force it into every reply" carve-out from cash_risk to warning too; added a top-level CONFLICT RESOLUTION convention for future contradictions between sections. Confirmed live: AI now mentions an active duplicate every time it's asked about that merchant, with question-framing tone, not a verdict.
- **Merchant navigation live** — tap a transaction in Dashboard "Recent Transactions" filters Transactions by that merchant (new `merchantFilter` state, exact-match on `description`, chip to clear — mirrors the existing `catFilter` pattern exactly). Scoped to Dashboard only; Insights.jsx rows intentionally left alone (Subscriptions rows already have the "ask about" search icon as their tap target).
- **`recurringDetector.js` deleted — third independent recurring-payment engine found and migrated.** It fed the Home "Upcoming Charges" carousel and Dashboard's Cash Flow Forecast with a 90-day lookback + keyword allow-list + no `merchant_aliases` awareness — same blind spot as the Claude/Anthropic and rent cases, just silently manifesting as a wrong/lapsed projection date instead of a duplicate. Both consumers now use `getUpcomingCharges()`/`getUpcomingCardPayments()` (recurringSummary.js) — credit card payments got their own function since `RECURRING_EXCLUDE` correctly keeps them out of Subscriptions/Regular Payments (not reconsiderable) but Cash Flow Forecast needs them anyway (real cash out the door). Verified live: forecast's upcoming total went from $962 (old detector's inconsistent amount-clustering) to $673.48 — a more accurate number, not just smaller.
- Also this session: removed 2 dead i18n keys (`markets.pro_only_title/body`), archived BACKLOG #8 (App Store compliance checklist) as 5/7 done, verified against actual code rather than commit history.

## Next tasks (priority order)
1. **Apple Developer/Firebase for native push** — blocked, waiting on payment (salary)
2. **Demo account + screenshots** for App Store submission
3. **Port `_shared/recurringDetector.ts` (Deno) to alias-aware logic** — client-side is now on the single source (recurringSummary.js), server-side (`get-insights`, `push-notify`) is still on the old, independent, alias-blind detector. Deno can't import from `src/`, so this needs its own porting pass, not a quick fix.

Not touched recently, still open:
4. **Notification preferences UI** — Settings screen section: frequency selector + email digest content toggles; table `notification_preferences` already exists in Supabase
5. **E2E testing** — Playwright tests for critical flows (auth, bank connection, transaction add)

## Known issues / tech debt
- **ai-chat prompt tech debt (audit 2026-07-11, Low/Medium, not fixed)** — REGULAR PAYMENTS data gated by STATE when PRIORITY ORDER might need it regardless of state; WINS MATTER has no explicit slot in RESPONSE FORMULA's 3-step budget; PROJECTION ILLUSTRATION's "only if user asks" gate vs FINANCIAL STATE TIER's proactive positive-state suggestion; TIME AWARENESS vs positive-state tone (soft tension, no fix needed). Full audit + reasoning in BACKLOG.md tech debt section.
- **`_shared/recurringDetector.ts` (Deno) is now the ONLY remaining independent recurring-payment engine** — a 4th copy of logic that now lives natively in `recurringSummary.js` (client). Used by `get-insights` (`upcomingBills7d`, feeds `cash_risk`) and `push-notify`. Same blind spots as the deleted client-side version: 90-day lookback, keyword allow-list, no `merchant_aliases` awareness, and now also **diverges from the client** on what counts as "recurring" (client no longer requires the same amount-clustering/keyword-allowlist rules). Also still misses genuinely one-time bills (needs ≥2 occurrences) — a first-time bill won't appear in `upcomingBills7d` or trigger `cash_risk`.
- **`weekly-report/index.ts` duplicates the savings-points formula** from `healthScore.js` by hand (Deno can't import from `src/`) — numbers currently match, but a future change to `healthScore.js`'s formula won't propagate to the email report automatically.
- **Health Score has no balance floor** — `calculateHealthScore()` (healthScore.js) only looks at income/spend trend across 4 components, never at actual cash position. Low-balance warning is a bolted-on `cashPositionLow` caption (Insights.jsx, Dashboard.jsx) next to the score, not a factor in the score/color/label itself.
- **`plaid_accounts` balance aggregation mixes `available`/`current` semantics** — `available` is often null for savings accounts at some banks and doesn't include pending the same way `current` does. Summing `available ?? current` per-row across multiple accounts of one user can blend the two semantics into one total. Fine for a single checking account; revisit before real multi-account/multi-bank aggregation.

## Self-improvement protocol
- После любой моей коррекции предложи лаконичное правило и допиши его в подходящую секцию этого файла.
- Формат правила: одно императивное предложение, без обоснования и без примеров, если случай не двусмысленный.
- Перед добавлением правила выполни поиск по файлу — не дублируй, а уточни существующее.
- Держи общий объём CLAUDE.md в пределах 2500 токенов; при превышении объедини пересекающиеся правила и удали устаревшие.
- После фикса бага записывай правило про класс корневой причины, а не про конкретный симптом.

---

## Stack
- React 18 + Vite, plain JavaScript (no TypeScript)
- Supabase (auth, database, edge functions) — project: hvnkxxazjfesbxdkzuba
- Vercel — auto-deploy on push to main
- Plaid — bank integration, transaction sync
- Alpaca Markets — investing, Live API
- Resend — email (planned)

## Project structure
- src/App.jsx — main shell, routing, screen switching
- src/main.jsx — entry point with Error Boundary
- src/utils/helpers.js — shared utilities (fmt, parseDate, cleanMerchantName, etc.)
- src/lib/appCheck.js — Firebase App Check init (reCAPTCHA v3); imported in main.jsx before React
- src/lib/callEdgeFunction.js — unified edge function caller; injects App Check token + auth + apikey; use instead of supabase.functions.invoke() for App-Check-protected functions
- src/hooks/usePlan.js — free/pro plan gating via Supabase profiles table
- src/utils/recurringSummary.js — single source for recurring-payment detection: `computeRecurringSummary` (subscriptions/regularPayments/possiblyCancelled), `getUpcomingCharges`/`getUpcomingCardPayments` (next-charge date projection, feeds the Home carousel + Cash Flow Forecast), `findDuplicateSubscriptions`/`findMerchantAliasCandidates` (merchant_aliases merge). `src/recurringDetector.js` (the old, independent, alias-unaware detector) was deleted 2026-07-12 — both its consumers migrated to this file.
- supabase/functions/ — edge functions (Finnhub market data, ai-chat, etc.)
  - supabase/functions/_shared/appCheck.ts — JWKS-based App Check JWT verification (RS256); skip check for cron/service-role paths
  - supabase/functions/ai-chat/ — AI chat endpoint; version-controlled, deploy via `npx supabase functions deploy ai-chat`
- public/ — PWA manifest, service worker, icons

## Styling conventions
- Inline styles only via the C color object — no CSS files, no Tailwind.
- C is defined at top of App.jsx and passed down as needed.
- No external UI libraries (no MUI, no shadcn).
- Never hardcode hex values — always use the existing C color object.

## Storage conventions
- Chat history uses sessionStorage (key: arkonomy_chat_history) — clears on tab close; never switch to localStorage for this key.

## Coding rules
- One step at a time — show the change, wait for confirmation before proceeding.
- Never rewrite large blocks when a targeted edit suffices.
- Never change auth flow, Supabase schema, or Vercel config without explicit instruction.
- Never add TypeScript, CSS modules, or new dependencies without asking first.
- Keep components in the file where they are used unless explicitly asked to extract.
- When editing a file, re-read it first; never rely on stale context.
- Never add a state variable (e.g. `user`) to a useEffect dependency array to fix a stale closure if that effect calls setState — use a ref instead (assign `ref.current = fn` inline after the function definition, call `ref.current()` inside the effect).
- When comparing a projected date against "today", always compare against midnight of today (`new Date(y, m, d)`), not `new Date()` — intraday timestamps cause same-day events to be treated as past.
- Before committing any new hook (`useState`/`useMemo`/`useEffect`/`useCallback`) in App.jsx, verify it sits above every early `return` in the component — a hook below an early return gets skipped on some renders and called on others, which crashes the whole app via a Rules of Hooks violation. App.jsx has broken production twice in two days from component-structure mistakes like this (a TDZ ordering bug, then this), not from feature logic — check structure, not just the diff, before pushing.
- Before writing any code that touches financial calculations or data already shown somewhere in the app (balances, recurring payments, health score, forecasts), search for existing logic first — grep for the concept, don't assume a fresh implementation is needed. This project has independently reimplemented the same calculation 4+ times: `plaid_accounts` derived-vs-real balance (pre-refactor), `recurringDetector.js` vs `recurringSummary.js` (two "is this recurring" engines, found 2026-07-12), `weekly-report/index.ts` hand-duplicating `healthScore.js`'s savings-points formula, and `_shared/recurringDetector.ts` (Deno) as a still-unfixed 4th copy. Each one silently disagreed with the others in a different, hard-to-notice way (wrong balance, wrong date, wrong subscription total) — this is a mandatory search step, not a one-time reminder.

## Security decisions — DO NOT CHANGE without explicit instruction
- **plaid_items has NO SELECT RLS policy** — intentional. Removed during security audit to prevent `access_token` from being exposed to the client. Never add a SELECT policy back.
- **checkBankConnection() calls `check-bank-connection` edge function** (supabase/functions/check-bank-connection/) — uses service role key server-side, returns `{ connected, institution_name, count, error_code }`. Never revert to direct `.from("plaid_items").select()` in the frontend.
- **App Check verification uses JWKS (not the verifyToken REST API)** — the REST API requires a Google service account OAuth token; without credentials it returns 403 and would block all requests. JWKS fetches Google's public keys and verifies the RS256 JWT directly. Never switch to the REST API approach.
- **App Check bypasses for service-role paths** — `resync_all`, `sync_item` (plaid-sync-transactions), and cron calls (weekly-report) skip App Check because they originate server-side with no browser context. The outer `if (ENVIRONMENT !== 'development')` guard is intentional; verifyAppCheck itself has no dev bypass so the guard must live at each call site.
- **Plaid env vars** — Production approval in progress; do not touch.
- **usePlan.js** — Free/Pro gating is core business logic; never bypass.

## Supabase rules
- Test user UUID: 90eb11c3-c1e9-4241-8362-9e15ce231c33
- Never run destructive migrations without showing the SQL first.
- RLS policies must be verified after any schema change.
- Edge functions deploy via: supabase functions deploy <name>
- Accounts cache key: `arkonomy_accounts_v2` (localStorage, 5min TTL) — only cache non-empty arrays. Bump version suffix to force cache bust when stale data needs clearing.

## Business context
- Free/Pro plan gating is core — never bypass or break usePlan.js logic.
- Plaid Production approval is in progress — do not touch Plaid env vars.
- App URL: app.arkonomy.com | Marketing: arkonomy.com
- Target market: US personal finance, competing with Copilot / Monarch.

## Communication style
- Respond in the same language the user writes in — Russian if they write Russian, English if English.
- Direct and informal — no filler, no apologies, no preamble.
- Provide exact ready-to-use code blocks.
- Ask before making architectural decisions.
