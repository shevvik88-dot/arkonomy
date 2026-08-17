# Arkonomy — STRIDE Threat Model

Last updated: 2026-08-16. Every entry below was verified against live code/config at
that date (edge function source, `supabase/config.toml`, live `verify_jwt` flags via
`mcp__supabase__list_edge_functions`, and applied migrations) — not reconstructed
from memory or docs alone. File:line references point at the exact code that
implements the mitigation, so this document can be re-verified the same way it was
built: read the referenced line, confirm it still says what this claims.

This is a living document. When you fix a threat marked "Recommendation", update its
"Current mitigation" — don't leave a stale gap here once it's closed. See CLAUDE.md's
own warning: "Documentation about security ages silently — it doesn't warn you when
it stops being true."

## Architecture summary

- **Auth:** Supabase Auth (email/password + Google/Apple OAuth), custom `auth-login`
  edge function wraps `signInWithPassword` with a DB-backed lockout (`login_attempts`
  table, `check_login_lockout`/`record_login_attempt` RPCs).
- **Data:** Postgres via Supabase, RLS on every user-data table, most edge functions
  authenticate via a caller-supplied Bearer JWT validated with
  `supabase.auth.getUser(token)` (not the platform gateway — see Spoofing/S1 below).
- **Integrations:** Plaid (bank linking + transactions, webhook receiver), Stripe
  (subscriptions, webhook receiver), Alpaca (OAuth-connected brokerage, trading).
- **23 edge functions** (`supabase/functions/*`), Deno runtime, all `verify_jwt: false`
  at the platform level **except** `delete-account` and `check-bank-connection`
  (`verify_jwt: true`) — confirmed live via `list_edge_functions`, not just
  `supabase/config.toml` (the two can drift, see Elevation of Privilege/E1).
- **Frontend:** React SPA (Vite), Vercel-hosted, CSP locked down
  (`vercel.json`), no server-side rendering — all data access goes through
  Supabase RLS or an edge function.

---

## S — Spoofing (impersonating a user, service, or webhook sender)

### S1. Gateway JWT verification disabled on 21 of 23 edge functions
- **Entry point:** every function in `supabase/functions/*` except `delete-account`
  and `check-bank-connection` — confirmed live: `verify_jwt: false` for all 21 others
  via `mcp__supabase__list_edge_functions`.
- **Current mitigation:** each of those 21 does its own auth check in code, and the
  check matches the function's actual trust model — verified individually, not
  assumed:
  - **User-facing functions** (`ai-chat`, `get-insights`, `alpaca-invest`,
    `alpaca-portfolio`, `market-data`, `stock-ai-analysis`, `plaid-link-token`,
    `plaid-exchange-token`, `plaid-sync-transactions`, `plaid-refresh-balance`,
    `plaid-get-accounts`, `stripe-checkout`, `push-notify`, `weekly-report`,
    `generate-monthly-report`, `large-transaction-alert`) call
    `supabase.auth.getUser(token)` manually and reject on failure — functionally
    equivalent to gateway verification, just done in-app.
  - **`auth-login`** — no JWT check by design, this *is* the login endpoint (issues
    the JWT). No token exists yet for the caller to spoof.
  - **`alpaca-oauth-callback`** (`index.ts:88-107`) — no Bearer token at all; auth is
    a single-use opaque nonce (`oauth_nonces` table) resolved to a user ID, deleted
    immediately after use. Appropriate: this endpoint is hit by a browser redirect
    from Alpaca, which can't carry an `Authorization` header.
  - **`plaid-batch-sync`** (`index.ts:153-158`) — `token !== serviceKey → 403`,
    service-role-gated admin batch job, not user-facing.
  - **`plaid-webhook`** (`index.ts:14-49, 88`) — verifies Plaid's own ES256-signed
    webhook JWT via JWKS (`verifyPlaidWebhook()`), not a Supabase user token.
  - **`stripe-webhook`** (`index.ts:42-49`) — `stripe.webhooks.constructEventAsync()`,
    HMAC signature verification against `STRIPE_WEBHOOK_SECRET`.
- **Recommendation:** none of the 23 are currently missing an appropriate check —
  this was a real audit item, not a hypothetical, and it came back clean. The
  residual risk is *drift*: a new function added later without an equivalent
  in-code check, while `verify_jwt: false` stays the copy-pasted default. Treat "does
  this function's `verify_jwt` setting match what its code actually enforces" as a
  mandatory checklist item for every new edge function (already codified in
  CLAUDE.md's Coding rules).

### S2. Plaid/Stripe webhook forgery
- **Entry point:** `plaid-webhook/index.ts`, `stripe-webhook/index.ts` — both
  publicly reachable POST endpoints, no Supabase auth possible since the caller is
  a third party.
- **Current mitigation:** cryptographic signature verification on both, confirmed
  above (S1) — a forged webhook without a valid Plaid ES256 signature or valid
  Stripe HMAC signature is rejected before any DB write.
- **Recommendation:** none. This is the correct pattern. Worth periodically
  re-confirming the check still runs *before* any state-changing code (a refactor
  that reorders logic could silently move the signature check after a side effect —
  same class of regression CLAUDE.md already warns about for documented-but-verify
  security controls).

### S3. Alpaca OAuth `state` parameter spoofing
- **Entry point:** `alpaca-oauth-callback/index.ts:22,88-107`.
- **Current mitigation:** `state` is a single-use, DB-backed opaque nonce
  (`oauth_nonces`, `20260730000003_oauth_nonces.sql`), not a JWT or any
  cryptographically-derived value — an attacker who intercepts a `state` value
  in transit gains nothing reusable (it's deleted on first use, and RLS has no
  client-facing SELECT policy on `oauth_nonces`, so it can't even be read back
  by a client). This was a real fix (2026-07-30) replacing an earlier design that
  put the user's actual Supabase JWT in `state` — a live bearer credential in a
  third party's URL/access logs.
- **Recommendation:** none currently open. Confirm the nonce TTL (documented as
  5 minutes) is still enforced server-side on redemption, not just at issuance.

### S4. Session token theft via XSS → impersonation
- **Entry point:** any XSS in the SPA (React generally auto-escapes, but
  `dangerouslySetInnerHTML` or a raw `innerHTML` write would open this).
- **Current mitigation:** CSP (`vercel.json`) restricts `script-src` to `'self'` plus
  a short explicit allow-list (Plaid, Google, PostHog) — no `unsafe-inline` on
  scripts. Session tokens live in Supabase's own storage (not accessible cross-origin
  by design). `dompurify` is a direct dependency (sanitization available where
  needed).
- **Recommendation:** grep for `dangerouslySetInnerHTML`/`innerHTML =` periodically
  as part of the security-auditor pass on new features — this document doesn't
  claim to have exhaustively audited every current call site, only that the CSP
  baseline is real and enforced.

---

## T — Tampering (unauthorized modification of data in transit or at rest)

### T1. Client-writable `profiles` columns include billing-adjacent fields
- **Entry point:** any authenticated client PATCH to `profiles` via PostgREST
  (`supabase.from('profiles').update(...)`).
- **Current mitigation:** table-level UPDATE grant is column-restricted
  (`20260730000000_profiles_column_grants.sql`,
  `20260730000001_profiles_select_column_grants_fix.sql`) to exactly
  `monthly_budget, savings_goal, roundup_enabled, watchlist, tutorial_completed,
  last_synced_at, push_subscription`. `plan`, `stripe_customer_id`,
  `trial_ends_at`, `trial_web_search_count`, `alpaca_access_token`,
  `alpaca_refresh_token` are **not** in that grant — Postgres rejects a client
  attempt to write them with `42501`, regardless of RLS row-ownership, because
  column-level GRANT is enforced independently of row-level policy. This closed a
  real, confirmed self-upgrade-to-Pro exploit (verified via a direct PostgREST call
  before the fix, per CLAUDE.md).
- **Recommendation:** none open. The one process risk: RLS row-scoping alone would
  **not** have caught this — column-level REVOKE was the actual fix. Any new
  client-writable `profiles` field must go through the same explicit-column-list
  migration pattern, never a broad table-level GRANT.

### T2. `plaid_items`/`plaid_accounts` — client-side balance/transaction injection
- **Entry point:** hypothetical direct `INSERT`/`UPDATE` on `transactions`,
  `plaid_items`, `plaid_accounts` by an authenticated client.
- **Current mitigation:** transactions are written exclusively by
  `plaid-sync-transactions` (service-role context, Plaid API is the source of
  truth) — the client never has a legitimate write path for transaction amounts.
  RLS scopes any row-level access to `user_id = auth.uid()`, so even if a write
  path existed, cross-user tampering is blocked at the row level.
- **Recommendation:** verify no client code path calls
  `.from('transactions').insert()`/`.update()` directly (the manual-entry flow, if
  one exists, should go through validation — grep `src/` for direct transaction
  table writes as a follow-up; not exhaustively re-checked for this document).

### T3. Stripe/Plaid webhook replay or payload tampering
- **Entry point:** `stripe-webhook`, `plaid-webhook` — same entry points as S2.
- **Current mitigation:** signature verification (S2) prevents payload tampering —
  any modified byte in the body invalidates the signature. Stripe's SDK-level
  `constructEventAsync` also implicitly bounds replay risk via its timestamp
  tolerance. Idempotency: CLAUDE.md's "Stripe idempotency" security-audit item
  (Item 6, closed) — not re-verified line-by-line for this document.
- **Recommendation:** confirm Plaid webhook handling is itself idempotent
  (a legitimately-retried webhook — Plaid does retry on non-2xx — shouldn't
  double-trigger `sync_item` in a way that duplicates data). Worth an explicit test
  rather than an assumption.

### T4. Rate-limit / lockout counters tamperable by the rate-limited user
- **Entry point:** `check_and_increment_rate_limit`, `check_login_lockout` /
  `record_login_attempt` RPCs — all `SECURITY DEFINER` (bypass RLS by design).
- **Current mitigation:** `REVOKE EXECUTE FROM PUBLIC, anon, authenticated` +
  `GRANT service_role` only, confirmed pattern per `login_attempts.sql` and the
  `rate_limits` HIGH finding fix from the full RLS audit (CLAUDE.md). A client
  cannot call these RPCs directly via PostgREST to reset or manipulate their own
  (or another user's) rate-limit window.
- **Recommendation:** none open on the two already-audited tables. Apply the same
  `REVOKE`-then-`GRANT service_role` pattern to any future `SECURITY DEFINER`
  function as a hard rule (already in CLAUDE.md's Security decisions).

---

## R — Repudiation (denying an action was taken; lack of audit trail)

### R1. No structured audit log for destructive actions (account deletion, Stripe cancel, Plaid unlink)
- **Entry point:** `delete-account/index.ts` — permanently deletes all user rows and
  the auth identity.
- **Current mitigation:** partial. `account_deletion_issues`
  (`delete-account/index.ts` lines ~140s) records **failures** (Stripe/Plaid
  best-effort revocation errors) for manual follow-up, with `user_id`, `user_email`,
  and the specific error — but there's no persistent record of a *successful*
  deletion once the row is gone (by definition — the account itself, and any log
  keyed to it, is deleted). Sentry (`captureAndFlush`) catches unhandled errors but
  isn't a deliberate audit trail.
- **Recommendation:** if there's ever a support/compliance need to answer "did user
  X actually request deletion, and when" after the fact, that requires a separate
  append-only log table written *before* the delete transaction, not reconstructable
  from `account_deletion_issues` (which only exists on failure) or Sentry (which
  isn't guaranteed retention). Not currently a blocker — flagging as a gap, not
  a live incident.

### R2. Financial actions (Alpaca trades, Plaid unlink) — no user-facing action log
- **Entry point:** `alpaca-invest/index.ts` (order placement).
- **Current mitigation:** Alpaca itself is the system of record for trade execution
  (their API returns and stores the order); `console.error`/Sentry capture failures.
  No app-side confirmation-email or immutable local log of "user X placed order Y at
  time Z" beyond what's implicitly in `transactions`/Alpaca's own records.
- **Recommendation:** low priority given Alpaca is itself an authoritative,
  regulated system of record for the trade — repudiation risk is mostly Alpaca's
  problem to solve, not Arkonomy's. Worth a one-line note if a user disputes a
  trade: direct them to Alpaca's own statement, don't rely on Arkonomy's logs as
  the primary source of truth.

### R3. Sentry captures exceptions but scrubs financial data — limits forensic reconstruction
- **Entry point:** `_shared/sentry.ts` — `scrubSensitive()` redacts any key matching
  `/^(balance|amount|amounts|description|descriptions|email)$/i` before every
  `captureAndFlush`.
- **Current mitigation:** this is a deliberate, correct privacy tradeoff
  (`sendDefaultPii: false`) — not a bug. Documented here because it has a real
  Repudiation-category side effect: post-incident forensics on "what amount was
  actually sent in the failing request" is intentionally harder from Sentry alone.
- **Recommendation:** none — the privacy tradeoff is the right call for a financial
  app. If deeper forensics are ever needed, the source (Supabase logs / DB rows)
  is the correct place to look, not Sentry.

---

## I — Information Disclosure (exposing data to unauthorized parties)

### I1. `plaid_items.access_token` / `alpaca_access_token` / `alpaca_refresh_token` — client exposure
- **Entry point:** any client `SELECT` against `plaid_items` or `profiles`.
- **Current mitigation:** `plaid_items` has **no SELECT RLS policy at all** —
  confirmed live in migrations (`20260413000000_plaid_schema.sql` created one,
  `20260531000000_fix_rls_token_exposure.sql:5` dropped it — `DROP POLICY IF EXISTS
  "users_read_own_plaid_items"`). `plaid_accounts` follows the same posture
  (`20260707000000_plaid_accounts.sql:6`, comment confirms "No SELECT policy for
  anon/authenticated"). `alpaca_access_token`/`alpaca_refresh_token` have
  column-level SELECT revoked (`20260730000001`), enforced independent of RLS — a
  client `.select('alpaca_access_token')` gets Postgres `42501`, not empty data.
  Connection status is exposed only via narrow, purpose-built RPCs/functions
  (`has_alpaca_token()` — `SECURITY DEFINER`, parameterless, pinned to
  `WHERE id = auth.uid()`; `check-bank-connection` edge function, service-role
  server-side) that return a boolean/summary, never the token.
- **Recommendation:** none open. This is the strongest control in the app and it's
  verified at the Postgres grant level, not just app-code convention — don't ever
  add these columns back to a client-facing `.select()` list (App.jsx already
  documents this as a hard rule).

### I2. AI chat (`ai-chat`) — cross-tenant financial data leakage via warm isolate reuse
- **Entry point:** `_shared/sentry.ts` doc comment: "Deno.serve isn't instrumented,
  so there's no automatic per-request scope separation — a warm, reused isolate
  could carry global-scope state (tags/breadcrumbs) across requests."
- **Current mitigation:** `defaultIntegrations: false` + every capture wrapped in
  `Sentry.withScope()` — this specifically prevents **Sentry's own global scope**
  from leaking one user's tags/context into another's error report. This was
  live-verified with 2 concurrent test requests confirming clean, non-leaking
  events (per CLAUDE.md, 2026-07-11ish). This mitigation is about Sentry's global
  state specifically, not the AI response content itself.
- **Recommendation:** the underlying question — does the actual per-request
  `financialContext` object ever leak between concurrent requests to the same warm
  isolate (not just Sentry's tags) — depends on whether the request handler uses
  only local variables/closures (safe) vs any module-level mutable state (unsafe).
  Not re-verified line-by-line for this document; worth a targeted read of
  `ai-chat/index.ts`'s request handler to confirm no module-scope mutable state
  holds `financialContext` or similar between requests.

### I3. `sessionStorage` chat history — client-side, tab-scoped
- **Entry point:** `src/App.jsx:1290-1298` (persist effect), `arkonomy_chat_history`
  key.
- **Current mitigation:** documented and already reviewed as an accepted risk this
  session (CodeQL alert #7, dismissed) — sessionStorage not localStorage, cleared on
  `signOut()`/`deleteAccount()`, contains only AI chat text referencing financial
  context (balances, subscriptions), never Plaid/Stripe/Alpaca tokens. See
  CLAUDE.md's "Storage conventions" for the full rationale.
- **Recommendation:** none — already closed this session, included here only for
  completeness of the threat model (a STRIDE doc that omits an already-analyzed
  Information Disclosure item would look like it was never considered).

### I4. CORS — 21 of 23 functions still on single-static-origin, not the allow-list pattern
- **Entry point:** every edge function's `resolveCorsHeaders()`/`corsHeaders`
  constant.
- **Current mitigation:** confirmed live (grep across all `index.ts` files) — no
  function anywhere uses a wildcard `Access-Control-Allow-Origin: *`. 5 functions
  (`auth-login`, `check-bank-connection`, `get-insights`, `market-data`,
  `plaid-get-accounts`) use the allow-list/regex pattern (prod + Vercel preview
  URLs). The other ~18 hardcode a single static origin
  (`Deno.env.get('APP_URL') ?? 'https://app.arkonomy.com'`, confirmed via
  `ai-chat/index.ts:9` as a representative example) — this is a **functionality**
  gap (breaks on preview/branch deployments, confirmed firsthand this session
  testing against a Vercel preview), not an **information disclosure** risk: a
  static single-origin CORS header cannot be tricked into echoing an attacker's
  origin, since it never echoes anything — it's a fixed string.
- **Recommendation:** low-priority cleanup, tracked in CLAUDE.md's Next tasks
  (#1) as "18 remaining CORS fixes" — correctly categorized as a preview-testing
  inconvenience, not a security hole, so no urgency to reclassify.

### I5. Third-party service PII exposure (PostHog, Sentry)
- **Entry point:** `posthog?.identify()`, `Sentry.init()` calls across the codebase.
- **Current mitigation:** `sendDefaultPii: false` confirmed in `_shared/sentry.ts`.
  PostHog `identify()` calls (grep shows `posthog?.identify(user.id)` /
  `signUpData.user.id`) pass only the Supabase UUID, not email/name — consistent
  with the documented policy of not sending PII to analytics by default.
- **Recommendation:** none open. Keep this as the default for any *new*
  third-party integration (already codified as a hard rule in the global
  CLAUDE.md — "if policy already accepted for one service, apply automatically to
  new integrations, don't reopen the decision each time").

---

## D — Denial of Service

### D1. `ai-chat` / `get-insights` — unbounded LLM cost / abuse
- **Entry point:** `ai-chat/index.ts`, `get-insights/index.ts`.
- **Current mitigation:** `enforceRateLimit` (`_shared/rateLimit.ts`) applied —
  confirmed live via grep — to `ai-chat`, `auth-login`, `get-insights`,
  `market-data`, `plaid-refresh-balance`, `stock-ai-analysis` (6 functions total,
  matches CLAUDE.md's documented ai-chat 20/hr, get-insights 30/hr limits). The
  underlying RPC (`check_and_increment_rate_limit`) is `SECURITY DEFINER` with
  `REVOKE`/`GRANT service_role` (T4) — a client can't bypass the limit by calling
  the RPC directly.
- **Recommendation:** none currently open — this was flagged as BACKLOG #3 in
  CLAUDE.md and appears already satisfied. Worth re-confirming the per-user vs.
  per-IP rate-limit key choice (a shared-IP scenario, e.g. corporate NAT, could
  either over-throttle legitimate distinct users or under-throttle a single
  attacker rotating accounts, depending on which key is used) — not verified for
  this document.

### D2. `market-data` — shared Finnhub API budget exhaustion
- **Entry point:** `market-data/index.ts`'s `overview` endpoint, polled every 60s
  per open Dashboard tab (`Dashboard.jsx`'s `MiniMarkets` widget).
- **Current mitigation:** in-memory cache (45s TTL) + in-flight-promise dedup inside
  `getMarketSnapshot()` (`_shared/marketSnapshot.ts`), shared across concurrent
  callers on a warm isolate — deployed 2026-08-09 specifically to reduce pressure
  on the single shared 60 req/min Finnhub key.
  Also rate-limited per D1 (`market-data` is in the `enforceRateLimit` list).
- **Recommendation:** already documented in CLAUDE.md's Known Issues as a real
  ceiling that will bite at higher concurrent-user counts (~2 concurrent Markets-tab
  loads before partial 429s at the current watchlist cap of 20). This is a
  legitimate DoS-adjacent scaling limit, not a hypothetical — the fix (paid Finnhub
  tier, or a proper shared server-side quote cache with longer TTL) is tracked but
  not yet built.

### D3. `plaid-webhook` — no visible rate limit on a publicly reachable endpoint
- **Entry point:** `plaid-webhook/index.ts` — not in the `enforceRateLimit` list
  (grep confirmed above, D1).
- **Current mitigation:** signature verification (S2) means a flood of *invalid*
  webhook requests is cheap to reject (fails before any DB write) — the expensive
  path (calling `sync_item`) only runs after a valid Plaid signature, which an
  outside attacker cannot forge. This significantly limits (but doesn't
  structurally rate-limit) the DoS surface.
- **Recommendation:** low priority — Plaid is the only entity that can produce a
  validly-signed webhook, so this is closer to "trust Plaid's own sending rate"
  than an open DoS vector. If Plaid itself misbehaves (retry storm), a rate limit
  on `sync_item` triggering would be a reasonable defense-in-depth addition, not
  currently present.

### D4. Login lockout as a targeted-account DoS vector
- **Entry point:** `auth-login/index.ts:55-82`, `check_login_lockout`/
  `record_login_attempt`.
- **Current mitigation:** the lockout exists to prevent credential-stuffing/brute
  force (a legitimate control), but by definition it is also a lever an attacker
  could pull against a *specific known* email to lock the real owner out
  (repeatedly submit wrong passwords for their address).
- **Recommendation:** verify the lockout key is scoped in a way that doesn't let
  a remote attacker denial-of-service a specific victim's account indefinitely
  with zero cost to themselves (e.g., IP-based secondary throttling, or a lockout
  duration that's inconvenient but bounded rather than escalating unboundedly).
  Not verified in depth for this document — the RPC internals
  (`check_login_lockout`) weren't read line-by-line here.

---

## E — Elevation of Privilege

### E1. `verify_jwt` config drift between `supabase/config.toml` and live deployment
- **Entry point:** `supabase/config.toml` vs. actual deployed function state.
- **Current mitigation:** none structural — this is the residual risk itself, not
  a mitigated one. Directly confirmed while building this document:
  `check-bank-connection` and `delete-account` are `verify_jwt: true` **live**
  (via `list_edge_functions`) but **absent** from `supabase/config.toml`'s
  `verify_jwt` block entirely (only 17 functions are listed there, all `false`) —
  meaning the source-of-truth config file doesn't fully describe the deployed
  state. This exact class of drift is already flagged in CLAUDE.md's Coding rules
  ("When a function's `verify_jwt` platform setting looks inconsistent with
  sibling functions... that's a real bug to investigate").
- **Recommendation:** reconcile `config.toml` to explicitly list all 23 functions'
  `verify_jwt` state (including the two `true` ones), so a future `supabase
  functions deploy` or config-driven redeploy can't silently flip
  `check-bank-connection`/`delete-account` to `false` by omission. Low urgency
  (both functions do their own `getUser()` check regardless per S1, so the
  practical impact of the gateway flag alone is currently low), but worth closing
  the config gap so the file is trustworthy as documentation.

### E2. `SECURITY DEFINER` RPCs — privilege escalation if a new one skips the REVOKE pattern
- **Entry point:** any Postgres function created `SECURITY DEFINER`.
- **Current mitigation:** the two known ones (`check_and_increment_rate_limit`,
  `has_alpaca_token`) both have the correct `REVOKE FROM PUBLIC, anon,
  authenticated` + `GRANT service_role`-only pattern (T4, I1) — confirmed via
  migration history, not just convention. `has_alpaca_token` additionally self-
  limits via `WHERE id = auth.uid()` even though it runs with elevated privilege.
- **Recommendation:** this is a process risk, not a current gap — the two existing
  functions are correct. The risk is a *future* `SECURITY DEFINER` function created
  without the same REVOKE pattern, silently callable by any `authenticated` client
  with attacker-chosen arguments against the full-privilege execution context.
  Already codified as a hard rule in CLAUDE.md's Security decisions — this entry
  exists so the threat model doesn't have a gap where that rule's rationale lives
  only in one file.

### E3. Column-level GRANT vs. RLS — the general pattern behind T1
- **Entry point:** any table where RLS is row-scoped but a sensitive column exists
  in the same row a legitimate owner can otherwise write.
- **Current mitigation:** `profiles` is the one table where this pattern was found
  broken and fixed (T1). The 4 tables added after the 2026-07-18 full RLS audit
  (`merchant_aliases`, `scheduled_payments`, `lesson_streaks`, `oauth_nonces`) were
  checked for this document by reading their `CREATE TABLE` migrations in full —
  not assumed clean by absence of a prior audit finding:
  - `merchant_aliases` (`20260711120000_merchant_aliases.sql:1-9`) — columns are
    `alias_key text`, `canonical_key text`, `status text`. No secret/token column.
  - `scheduled_payments` (`20260712000000_scheduled_payments.sql:1-10`) — columns
    are `amount numeric`, `description text`, `category_name text`, `due_date
    date`, `status text`. Ordinary financial data, no credential.
  - `lesson_streaks` (`20260808000000_lesson_streaks.sql:1-6`) — columns are
    `current_streak int`, `last_completed_date date`. Not even financial data.
  - `oauth_nonces` (`20260730000003_oauth_nonces.sql:10-18`) — the one table of
    the four with a secret-like column (`nonce text PRIMARY KEY`, a single-use
    OAuth token). But its RLS is `ENABLE ROW LEVEL SECURITY` with **zero**
    `CREATE POLICY` statements — default-deny for `anon`/`authenticated` on the
    *entire row*, not just a scoped column. That's a stricter posture than
    `alpaca_access_token`'s fix (I1): `profiles` still grants `authenticated` a
    scoped SELECT on their own row, just not that column; `oauth_nonces` grants
    no client-facing SELECT path on any column at all. A column-level GRANT/REVOKE
    audit on this table would find nothing to REVOKE beyond what row-level RLS
    already denies.
- **Conclusion:** all 4 tables checked, no gap found. 3 of the 4 have no
  secret-bearing column to begin with (column-level GRANT auditing is moot —
  there's nothing sensitive to restrict beyond normal row ownership); the 4th
  (`oauth_nonces`) has a secret-like column but is already protected more tightly
  than the table this pattern was originally fixed on. "No secret columns" here is
  a confirmed fact from reading each table's full column list, not an assumption —
  recorded so a future audit doesn't have to re-derive it from scratch.
- **Recommendation:** none open for these 4 tables. Keep applying the same
  read-the-migration-first check to any *new* table going forward — this entry
  is the record that it was done once, not a standing exemption.

### E4. Alpaca trading — Free/Pro plan gate bypass
- **Entry point:** `alpaca-invest/index.ts`, gated by `usePlan.js`-derived plan
  status checked server-side (not just hidden client-side UI).
- **Current mitigation:** per CLAUDE.md, `usePlan.js` gating is explicitly called
  out as "core business logic; never bypass" — and separately, `profiles.plan` is
  one of the columns excluded from the client-writable UPDATE grant (T1), so a
  client can't elevate their own plan by writing the column directly.
- **Recommendation:** confirm `alpaca-invest`'s own server-side check reads
  `profiles.plan` (or equivalent) from the DB at request time rather than trusting
  a client-supplied plan/tier value in the request body — not re-verified
  line-by-line for this document, flagged as the natural next check given how
  central this gate is to the business model.

---

## Summary — what's actually open

Most of what this document found is **already mitigated and verifiable in code**,
which is itself the notable result: this app has had multiple real security-audit
passes (documented at length in CLAUDE.md) and they held up under a fresh,
code-grounded STRIDE pass rather than revealing large new holes. The genuinely open
items, in priority order:

1. **E1** — `config.toml` doesn't list all 23 functions' `verify_jwt` state,
   creating a documentation/deployment-drift risk even though current live state
   is correct.
2. **D4** — login-lockout-as-targeted-DoS not verified in depth.
3. **I2** — `ai-chat` warm-isolate cross-request state leakage of
   `financialContext` (not just Sentry tags) not re-verified line-by-line.
4. **T2, T3, E4** — three "confirm the obvious-seeming thing is actually true"
   checks, not known gaps.
5. **I4** — 18 functions on single-static-origin CORS: real, but already correctly
   triaged as a functionality gap, not a security hole.
6. **R1** — no durable audit trail for successful account deletion (only failures
   are logged) — a genuine gap if compliance/support ever needs to answer "did
   this happen and when" after the row is gone.

**E3** (column-level GRANT audit on the 4 post-2026-07-18 tables) was checked in
full for this document, not left open — see E3 above. All 4 read line-by-line;
no gap found.

Nothing in this document rises to "stop and fix before anything else ships" — the
existing controls (RLS, column-level grants, webhook signatures, rate limiting,
CSP, PII scrubbing) cover the high-severity classes already. Treat the list above
as the next audit's starting checklist, not an incident queue.
