# Arkonomy — Penetration Test Plan

Created 2026-08-17. This is a **plan**, not a test report — nothing below has
been executed yet except the Baseline section (already done, cross-referenced
to `SECURITY_THREAT_MODEL.md`). Every other section's status table currently
reads "Not yet tested" across the board; that's accurate, not a placeholder
that got forgotten.

## Methodology

- All testing against the **test account** (`90eb11c3-c1e9-4241-8362-9e15ce231c33`,
  `shevvik88@gmail.com`) or freshly-created disposable accounts — never real
  user data.
- Wherever a test could plausibly move real money (Alpaca live trades, Stripe
  real charges), confirm with the user before running it — some scenarios in
  this plan are request-shape/response-code checks that stop short of that
  line, others aren't. Flagged per scenario.
- "Reproducible exploit via test account, not theory" — the bar for every
  Test Scenario below is a concrete sequence of API calls or UI actions with
  an expected and actual result, the same standard the IDOR/race-condition
  audits already used this session, not a hypothetical.
- Findings from this plan get folded into `SECURITY_THREAT_MODEL.md` using
  its existing STRIDE lettering (continuing S/T/R/I/D/E numbering) once
  actually run — this document is the checklist that produces them, not a
  duplicate of that file.

---

## Baseline — already verified 2026-08-15 through 2026-08-17

Full detail lives in `SECURITY_THREAT_MODEL.md`. Summary for this plan's own
tracking:

| Category | What was checked | Outcome | Reference |
|---|---|---|---|
| Secrets in git history | 4 gitleaks daily-scan findings, decoded/verified line-by-line, one live-tested against the real API | 1 critical (legacy service_role JWT) — confirmed dead via live API test, not just a Dashboard label; 1 low (Firebase key, still live in `appCheck.js`, unresolved); 2 non-issues (publishable key) | I7 |
| Dependency vulnerabilities | `brace-expansion` (CVE-2026-69152), `nanoid` (GHSA-2v37-7h3g-55p8) | Both reachability-checked line-by-line (not assumed), both pinned via `overrides`, `npm audit` → 0 vulnerabilities | commits `ff51ac0`, `09320ab` |
| CORS | All 23 edge functions' `Access-Control-Allow-Origin` handling | 5 use an allow-list (prod + Vercel preview), 18 use a static single origin — no wildcard anywhere; the 18 are a functionality gap (breaks preview URLs), not a security hole | I4 |
| IDOR | Every client-supplied ID (`transaction_id`, `goal_id`, `account_id`, `scheduled_payment_id`, `merchant_alias_id`) across all 23 edge functions + frontend direct-table CRUD | 1 real gap found and fixed (`savings_reminders.goal_id` FK-ownership, service-role read in `push-notify` bypassed RLS) — live-verified with a real cross-user upsert attempt (`42501` rejection) | I6, migration `20260816000000` |
| Race conditions | Alpaca invest, Stripe subscriptions/webhooks, savings goals, Plaid transaction sync | 5 findings (A–E) + 1 accepted-risk follow-up (T6); 4 fixed and deployed live same day, 1 (D, savings lost-update) is dead code today, documented for when it's built | FINDING-A through E, T6, commits `3646d61`/`38ecf37`/`11ae68a`/`6c5577d`/`5795f5d` |

---

## 1. Auth & Session Security

### Requirements
1.1. Login lockout rate-limits by **IP+email combination**, not email alone —
     a single email shouldn't be lockable by an attacker spraying attempts
     from many IPs indefinitely, and a single IP shouldn't be able to
     credential-stuff many different emails without its own throttle.
1.2. Refresh tokens rotate on use (old refresh token invalidated once a new
     access/refresh pair is issued) — prevents a leaked-but-unused refresh
     token from being replayed indefinitely.
1.3. Changing a password invalidates all other existing sessions (a stolen
     session shouldn't survive the user's own password-change response to
     that theft).
1.4. A password-reset token is single-use, time-limited, and
     cryptographically unpredictable (not e.g. a short numeric code
     guessable by brute force within its TTL).
1.5. (Nice-to-have, not assumed to exist) Concurrent-session /
     new-device-login detection — flag if genuinely absent rather than
     assume it's there.

### Test Scenarios
- **1.1** — script N failed logins for the test email from one IP, confirm
  lockout per `auth-login`'s existing `check_login_lockout`/`record_login_failure`;
  separately, script failed logins for N *different*, non-existent emails
  from one IP in a tight loop and check whether anything throttles the IP
  itself (currently unknown — the exact rate-limit key composition wasn't
  read this session, only referenced by function name).
- **1.2** — log in, capture both tokens, use the refresh token once via
  `supabase.auth.refreshSession()`, then attempt to reuse the *original*
  (now-superseded) refresh token — expect rejection.
- **1.3** — log in on two separate sessions (two browser profiles or a
  session-token export), change password from session A, confirm session
  B's next authenticated call is rejected.
- **1.4** — trigger `supabase.auth.resetPasswordForEmail()`, inspect the
  reset link's token shape (length/entropy), confirm it's rejected after
  first use and after a reasonable TTL window.
- **1.5** — log in from two different IP/user-agent combinations back to
  back, check whether any email/notification/UI signal exists; if none,
  that's the finding itself (absence, not a bypass).

### Status
| Requirement | Verified | Result | Severity | Fix status |
|---|---|---|---|---|
| 1.1 IP+email lockout | **Tested 2026-08-17** | Passed (spoofing vector) / Known trade-off (structural). Read `check_login_lockout`/`record_login_failure`/`clear_login_attempts` in full: key is `email.toLowerCase()::ip`, 5 attempts / 15-min window → 15-min lockout, correctly implemented (sliding window reset). Live-tested against a disposable non-existent target email: 5 failures → 429 on the 6th, confirmed. Attempted to bypass via header spoofing: `CF-Connecting-IP` spoofing itself was blocked by Cloudflare's own WAF before reaching the origin (`403 DNS points to prohibited IP`) for an obviously-fake value; `X-Forwarded-For` spoofing (the code's fallback) was NOT blocked by Cloudflare but had **zero effect** on the lockout — same lockout state persisted across a "different" spoofed X-Forwarded-For, confirming `CF-Connecting-IP` (set authoritatively by Cloudflare, unspoofable) is always present for real traffic and takes priority; the `X-Forwarded-For` fallback branch is effectively dead code for actual production traffic. Residual, **not a bug**: the `email::ip` key design means a genuinely distributed attacker (real requests from many real distinct IPs — a botnet/proxy pool, not spoofed headers) gets an independent 5-attempt budget per real IP against the same target email. This is the standard, deliberate industry trade-off (the alternative — email-only lockout — lets an attacker DoS-lock any known email trivially) and wasn't live-tested further since it requires genuinely distinct source IPs, not available in this environment. | **LOW/informational** (structural trade-off, not a bug — the actual spoofing bypass hypothesis was disproven) | N/A — no fix needed for what was found; the distributed-attack residual is a known, accepted design trade-off |
| 1.2 Refresh token rotation | Not yet tested | — | — | — |
| 1.3 Session invalidation on password change | Not yet tested | — | — | — |
| 1.4 Password reset token properties | Not yet tested | — | — | — |
| 1.5 Concurrent-session detection | Not yet tested | — | — | — |

---

## 2. SSRF (Server-Side Request Forgery)

### Requirements
2.1. Every `fetch()` call in all 23 edge functions has its full target URL
     traced to its source — hardcoded constant, `Deno.env.get(...)`, or a
     value that (even partially) originates from request body/query/headers.
     Any fetch whose host, port, or path is influenced by client input is a
     candidate finding regardless of whether it's "obviously fine."
2.2. Alpaca OAuth `redirect_uri` (`alpaca-oauth-start`/`alpaca-oauth-callback`)
     specifically: confirm it's a fixed, env-configured value Alpaca itself
     validates against a pre-registered allow-list, not something influenced
     by a client-supplied return-path parameter.
2.3. Any URL-construction pattern that concatenates a client-supplied string
     directly into a request URL (query param values are lower-risk than
     path/host segments, but still worth enumerating) — `market-data`'s
     `symbol` parameter (used across 3 upstream APIs per its own code) is the
     most likely candidate given it's the most "stringly-typed" client input
     reaching an outbound `fetch()` anywhere in the codebase.

### Test Scenarios
- **2.1** — mechanical pass: `grep -n "fetch(" supabase/functions/*/index.ts`,
  for each hit trace backward to where every template-literal interpolation
  in that URL originates. Build the same kind of table this session's IDOR
  audit did for query-filters, but for fetch targets.
- **2.2** — read `alpaca-oauth-start/index.ts` in full (not done this
  session) to see exactly how `redirect_uri` is built; attempt to supply an
  alternate `redirect_uri`-influencing parameter via the start endpoint's
  request body/query if one exists, confirm Alpaca (or the app) rejects it.
- **2.3** — send `market-data` a `symbol` value containing URL-meaningful
  characters (`../`, `@evil.com`, `%00`, a full alternate URL) and inspect
  the actual outbound request (via a request-logging proxy or by reading
  Sentry/edge-function logs for the constructed URL) rather than assuming
  from the code shape alone.

### Status
| Requirement | Verified | Result | Severity | Fix status |
|---|---|---|---|---|
| 2.1 Full fetch-URL audit, all 23 functions | **Tested 2026-08-21, fixed and live-verified same day** | 17 of 23 functions call `fetch()` directly (plus 2 shared helpers, `_shared/appCheck.ts` and `_shared/marketSnapshot.ts`). Traced every one back to its host/path source: `market-data` (2.3), Alpaca (`BASE_URL` hardcoded const), all Plaid functions (`plaidBase` from `Deno.env.get('PLAID_ENV')`, server-only — `plaid-get-accounts`'s `itemPlaidBase` from `plaid_items.plaid_environment`, a DB column with `DEFAULT 'production'` and NOT in the client-writable GRANT list), `ai-chat`/`stock-ai-analysis` (hardcoded `api.anthropic.com`), `weekly-report`/`large-transaction-alert`/`generate-monthly-report` (hardcoded `api.resend.com`), `alpaca-oauth-callback` (hardcoded `api.alpaca.markets`), `appCheck.ts` (hardcoded Google JWKS URL), `marketSnapshot.ts` (fixed 4-symbol array) — all clean, no client input reaches a fetch host/path. Also closed 2.2's open side-note: `plaid-link-token`'s client `redirect_uri` rides in the POST **body** to a fixed `plaidBase` host, never the fetch target itself — confirmed not SSRF (Plaid-side open-redirect risk at most, out of scope here). **Real finding: `push-notify`.** `sendPushNotification()` calls `webpush.sendNotification(subscription, ...)`, which does its own raw `fetch()` to `subscription.endpoint` with zero validation. `subscription` comes from `profiles.push_subscription` — confirmed client-writable (`docs/security-log.md`'s column-GRANT list) via direct PostgREST update, bypassing the legitimate browser `PushManager` flow (`src/hooks/usePushNotifications.js`) entirely. `push-notify`'s Mode 1 (`POST {user_id}`) lets an authenticated user trigger a send to their own stored subscription synchronously, on demand — no cron wait needed. Net effect: an authenticated user can make the edge function issue a server-side HTTP request to a host/port/path of their choosing — a live SSRF primitive. **Fix**: `sendPushNotification()` now rejects any `subscription.endpoint` whose scheme isn't `https:` or whose hostname isn't on a fixed allow-list of real push-service hosts (`fcm.googleapis.com`, `updates.push.services.mozilla.com`, `web.push.apple.com`, `*.notify.windows.com`), throwing a distinct `BlockedPushEndpointError` before any `webpush`/`fetch()` call; all 4 call sites catch it distinctly, log a Sentry warning, and report `blocked_endpoint`/`invalid_endpoint`. Deployed (`push-notify` v57→v58), deploy verified independently via `mcp__supabase__get_edge_function` (actual file content, not just the CLI's "Deployed" message). **Live-verified 2026-08-21** (`scripts/test-push-notify-ssrf-blocklist.mjs`): test account's `push_subscription.endpoint` overwritten to a webhook.site URL via service-role SQL (same effective write a real attacker gets via direct PostgREST — the column is client-writable regardless of write path), then `push-notify` Mode 1 called with the test account's own JWT, exactly as a real attacker would. Result: `HTTP 400 {"sent":0,"reason":"invalid_endpoint"}`. Confirmed via 2 independent sources beyond the response body: webhook.site's own request-log API showed **0 requests received** (ruling out a false-negative where the block message is right but the request went out anyway), and a direct SQL read immediately after showed `push_subscription` unchanged — proving the new `BlockedPushEndpointError` branch fired, not the pre-existing 410/404-cleanup branch (which would have nulled the column). Test subscription restored to the real pre-test value afterward. **Not independently confirmed**: the Sentry warning event itself — no Sentry API/MCP access this session, verified by code-read only. | **MEDIUM-HIGH → Closed.** Authenticated SSRF primitive (internal network probing / blind outbound proxy from the edge function's own network), gated behind a real Supabase session, not anonymous. | **Fixed, live-verified** (`supabase/functions/push-notify/index.ts`) |
| 2.2 Alpaca redirect_uri source | **Tested 2026-08-17** | Passed — read both sides in full. `src/App.jsx:104` builds the authorize-URL redirect_uri from `SUPABASE_URL` (fixed env-derived value, no client input). `alpaca-oauth-callback/index.ts:38` reads `ALPACA_REDIRECT_URI` from its own env var for the token-exchange call — also not client-influenced. Alpaca itself enforces redirect_uri match against what's registered for the OAuth client_id. No client-supplied value reaches either side. Side note (not this requirement, flagged for later): `plaid-link-token` *does* accept a client-supplied `redirect_uri` (native Capacitor deep-link case per its own comment) forwarded to Plaid's API without an app-side allow-list check — not SSRF (controls the attacker's own Plaid Link OAuth redirect, not a server-side fetch target) and out of today's scope, but worth a dedicated look later. | None (2.2 itself) | N/A |
| 2.3 market-data symbol injection | **Tested 2026-08-17** | Passed (code-review only, no live injection attempt needed — the code shape rules it out) — every `symbol` interpolation (Yahoo, Finnhub, Kraken) goes through `encodeURIComponent()` into a query-string value on a hardcoded host; `period`/`interval`/`range`/`since` are looked up from a fixed `Record<string,...>` table (`PERIODS[period] ?? PERIODS['1M']`), never the raw client string. No host/path is ever influenced by client input. | None | N/A |

---

## 3. Business Logic & Input Validation

### Requirements
3.1. Every amount-accepting entry point rejects negative numbers, zero
     (where zero is nonsensical), `NaN`, `Infinity`/`-Infinity`, and
     absurdly large finite values — server-side, independent of whatever
     the client UI's `<input min="1">` happens to enforce.
3.2. Amount limits (minimum investment, maximum transaction, budget caps)
     are enforced in edge-function/DB logic, not only enforced by React
     state that a direct API call bypasses entirely.
3.3. Financial state transitions can't be corrupted by calling app APIs out
     of the order the UI normally enforces — specifically: deleting an
     account while a Stripe checkout is pending, while an Alpaca order's
     pending row exists, or while a Plaid sync is mid-flight.
3.4. `transactions.amount` and `savings.target`/`.current` have no DB-level
     `CHECK` constraint against negative/zero values (confirmed by reading
     `20260412000003_baseline_transactions.sql`/`20260412000002_baseline_savings.sql`
     earlier this session) — unlike `scheduled_payments.amount`, which does
     (`CHECK (amount > 0)`). Whether this is actually exploitable through any
     client-reachable insert path needs to be tested, not assumed either way.

### Test Scenarios
- **3.1** — direct calls to `alpaca-invest` with `amount: -50`, `amount: 0`,
  `amount: "NaN"`, `amount: Infinity` (as JSON, which serializes `Infinity`
  as `null` — worth checking what `Number(null)` does to the existing
  `Number.isFinite(numAmount)` guard), `amount: 1e308`. Same battery against
  any other amount-accepting body (`stripe-checkout` doesn't take a
  client-supplied amount — Stripe's price ID is fixed — but re-confirm this
  is still true before skipping it).
- **3.2** — confirm the $1 minimum and any maximum on `alpaca-invest` is
  actually enforced server-side (it is, per the code read this session —
  `numAmount < 1` — but this needs an actual live-fired request, not just a
  code read, to close the loop the same way FINDING-A's fix was verified).
- **3.3** — the concrete chain: start a Stripe checkout (get a session URL,
  don't complete payment), then immediately call `delete-account` with the
  same user's token. Check: does the pending Stripe Checkout session and/or
  the `checkout_pending_at` guard leave any orphaned state? Does the Stripe
  customer/subscription end up correctly cancelled, or could a since-deleted
  user still complete that checkout URL and get charged with no app account
  to answer to? Repeat with an `alpaca-invest` pending row in flight instead
  of a Stripe checkout.
- **3.4** — attempt a direct `supabase.from('transactions').insert(...)`
  (RLS-scoped to the test user's own `user_id`, via the anon key + real
  session, not service role) with `amount: -100`. If it succeeds, determine
  actual downstream impact (does it skew `get-insights`/`ai-chat`'s computed
  totals, `healthScore.js`, Cash Flow Forecast) rather than stopping at "it
  inserted."

### Status
| Requirement | Verified | Result | Severity | Fix status |
|---|---|---|---|---|
| 3.1 Amount edge values (all entry points) | **Tested 2026-08-19** | Passed — grepped all 23 edge functions for a client-supplied `amount` driving a financial action first (`await req.json()` destructuring): `alpaca-invest` is the only one (`stripe-checkout` uses a fixed Stripe price ID, everything else computes `amount` from already-synced Plaid data server-side). Live battery of 6 bad values against the deployed function: `-50`, `0`, `"NaN"` (string) rejected by the `!Number.isFinite(numAmount) \|\| numAmount < 1` guard before the pending-row insert; `1e308` (finite but absurd) passed that guard as designed and was correctly rejected at the buying-power check, still before any Alpaca order call; `null` (what `JSON.stringify(Infinity)` actually serializes to) rejected by the same finite/min guard. 5/6 behaved exactly as the code predicts. The 6th (`Infinity` sent as a raw, non-standard JSON token — a hand-crafted request `JSON.stringify` could never itself produce) got `HTTP 500` instead of a validation `400` — see 3.5, a real but separate finding, not a validation-guard failure: the request never reached the amount check at all, it failed at JSON parsing. `transactions`/`savings` CHECK constraints already covered under 3.4. | None on the validation guard itself | N/A |
| 3.2 Server-side limit enforcement | **Tested 2026-08-19** | Passed — confirmed live via the same battery: the `$1` minimum (`numAmount < 1`) and buying-power maximum are both enforced server-side in `alpaca-invest`, independent of client UI state, exactly as the code shows. No other edge function accepts a client-supplied amount to enforce a limit on (see 3.1). | None | N/A |
| 3.5 Malformed-JSON body → 500 instead of 400 in `alpaca-invest` (found via 3.1) | **Tested 2026-08-19, fixed and deployed same day** | `alpaca-invest`'s `await req.json()` sat inside the function's single top-level try/catch, after auth succeeds. A body that fails JSON parsing (e.g. a raw `Infinity` token, invalid per RFC 8259) threw a `SyntaxError` that wasn't caught locally — it fell through to the general catch, which unconditionally calls `captureAndFlush()` (real Sentry event, no error-type filtering — confirmed by reading `_shared/sentry.ts`) and returned a generic `{"error":"Internal Server Error"}` 500. Confirmed NOT an information-exposure issue before fixing: the response was the same hardcoded generic string used for every other exception in that catch, no stack trace or parse detail leaked. **Fix**: `req.json()` now wrapped in its own try/catch, returns `400 {"error":"Invalid request body"}` on a parse failure, before the general catch/`captureAndFlush` is ever reached. Deployed (`alpaca-invest` v73→v74, `verify_jwt: false` preserved as it was live). This is one instance of a repeating shape across several edge functions — see 3.6 for the class-wide list. **Live-verified 2026-08-19**: re-ran the same 6-case battery against the deployed function — the `Infinity` raw-token case now returns `HTTP 400 "Invalid request body"` instead of `500`; all 6/6 cases PASS. | **LOW — monitoring/hygiene, not a security vulnerability.** The request was already correctly rejected; the only issue was that malformed-JSON traffic generated real Sentry "server error" alerts indistinguishable from genuine crashes. | **Fixed: verified** (`supabase/functions/alpaca-invest/index.ts`) |
| 3.6 Same malformed-JSON → 500 shape in other client-facing functions (class-wide, found via 3.5) | **Surveyed 2026-08-19, fixed and deployed same day, live-verified 2026-08-19** | Grepped all 23 edge functions for `await req.json()`/`JSON.parse(...)` on a client-supplied body. Already safely guarded (either `.catch(() => ({}))` or an explicit try/catch, no fix needed): `market-data`, `delete-account`, `plaid-link-token`, `push-notify`, `plaid-sync-transactions`, `get-insights`, `plaid-webhook` (`stripe-webhook` parses via Stripe SDK's signature-verifying `constructEvent`, different mechanism, not in scope for this check). **4 functions confirmed to have the identical unguarded shape** `alpaca-invest` had (raw `await req.json()` inside a try whose catch unconditionally calls `captureAndFlush`, all confirmed to have Sentry active via `initSentry`): `ai-chat` (`index.ts:44`), `auth-login` (`index.ts:41`), `plaid-exchange-token` (`index.ts:49`), `stock-ai-analysis` (`index.ts:54`). **`auth-login` is the highest-reachability instance** — unlike the other three, it has no auth check before the body parse (it *is* the login endpoint, callable by anyone with no bearer token at all), so it's the most trivially spammable of the four for Sentry-noise purposes. **Fix**: same try/catch-and-400 pattern as 3.5, applied to all 4 (`req.json()` wrapped, returns `400 {"error":"Invalid request body"}` before the general catch/`captureAndFlush`). Deployed same day (`ai-chat` v106→v107, `auth-login` v43→v44, `plaid-exchange-token` v59→v60, `stock-ai-analysis` v49→v50, `verify_jwt: false` preserved on all 4 as they were live). **Live-verified via `scripts/test-malformed-json-3.6.mjs`** (raw `{"foo":Infinity}` body, invalid per RFC 8259) against the deployed functions — `auth-login` tested directly (no auth needed, it is the login endpoint); `ai-chat`/`plaid-exchange-token`/`stock-ai-analysis` tested with a real user session token. 4/4 returned `HTTP 400 {"error":"Invalid request body"}`, not 500. | **LOW — same monitoring/hygiene class as 3.5, not a vulnerability in any of the 4.** | **Fixed: verified** (`ai-chat`, `auth-login`, `plaid-exchange-token`, `stock-ai-analysis`) |
| 3.3 Out-of-order API call chains | **Tested 2026-08-17, re-verified 2026-08-19 against the shipped fix** | Original 2026-08-17 pass: **Failed** — disposable test account, simulated a pending `investments` row, ran real `delete-account`, confirmed it deleted the account with zero guard; the post-deletion UPDATE race (alpaca-invest confirm / stripe-webhook `checkout.session.completed`) both matched 0 rows silently. Fixed same evening (`a66b845` pending-investment poll/block, `22311fc` fail-closed hotfix, `be3b6a9` `checkout_session_id` tracking + active Stripe Checkout Session expiry) — but this plan's table was never updated after the fix landed, so it kept reading "Not fixed" for two days. **Re-verified live 2026-08-19** against the primary test account (90eb11c3-...): inserted a synthetic `pending` investments row via service-role SQL, called the deployed `delete-account` (dry_run:false) with a real user JWT. Result: `HTTP 409` after 9658ms — matches the code's 8×1000ms poll exactly (`PENDING_MAX_ATTEMPTS`/`PENDING_POLL_MS`). Confirmed via SQL immediately after: `auth.users`/`profiles` still present (1/1), `transactions`=1282, `categories`=6, `investments`=6 (5 real + the synthetic row) — nothing deleted or modified, `checkout_session_id`/`stripe_customer_id` unchanged, confirming the guard blocks *before* any Stripe/Plaid side-effect code runs (guard is the first destructive-adjacent step in the function). Synthetic row deleted after. | **HIGH → Closed.** Guard confirmed to prevent the exact silent-data-loss scenario found on 2026-08-17. | **Fixed, live-verified** |
| 3.4 Missing CHECK constraints, real impact | **Tested 2026-08-17, fix applied same day, re-verified 2026-08-19** | Original 2026-08-17 pass: **Failed** — negative, zero, and `"NaN"` all inserted into `transactions.amount` via the RLS-scoped client path with no constraint to stop them. Fixed same day (`430e1bd`, migration `20260818000001_amount_check_constraints.sql`) — but this plan's table was never updated after, so it kept reading "awaiting decision" after a decision had already shipped. **Re-verification 2026-08-19 had a false start**: a first attempt via the same RLS-scoped client path (script `test-amount-check-constraints.mjs`) got `HTTP 403 "violates row-level security policy"` on all 8 cases instead of the expected `23514 check_violation` — investigated rather than accepted at face value. Root cause: the test script's own bug, not a PostgREST masking behavior — it omitted `user_id` from the insert body, so `transactions`/`savings`' RLS `WITH CHECK (user_id = auth.uid())` rejected the row on a NULL `user_id` before Postgres ever reached the CHECK constraint (script fixed, `user_id` added). **Confirmed via direct SQL bypassing RLS** (correct `user_id`, only the CHECK constraint can reject): all 8 cases (`transactions.amount` -100/0/NaN; `savings.target` -100/0/NaN; `savings.current` -1/NaN) rejected with `23514 check_violation`, naming the exact constraint (`transactions_amount_positive`/`savings_target_check`/`savings_current_check`) each time — nothing committed, confirmed via a leaked-row count of 0 after. Constraint behaves exactly as designed; the RLS-then-CHECK layering in the real client path is expected defense-in-depth, not a masking bug. | **NaN: MEDIUM-HIGH → Closed. Negative/zero: LOW-MEDIUM → Closed.** | **Fixed, live-verified** |

---

## 4. Regression Test Coverage

### Requirements
4.1. An automated, repeatable test exists for each of today's 4 race-condition
     fixes, so a future refactor can't silently reintroduce them:
     - `alpaca-invest`'s pending-row dedup (duplicate request → 409 before
       reaching Alpaca; failure path → row released, not stuck)
     - `stripe-webhook`'s event_id idempotency (same `event.id` twice →
       second is `{duplicate:true}`, no double side-effect)
     - `stripe-checkout`'s `checkout_pending_at` guard (concurrent checkout
       attempts → second is 409, released on `.completed`/`.expired`)
     - `plaid-sync-transactions`'s cursor CAS (concurrent sync of the same
       item doesn't let a stale cursor overwrite a more-advanced one)
4.2. A test framework decision that fits this project's actual stack — not
     assumed to be Vitest by default just because it's a common choice.

### Test Scenarios
- **4.1** — each fix already has an ad-hoc, one-off verification method used
  during today's session (e.g. the `savings_reminders` IDOR test script, the
  live `pg_policy` check) — the work here is turning those into scripts that
  live in the repo and run repeatably, not one-off scratchpad files deleted
  after use.
- **4.2** — this needs a decision, not an assumption: the 4 fixes above all
  live in **Deno edge functions**, not the Vite/React frontend. Vitest (a
  Node-based runner) doesn't execute Deno-flavored TypeScript
  (`https://esm.sh/...` imports, `Deno.serve`, `Deno.env`) without
  significant shimming — it's the right tool for any future `src/` unit
  tests, but not a natural fit for these specific fixes. Two real options,
  needs a choice before writing anything:
  - **Deno's own test runner** (`deno test`) — natural fit for the actual
    code, but Deno CLI isn't installed locally (confirmed this session when
    trying to typecheck `stripe-webhook`'s dedup logic) — would need
    installing it first.
  - **Live HTTP integration tests** against the deployed functions — the
    same pattern already used by `qa-test.cjs` and the various
    `scripts/test-*.mjs` files already in this repo (untracked scratch
    scripts from other sessions, but an established local pattern) — no new
    tooling, but tests real deployed behavior, not code in isolation, and
    costs a live network round-trip per run.

### Status
| Requirement | Verified | Result | Severity | Fix status |
|---|---|---|---|---|
| 4.1 Tests for all 4 race-condition fixes | Not yet tested | — | — | — |
| 4.2 Framework decision | Not yet decided | — | — | — |

---

## 5. Incident Response Readiness

### Requirements
5.1. A written runbook exists for "a real secret/credential was found leaked
     (git history, logs, a bug report, a public repo scan)" — generalized
     from the exact process actually used today diagnosing the leaked
     service_role JWT, not written from scratch/theoretically.
5.2. A checklist for scope assessment via Sentry and Supabase logs exists —
     "how do I find out if this credential was actually used maliciously,"
     not just "how do I rotate it."
5.3. A rotation order/checklist per credential type (Supabase service_role,
     Supabase anon/publishable, Stripe secret/webhook secret, Plaid
     client/secret, Alpaca client/secret, Firebase API key, VAPID keys) —
     what breaks if rotated out of order, what needs updating where.

### Test Scenarios
- **5.1/5.2/5.3** — these aren't "test scenarios" in the exploit-reproduction
  sense; the deliverable is the runbook document itself. The one thing that
  *can* be dry-run without a real incident: pick one already-rotated/dead
  credential (the leaked legacy service_role key from I7 is perfect, it's
  already confirmed dead) and walk a fresh reader through the runbook using
  only the runbook's own steps, to check the runbook is actually complete
  and correctly ordered — not skipping this validation step just because
  the credential in question is already resolved.

### Status
| Requirement | Verified | Result | Severity | Fix status |
|---|---|---|---|---|
| 5.1 Leak-response runbook written | Not yet written | — | — | — |
| 5.2 Scope-assessment checklist (Sentry/Supabase logs) | Not yet written | — | — | — |
| 5.3 Per-credential-type rotation order | Not yet written | — | — | — |

---

## 6. Multi-step Attack Chains

Individually low/medium findings combined into a bigger effect. Thinking as
an authenticated attacker using only the UI/API — no code access assumed —
chaining actions across features to reach a state no single action would.

### Requirements
6.1. **IDOR → information disclosure chain**: confirm no *other* table has
     the same "row-level RLS correct, but an FK into another user's owned
     row isn't ownership-checked" shape as the now-fixed
     `savings_reminders.goal_id` (I6) — that fix closed one instance of a
     *pattern*, not necessarily every instance of it.
6.2. **Payment-flow-abandonment chain**: start a Stripe checkout (or an
     Alpaca invest request) and delete the account mid-flight (see 3.3) —
     confirm this can't leave a live payment method charged with no
     corresponding app account, or a dangling Alpaca order with no
     `investments` row tying it to anyone.
6.3. **Signup-abuse → rate-limit-bypass chain**: `ai-chat`/`get-insights`
     are rate-limited per-user (D1 in the threat model) — confirm signup
     itself has no throttle that would let an attacker spin up many
     disposable accounts to multiply free LLM usage past the intended
     per-user cap.
6.4. **Plan-downgrade race chain**: start an `alpaca-invest` request as a Pro
     user (pending row reserved, Alpaca call about to fire), have
     `stripe-webhook` process a `customer.subscription.deleted` for that
     same user in the same narrow window — does the in-flight trade still
     go through even though the plan flips to `free` mid-request? (Combines
     E4's "not re-verified: does alpaca-invest read plan fresh per-request"
     with the timing window FINDING-A's fix newly introduced.)
6.5. **Compounding unverified-item chain (hypothesis only, needs the
     underlying items resolved first)**: I2 (`ai-chat` warm-isolate
     `financialContext` leakage, not yet re-verified) combined with I6's
     *pattern* (6.1) — if a future FK-ownership gap surfaces real
     cross-user data into a request `ai-chat` processes, and I2's isolate
     reuse is confirmed real, the two together could leak one user's
     financial detail into another user's AI conversation. Not testable
     until both halves are independently confirmed or ruled out — listed so
     it isn't lost track of once 6.1 and I2 are each individually resolved.
6.6. **CAPTCHA on signup (follow-up to 6.3)**: the 6.3 fix (per-IP signup
     throttle) stops single-source scripted abuse but not a genuinely
     distributed one (botnet / proxy pool, one account per IP) — the same
     structural limit as the `email::ip` login lockout (1.1). A CAPTCHA
     (hCaptcha / Cloudflare Turnstile via Supabase Auth's built-in setting +
     `gotrue_meta_security.captcha_token`) is the complementary control for
     the distributed case. Deliberately **not** implemented with 6.3 —
     tracked here as a standalone follow-up.

### Test Scenarios
- **6.1** — repeat the FK-ownership-audit method from I6's fix (read every
  table's `CREATE TABLE` + RLS policy, look for any column that's a foreign
  key into a *different* user-owned table without an accompanying ownership
  `EXISTS` check) across every table added or modified since the last full
  pass, not just the 4 already checked for I6.
- **6.2** — concrete sequence: (a) `stripe-checkout` → get session URL, don't
  pay; (b) immediately `delete-account`; (c) check Stripe Dashboard/API for
  that customer's state; (d) separately, trigger `alpaca-invest` up to the
  pending-row-reserved point (achievable by making the account fail the
  buying-power check right after — a controlled way to leave a `pending` row
  briefly) and call `delete-account` in that window; check `investments`
  table state after.
- **6.3** — script N signups in a tight loop from one IP/test harness (using
  disposable email addresses, cleaned up after), check whether anything
  throttles signup itself, then confirm each new account gets its own fresh
  rate-limit budget on `ai-chat`.
- **6.4** — requires precise timing control: hold `alpaca-invest` at the
  buying-power-check step (e.g. via a temporary artificial delay, removed
  after the test) while firing a `customer.subscription.deleted` webhook
  test event for the same user via Stripe's test-mode event resend, then let
  `alpaca-invest` continue and observe whether it completes the trade.
- **6.5** — not runnable until I2 gets its own independent test pass; revisit
  after.

### Status
| Requirement | Verified | Result | Severity | Fix status |
|---|---|---|---|---|
| 6.1 Broader FK-ownership sweep | **Tested 2026-09-02 (code + live schema/policy read)** | Full sweep of every FK and pseudo-FK in the live schema (`information_schema` FK list + full `pg_policy` dump, all 20 public tables). The I6 pattern needs three things at once: (a) a client-writable table, (b) an FK column on it into *another* user-owned table, (c) a service-role (RLS-bypassing) read that resolves that FK — the original being `push-notify`'s `.select('...savings(name)')` embed. Client-writable tables (INSERT/UPDATE/ALL policy for `authenticated`): `categories, investments, lesson_streaks, merchant_aliases, notification_preferences, profiles, savings, savings_reminders, scheduled_payments, transactions`. Their only non-`user_id` FK/pseudo-FK columns into another user-owned row: **(1)** `savings_reminders.goal_id → savings.id` — the I6 site, already fixed (`20260816000000`; live `pg_policy` dump confirms `with_check` now carries `EXISTS (SELECT 1 FROM savings WHERE savings.id = goal_id AND savings.user_id = auth.uid())`). **(2)** `transactions.category_id → categories.id` — client can point a transaction at another user's category UUID, but no exploit path: a grep of all 26 edge functions + all of `src/` shows the *only* PostgREST embedded/nested select anywhere in the codebase is `push-notify:291`; every `transactions` read (edge + client) uses the flat denormalized `category_name` text column, never a `categories(...)` embed, and under the `authenticated` role an embed would be RLS-filtered to null anyway. **(3)** `transactions.account_id` (text) / `savings.plaid_account_id` (text) → external Plaid account ids on `plaid_accounts` — client-writable, but `plaid_accounts` has no client SELECT/embed path and every service-role read of it is `.eq('user_id', …)`-scoped; the client-side match (`Savings.jsx:122`, `plaidAccounts.find(a => a.account_id === sv.plaid_account_id)`) runs against the caller's *own* accounts only, so a poisoned id just finds no match. **(4)** `plaid_accounts.item_id → plaid_items.id` — `plaid_accounts` has no client INSERT/UPDATE policy at all (service-role sync is the only writer, deriving `item_id` from the item being synced). Every other FK on a client-writable table is the row's own `user_id → profiles.id` — the direct ownership check itself, not a transitive one. | **None — no new finding.** I6 was the only instance of the pattern; the sweep confirms it, and confirms the codebase has exactly one embedded-select site (the one already fixed). | N/A — nothing to fix |
| 6.2 Payment-flow-abandonment chain | **Tested 2026-08-17, re-verified 2026-08-19** | Same test as 3.3 confirms this chain concretely — see 3.3's result. | **HIGH → Closed** (same finding as 3.3) | **Fixed, live-verified** |
| 6.3 Signup-abuse rate-limit bypass | **Tested 2026-09-02 (live)** | Signup is plain `supabase.auth.signUp()` (`AuthScreen.jsx:150`) — no wrapping edge function, no app-side throttle. Live test (`scripts/test-signup-rate-limit-6.3.mjs`): **20 back-to-back `POST /auth/v1/signup` from one IP, all on one email domain — 20/20 HTTP 200, zero 429, no CAPTCHA challenge, no escalating delay** (~1 s each, flat). No per-IP and no per-email-domain signup limit is configured. Partial mitigation confirmed (`scripts/test-signup-confirm-gate-6.3b.mjs`): email confirmation *is* enforced on the session path — `signInWithPassword` on an unconfirmed account returns `400 email_not_confirmed`, so a freshly-created account has no usable JWT until its inbox link is clicked (this leg not completed live — `@arkonomy-pentest.invalid` can't receive mail — but a real attacker automates it with any disposable-inbox API). Corollary confirmed by code, not assumed: `enforceRateLimit(userId, fn)` (`_shared/rateLimit.ts:41`) keys **only** on `user_id`, no IP component — so every confirmed account gets its own fresh `ai-chat` 20/hr + `get-insights` 30/hr budget. All 20 disposable accounts deleted via Admin API after the run (20/20). | **LOW-MEDIUM.** Absent signup rate-limit / CAPTCHA is a real gap; the LLM-cost-multiplication chain it enables is gated by mandatory per-account email confirmation, which bounds the practical rate but not the total account count. | **Open — finding only, no fix applied.** Candidates: Supabase Auth CAPTCHA (hCaptcha/Turnstile) on signup; a per-IP signup rate limit; an IP component in `enforceRateLimit` for the LLM functions. |
| 6.4 Plan-downgrade race chain | **Tested + fixed + live-verified 2026-09-02** | The race premise doesn't hold — because there was **no server-side plan check to race against**. Read `alpaca-invest`, `alpaca-oauth-start`, `alpaca-oauth-callback`, `stripe-webhook` in full: `alpaca-invest` never read `profiles.plan`; its only gates were auth → `amount ≥ 1` → symbol format → pending-row dedup → `alpaca_access_token` presence → buying power. The Pro paywall on investing lived **entirely in React** (`usePlan.js` + the `(!isPro \|\| isTrial)` guards in `App.jsx:1532` / `Markets.jsx:744`). `alpaca-oauth-start` had no plan check either, so a free user could complete Alpaca OAuth and store a working token. And `customer.subscription.deleted` set `plan:'free'` but left `alpaca_access_token` intact — a downgraded ex-Pro kept trading indefinitely, no race needed. **Pre-fix live proof** (`scripts/test-alpaca-invest-plan-gate-6.4.mjs`, zero money): disposable `plan=free` account, no token, called `alpaca-invest` with its own JWT → `HTTP 400 alpaca_not_connected` (sailed past every gate, stopped only by the missing token — with a token this places a real order). **Fix**: new `_shared/requirePaidPlan.ts` (fails **closed**), mirrors `usePlan.js` exactly (`plan === 'pro'` AND not in an active `trial_ends_at` window), wired into `alpaca-invest`, `alpaca-oauth-start`, and `alpaca-portfolio` right after auth — returns `403 upgrade_required` before any side effect. `stripe-webhook` now also nulls `alpaca_access_token/refresh_token/account_id/connected_at` on all three downgrade paths (`customer.subscription.deleted`, terminal `invoice.payment_failed`, `customer.subscription.updated`→inactive). Deployed: `alpaca-invest` v75→v76, `alpaca-oauth-start` v10→v11, `alpaca-portfolio` v39→v40, `stripe-webhook` v53→v54 (all `verify_jwt:false` preserved, deploy confirmed via `list_edge_functions`). **Post-fix live-verified** (same script): free → 403 on all 3 functions; active-trial (`plan=pro`, `trial_ends_at` future) → 403; paid Pro (`plan=pro`, `trial_ends_at` null) with no token → 400 `alpaca_not_connected` (gate passes, real Pro not broken); 0 `investments` rows written (gate fires before the pending-row insert). | **HIGH → Closed.** Paid-Pro paywall bypass on a real-money feature (`alpaca-invest` places live Alpaca orders), reachable by any account with a valid JWT — no race, no timing. Same underlying gap as E4. | **Fixed, live-verified** (`_shared/requirePaidPlan.ts`, `alpaca-invest`, `alpaca-oauth-start`, `alpaca-portfolio`, `stripe-webhook`) |
| 6.5 Compounding I2+I6-pattern chain | Blocked on I2/6.1 individually | — | — | — |
| 6.6 CAPTCHA on signup (follow-up to 6.3) | Not started | Complementary control for the distributed-abuse case the per-IP 6.3 throttle doesn't cover (botnet / proxy pool, one account per IP). hCaptcha / Cloudflare Turnstile via Supabase Auth's built-in setting + `gotrue_meta_security.captcha_token` in `auth-signup`'s upstream call. | LOW (residual after 6.3) | **Deferred** — intentionally out of scope for the 6.3 fix; revisit if distributed signup abuse is observed |

---

## Next steps

This is the full structure across Baseline + 6 categories, as asked — nothing
past the Baseline row has been executed. Waiting for confirmation before
running any Test Scenario above. A few explicitly need a decision first,
not just a green light:

- **4.2** — Deno test runner (needs installing Deno) vs. live HTTP
  integration scripts (no new tooling, matches existing `scripts/test-*.mjs`
  pattern) — pick one before 4.1 gets written.
- **6.4** — requires deliberately introducing a temporary artificial delay
  into `alpaca-invest` to create a controllable race window, removed after
  the test — flagging since that's a temporary code change for testing
  purposes, not a pure black-box test.
- Several scenarios (3.3, 6.2) involve real Stripe/Alpaca API calls even in
  a "don't complete payment" shape — confirm which of those are fine to run
  against live Stripe/Alpaca test-mode vs. need extra care.
