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

### S5. Password-reset 8-digit `email_otp` — throttle on `/auth/v1/verify` confirmed live — **found 2026-08-27, closed same day (was misreported as open)**
- **Entry point:** GoTrue's native `POST {SUPABASE_URL}/auth/v1/verify`,
  reachable directly with the public anon key — not an Arkonomy edge
  function, so none of Arkonomy's own rate-limit code (`check_login_lockout`,
  `enforceRateLimit`) applies to it.
- **Attack vector:** `supabase.auth.resetPasswordForEmail()`
  (`AuthScreen.jsx:200`) and the equivalent Admin API `generate_link`
  both produce, alongside the long `hashed_token` used in the emailed
  link, a short 8-digit numeric `email_otp` — GoTrue's standard alternate
  "enter this code" flow, shipped by Supabase's default email template,
  not something Arkonomy added. Confirmed live (disposable account,
  `scripts/test-password-reset-token.mjs`) that `POST /auth/v1/verify
  {type:'recovery', email, token:<8-digit code>}` independently issues a
  full session with no `token_hash` involved — not a cosmetic/unused
  field. 15 wrong guesses against a real, still-valid code were all
  correctly rejected, but the real code still worked immediately after —
  no lockout, no increasing delay, no throttle observed on this endpoint
  specifically (as distinct from `auth-login`'s lockout, which never
  fires here).
- **Impact (initial read, before follow-up):** 8 digits = 10^8
  combinations. The original test only sent 15 wrong guesses and saw no
  429 — but 15 is under Supabase's documented 30-request IP-based token-
  bucket burst for `/auth/v1/verify` (confirmed via `search_docs`,
  `guides/auth/rate-limits`: "Verification requests" are limited **by IP
  address**, token-bucket algorithm, burst capacity 30, refilled at
  `auth.rate_limits.verification.requests_per_hour` — listed
  **"Customizable: No"**, a fixed platform default, distinct from the
  customizable `rate_limit_otp`/`rate_limit_email_sent`/etc. limits).
  15 requests could never have crossed that threshold — the original
  "no throttle observed" conclusion was a sample-size artifact, not a
  real gap.
- **Follow-up, live-verified 2026-08-27** (`scripts/test-verify-endpoint-rate-limit.mjs`,
  disposable account): sent 45 wrong-guess requests against a real,
  still-valid recovery code. Requests #1–30 got the expected `403`
  (wrong code, normally rejected); **request #31 onward got `429
  {"error_code":"over_request_rate_limit","msg":"Request rate limit
  reached"}`**, 15/15 for the remainder — exactly matching the
  documented 30-request burst. The real code itself was also `429`'d
  immediately after (rate limit applies regardless of whether the guess
  would've been correct). Confirms the throttle is real, active, and
  per-source-IP, not merely documented.
- **Severity: LOW, closed.** A single source IP gets ~30 guesses before
  being cut off for the refill window — serial brute force of 10^8
  combinations from one IP is not remotely practical. Residual risk is
  the same accepted trade-off already documented for D4/1.1 (a
  genuinely distributed attacker with many real source IPs gets an
  independent 30-guess budget per IP) — not a new gap, and not
  something Arkonomy's own code could add on top of a platform-level,
  non-customizable control anyway.
- **Recommendation:** none open. Checked the Dashboard
  (`/project/_/auth/rate-limits`) to see whether this specific limit has
  a UI toggle — it doesn't (confirmed both by the docs' "Customizable:
  No" and by the fact the page requires its own login the assistant
  correctly declined to perform on the user's behalf) — nothing to
  configure, the fixed platform default is already doing its job.

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

### T3. Stripe/Plaid webhook replay or payload tampering — **Stripe side re-verified and fixed 2026-08-17**
- **Entry point:** `stripe-webhook`, `plaid-webhook` — same entry points as S2.
- **Current mitigation:** signature verification (S2) prevents payload tampering —
  any modified byte in the body invalidates the signature. Stripe's SDK-level
  `constructEventAsync` also implicitly bounds replay risk via its timestamp
  tolerance. **Idempotency — actually re-verified this time, not assumed:** the
  earlier "Item 6, closed" note in CLAUDE.md turned out to be about Stripe's own
  API-level idempotency keys (for outgoing calls Arkonomy makes to Stripe), not
  about `stripe-webhook` deduplicating *incoming* redelivered events — those are
  different things. Read `stripe-webhook/index.ts` line by line for the
  race-condition audit (2026-08-17) and found no `event.id` dedup at all:
  `checkout.session.completed` computed `trial_ends_at = now() + 7 days` fresh on
  every delivery, so a plain Stripe retry (non-2xx, timeout, or a manual dashboard
  resend — no attacker needed) would silently re-extend the trial each time. Fixed
  same day: `stripe_webhook_events(event_id PRIMARY KEY)` table
  (`20260817000000_stripe_webhook_events.sql`), inserted before any side effect;
  a `23505` conflict short-circuits to `{received: true, duplicate: true}`. Applies
  to all 5 event types the handler processes, not just the one that was provably
  broken. See T5 for a related, deliberately-accepted gap this fix introduced.
- **Recommendation:** confirm Plaid webhook handling is itself idempotent
  (a legitimately-retried webhook — Plaid does retry on non-2xx — shouldn't
  double-trigger `sync_item` in a way that duplicates data). Worth an explicit test
  rather than an assumption — not yet done, unlike the Stripe side above.

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

### T5. `stripe-webhook` dedup-insert and side-effects are not one transaction — partial-failure window
- **Entry point:** `stripe-webhook/index.ts`, the `stripe_webhook_events` insert
  added for T3, immediately followed by a separate, independently-committed
  `profiles` update per event type.
- **Scenario:** the dedup `INSERT` and the subsequent `UPDATE profiles` are two
  separate PostgREST requests, not one SQL transaction. If the function crashes
  or times out between them (after the insert commits, before the update does),
  the event is permanently marked "processed" in `stripe_webhook_events` but the
  actual effect (e.g. `plan: 'pro'`) never applied. A legitimate Stripe retry of
  that same `event.id` would then be silently ignored as a duplicate — the user's
  plan/trial state would be stuck wrong with no automatic recovery path.
- **Severity:** low-probability — requires the process to die in the narrow
  window between two specific network calls, not attacker-triggerable, and
  Sentry's `captureAndFlush` on any thrown error in the handler would surface
  the crash even if it doesn't fix the state. Deliberately accepted for now
  rather than fixed, per the same trade-off analysis as the fix's own inline
  comment: insert-before-processing (current choice) risks under-processing on
  partial failure; insert-after-processing risks the original double-processing
  bug (T3) instead. Neither ordering alone is fully safe without a shared
  transaction.
- **Recommendation:** if a stricter guarantee is ever needed, wrap the dedup
  insert and all side effects in a single Postgres RPC function (`SECURITY
  DEFINER`, called via `supabase.rpc(...)` instead of sequential `.from()`
  calls) so they commit or roll back together. Not done now — narrow window,
  and the added complexity of a stored-procedure code path isn't justified
  until this actually bites in production.

### T6. `alpaca-invest` — indeterminate order-placement outcome treated as failure, accepted risk
- **Entry point:** `alpaca-invest/index.ts`, the outer `catch (err)` block
  (originally FINDING-A of the 2026-08-17 race-condition audit — the fix for
  the double-order TOCTOU gap is what introduced this narrower, distinct
  gap).
- **Scenario:** the fix for FINDING-A reserves a `pending` row in
  `investments` before calling Alpaca, and releases it (`releasePending()`)
  on any failure path so a legitimate retry isn't permanently blocked. The
  `catch` block does not distinguish between two different kinds of
  failure: (1) Alpaca explicitly rejecting the order (`!orderRes.ok`, a
  definite "no" — safe to release) and (2) the order-placement `fetch()`
  call itself throwing (network timeout, connection reset, edge function
  execution timeout) before a response is ever read — an *indeterminate*
  outcome, since Alpaca's server may have already received and processed
  the request before the connection dropped. The `catch` currently releases
  the pending row in both cases identically.
- **Exploitation condition (not attacker-triggered — a timing accident):**
  requires the order-placement `fetch()` to time out or the connection to
  drop *after* Alpaca has actually placed the order server-side but
  *before* our edge function reads the response, **and** the user's retry
  to land in a different minute bucket (`window_bucket`/`client_order_id`
  changed) than the original attempt — otherwise Alpaca's own
  `client_order_id` dedup (kept as defense-in-depth) would still catch the
  retry. Both conditions together: rare, but not impossible — a real
  network blip lasting past a minute boundary is a plausible, if unlikely,
  coincidence.
- **Impact if triggered:** a second real order is placed at Alpaca, with no
  record of the first (successful) order anywhere in `investments` — the
  pending row for it was deleted. Real money impact (user is charged/buys
  twice), not just a display bug — this is why it's flagged here rather
  than silently accepted without documentation.
- **Severity:** low probability, but real financial impact if it occurs.
  Deliberately left as an accepted risk rather than fixed immediately —
  see Recommendation for why a real fix is a bigger lift than this specific
  bug warrants right now.
- **Recommendation:** a correct fix requires a background reconciliation
  job, not just smarter retry-blocking: on an indeterminate outcome, mark
  the row `status: 'indeterminate'` instead of deleting it, then
  periodically (e.g. a cron edge function) query Alpaca's order history API
  for any `client_order_id` matching an `indeterminate` row — if Alpaca
  confirms the order exists, promote the row to a real record (`order_id`,
  real status); if Alpaca confirms it does not exist, safe to delete. Not
  implemented now — this is real scope (a new cron function, Alpaca order-
  history API integration, a new row status and its own edge cases), not a
  small patch, and doesn't meet the bar to block this fix's release given
  how narrow the trigger window is.

### T7. `push-notify` — client-writable `push_subscription` weaponized into authenticated SSRF — **Fixed: verified 2026-08-21**
- **Entry point:** `supabase/functions/push-notify/index.ts`'s `sendPushNotification()`,
  reached from Mode 1 (`POST {user_id, title, body}`, self-service, no cron
  wait) and the 3 batch scans (recurring charges, savings reminders,
  scheduled payments).
- **Attack vector:** found during the pentest plan's SSRF sweep (2.1, full
  `fetch()` audit across all 23 functions). `sendPushNotification()` calls
  `webpush.sendNotification(subscription, ...)` (the `web-push` npm library),
  which does its own raw `fetch()` to `subscription.endpoint` — with no host
  validation of its own. `subscription` is read straight from
  `profiles.push_subscription`, which is on the client-writable column list
  (same GRANT audit as T1/E3) — an authenticated user can set it directly via
  PostgREST (`update({ push_subscription: { endpoint: '<anything>', keys:
  {...} } })`), bypassing the legitimate browser `PushManager` flow
  (`src/hooks/usePushNotifications.js`) entirely. Combined with Mode 1's
  self-service trigger, a user can make the edge function issue a
  server-side HTTP request to a host/port/path of their choosing, on demand.
- **Impact (pre-fix):** an authenticated (not anonymous) SSRF primitive —
  internal network probing from the edge function's own network, or using
  Arkonomy's infrastructure as a blind outbound proxy. Rated MEDIUM-HIGH:
  gated behind a real session (not unauthenticated), but genuinely
  reachable on demand, not a rare timing accident.
- **Fix:** `sendPushNotification()` now validates `subscription.endpoint`
  before any `webpush`/`fetch()` call — must be `https:` and its hostname
  must match a fixed allow-list of real push-service hosts
  (`fcm.googleapis.com`, `updates.push.services.mozilla.com`,
  `web.push.apple.com`, `*.notify.windows.com`), else it throws
  `BlockedPushEndpointError` before reaching `web-push`. All 4 call sites
  catch this distinctly (`reportIfBlockedEndpoint()`), log a Sentry
  **warning** (not error — could be a legitimate new push vendor) with the
  blocked hostname, and return `blocked_endpoint`/`invalid_endpoint` instead
  of falling through to the generic-failure or subscription-expired paths.
  Deployed (`push-notify` v57→v58), deploy verified independently via
  `mcp__supabase__get_edge_function` returning the actual deployed file
  content, not just trusting the CLI's "Deployed" message.
- **Live-verified 2026-08-21:** test account's `profiles.push_subscription`
  overwritten via service-role SQL to a webhook.site endpoint (safe external
  address, not internal/metadata — same effective write a real attacker
  gets via direct PostgREST, since the column is client-writable regardless
  of write path), then `push-notify` Mode 1 called with the test account's
  own JWT (`scripts/test-push-notify-ssrf-blocklist.mjs`), exactly as a real
  authenticated attacker would. Result: `HTTP 400 {"sent":0,"reason":
  "invalid_endpoint"}` — blocked before webhook.site was ever reached.
  Confirmed via 2 independent sources, not just the response body: (1)
  webhook.site's own request-log API (`GET /token/{uuid}/requests`) showed
  **0 requests received**, ruling out a false-negative where the block
  message is right but the request went out anyway; (2) a direct SQL read
  immediately after showed `push_subscription` still holding the test
  webhook.site value, unchanged — proving the code took the new
  `BlockedPushEndpointError` branch, not the pre-existing "410/404 →
  subscription expired, null it out" branch (which would have wiped the
  column and could have masked the real behavior). Test subscription
  restored to the real pre-test value (a genuine `fcm.googleapis.com`
  endpoint) via SQL afterward. **Not independently confirmed:** the Sentry
  warning event itself — no Sentry API/MCP access in this session, so the
  `Sentry.captureMessage()` call is verified by code-read only, not by
  observing the event land in the Sentry dashboard. If that matters,
  check the Sentry project for a `warning`-level "push-notify: blocked
  non-allow-listed subscription endpoint" event around the test's
  timestamp.
- **Recommendation:** the send-time allow-list is confirmed working
  end-to-end. Still open: the same allow-list check at write time
  (client-side hook and/or a DB constraint on `push_subscription`), as
  defense-in-depth so a blocked value is never even accepted into the
  column — not implemented now, flagged for later.

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

### I6. `savings_reminders.goal_id` — missing FK-ownership check, exploitable via `push-notify`'s service-role read — **Fixed 2026-08-16**
- **Entry point:** `src/components/Savings.jsx:83-86` (client upsert into
  `savings_reminders`), read by `supabase/functions/push-notify/index.ts:225-241`
  (service-role batch cron, RLS bypassed by definition).
- **Attack vector:** `savings_reminders`' RLS policy validated `auth.uid() =
  user_id` on the reminder row itself, but never checked that `goal_id` (FK to
  `savings.id`) actually belonged to that same user — Postgres FKs only enforce
  referential existence, not ownership. An authenticated attacker could bypass
  the UI and directly upsert `{ user_id: <themselves>, goal_id: <another user's
  real savings.id> }` — RLS's `WITH CHECK` passed it, since the row's own
  `user_id` matched the caller. `push-notify`'s batch mode then runs
  `.select('user_id, goal_id, amount, day_of_week, savings(name)')` under the
  service role (RLS bypassed entirely for the embedded `savings(name)` join),
  and pushes a notification containing the victim's real goal name to the
  attacker's own device (looked up via `r.user_id`, which is the attacker's own
  ID). Found during the IDOR audit driven by this threat model (2026-08-16) —
  discovered by tracing every client-supplied ID through to any service-role
  read that could resolve it without a re-check, not by guessing.
- **Impact (pre-fix):** narrow — leaks only the `name` field of another user's
  savings goal (not amount/balance), and requires the attacker to already know a
  specific victim's `savings.id` UUID (not exposed anywhere else in the app, so
  not trivially discoverable) — rated MEDIUM, not HIGH, for that reason.
- **Fix:** `supabase/migrations/20260816000000_savings_reminders_goal_ownership.sql`
  — `WITH CHECK` now also requires
  `EXISTS (SELECT 1 FROM savings WHERE savings.id = goal_id AND savings.user_id
  = auth.uid())`. Applied live via `mcp__supabase__apply_migration` (the
  `supabase db push` CLI path failed with a pre-existing, unrelated remote
  migration-history/local-directory drift — 26 versions the CLI expected
  locally and didn't find — left uninvestigated and unrepaired rather than
  force a `migration repair` on history this change didn't create). Verified
  live post-deploy via a direct `pg_policy` query — `with_check_expr` confirmed
  to contain the `EXISTS` clause, not just "the deploy command said success".
- **Recommendation:** none further open. Worth a periodic grep for this same
  shape elsewhere — any table with `user_id` scoping plus a second FK into
  another user-owned table is a candidate for the same gap (checked
  `transactions.category_id` for the same pattern during this audit — not
  exploitable, since no service-role function embeds `categories(name)`
  anywhere; category display uses a denormalized `category_name` column set
  independently by the client at insert time).

### I7. Legacy `service_role` key hardcoded in a migration file — **Historical incident, closed 2026-04-13** (confirmed dead, not just historically fixed)
- **Entry point:** `supabase/migrations/20260412065802_transaction_push_trigger.sql:17`
  (commit `87701be9`, 2026-04-12) — a `pg_net` trigger function hardcoded a
  full legacy-format `service_role` JWT (`v_key TEXT := 'eyJh...'`) to call
  the `push-notify` edge function from inside Postgres. File no longer exists
  in current `main` (removed at some point after), but the value is
  permanently in git history regardless of current HEAD state — found by the
  project's daily gitleaks full-history scan.
- **Verification, not assumption:** decoded the JWT payload directly —
  `{"iss":"supabase","ref":"hvnkxxazjfesbxdkzuba","role":"service_role",
  "iat":1773028365,"exp":2088604365}` — confirmed real, project-matching,
  full-admin credential, not a placeholder. Then tested the actual leaked
  key against the live API (`GET /auth/v1/admin/users` with the key as both
  `apikey` and `Authorization: Bearer`) rather than trusting the Supabase
  Dashboard's "Legacy HS256 (Previous Key): Revoked" label at face value —
  Dashboard's JWT Signing Keys section (session-token signing) and the API
  Keys section's legacy-key toggle are two related but distinct settings,
  and only the live-API test proves the specific leaked credential is
  actually rejected.
- **Result:** `HTTP 401`, body: `{"message":"Legacy API keys are disabled",
  "hint":"Your legacy API keys (anon, service_role) were disabled on
  2026-04-12T20:13:41.082883+00:00..."}`. The disable timestamp is ~13 hours
  after the leak commit — same-day, not a 4-month exposure window. The
  currently active `SUPABASE_SERVICE_ROLE_KEY` (`.env.local`, and the
  auto-injected edge function env var) is already the new `sb_secret_...`
  format, unrelated to and unaffected by this legacy key's status.
- **Recommendation:** none — confirmed closed, not just presumed closed.
  No rotation needed for the current active key. The migration file itself
  could still be deleted from the working tree if it hasn't been already
  (cosmetic — the dead key's presence in git history is permanent either
  way and no longer exploitable).

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

1. **D4** — login-lockout-as-targeted-DoS not verified in depth.
2. **I2** — `ai-chat` warm-isolate cross-request state leakage of
   `financialContext` (not just Sentry tags) not re-verified line-by-line.
3. **T2, T3, E4** — three "confirm the obvious-seeming thing is actually true"
   checks, not known gaps.
4. **I4** — 18 functions on single-static-origin CORS: real, but already correctly
   triaged as a functionality gap, not a security hole.
5. **R1** — no durable audit trail for successful account deletion (only failures
   are logged) — a genuine gap if compliance/support ever needs to answer "did
   this happen and when" after the row is gone.

**Process note, 2026-08-27:** `90eb11c3-c1e9-4241-8362-9e15ce231c33`
(`shevvik88@gmail.com`) was labeled "the test account" throughout this
document and `PENETRATION_TEST_PLAN.md` — that was wrong, it's the
maintainer's real personal account. Going forward, any test mutating auth
state or account data uses a disposable Supabase Auth user instead (see
`scripts/_lib-disposable-account.mjs`). Prior sessions' checks against it
were read-only/dry-run and stand as recorded.

**Fixed since the initial pass:**
- **E1** — `config.toml` now explicitly lists `check-bank-connection` and
  `delete-account` as `verify_jwt: true` (`f0ceeb2`, 2026-08-15).
- **I6** — `savings_reminders.goal_id` FK-ownership gap, found by a dedicated
  IDOR audit across all 23 edge functions + frontend direct-table CRUD driven
  by this document (2026-08-16), closed same day
  (`20260816000000_savings_reminders_goal_ownership.sql`). That audit also
  confirmed no equivalent gap exists elsewhere — see I6 for the full writeup
  and what else was checked and ruled out.
- **T7** — `push-notify`'s `subscription.endpoint` (from client-writable
  `profiles.push_subscription`) reached an unvalidated `fetch()` inside
  `web-push` — an authenticated SSRF primitive, found by the pentest plan's
  full fetch-URL sweep (2.1, 2026-08-21), fixed same day with a push-service
  host allow-list (`push-notify` v57→v58), live-verified same day against a
  real webhook.site target (0 requests received, confirmed via its own
  request-log API) — see T7 for full detail.
- **S5** — password-reset 8-digit `email_otp` on `/auth/v1/verify` initially
  looked unthrottled (pentest plan 1.4, 2026-08-27) because the test sample
  (15 requests) was under Supabase's documented 30-request IP burst; a
  45-request follow-up confirmed the real, active, non-customizable
  platform-level rate limit (`429 over_request_rate_limit` from request #31
  on) — no code change needed, see S5 for full detail.

**E3** (column-level GRANT audit on the 4 post-2026-07-18 tables) was checked in
full for this document, not left open — see E3 above. All 4 read line-by-line;
no gap found.

Nothing in this document rises to "stop and fix before anything else ships" — the
existing controls (RLS, column-level grants, webhook signatures, rate limiting,
CSP, PII scrubbing) cover the high-severity classes already. Treat the list above
as the next audit's starting checklist, not an incident queue.
