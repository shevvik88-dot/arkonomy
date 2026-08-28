# scripts/

Manual, disposable scripts — not part of the app, not run in CI.

## test-delete-account-apis.mjs

Proves the two external API calls `supabase/functions/delete-account`
makes (Stripe subscription cancel, Plaid `/item/remove`) actually work,
using Stripe **test mode** and Plaid **Sandbox** — fully isolated from
production. Does not call the deployed `delete-account` function and does
not use any production secret.

Run locally with your own test/sandbox keys (never commit them):

```powershell
$env:STRIPE_TEST_KEY = "sk_test_..."
$env:PLAID_CLIENT_ID = "..."
$env:PLAID_SANDBOX_SECRET = "..."
node scripts/test-delete-account-apis.mjs
```

```bash
STRIPE_TEST_KEY=sk_test_... PLAID_CLIENT_ID=... PLAID_SANDBOX_SECRET=... node scripts/test-delete-account-apis.mjs
```

Last verified: 2026-07-09 — both API contracts confirmed (Stripe cancel,
Plaid `/item/remove` success = `res.ok` + no `error_code`, not a `removed`
boolean — that field only existed in Plaid API versions 2019-05-29 and
earlier).

## _lib-disposable-account.mjs

Shared helper for any pentest script that needs to create sessions, change
a password, or otherwise mutate auth state. **Never use the real personal
account** (`90eb11c3-...` / `shevvik88@gmail.com`) for that — see
CLAUDE.md's Supabase rules. Creates/deletes a throwaway Supabase Auth user
via the Admin API (`SUPABASE_SERVICE_ROLE_KEY`, read from `.env.local`).

## test-refresh-token-rotation.mjs / test-password-change-session-invalidation.mjs / test-password-reset-token.mjs

PENETRATION_TEST_PLAN.md 1.2/1.3/1.4. Each creates its own disposable
account via the helper above, runs the live check, deletes the account
after. No env vars to set, no manual token retrieval — just:

```
node scripts/test-refresh-token-rotation.mjs
```

Last verified: 2026-08-27 — see PENETRATION_TEST_PLAN.md section 1 for
results.

## test-password-change-error-codes.mjs

Probed the exact GoTrue `error_code` values for wrong current-password
(`current_password_invalid`), new === old (`same_password`), weak new
password (`weak_password`), and missing current-password
(`current_password_required`) — used to map real codes into
`Profile.jsx`'s error messages instead of guessing. Disposable account,
same pattern as above.

Last verified: 2026-08-27.

## test-verify-endpoint-rate-limit.mjs

Follow-up to S5 (`SECURITY_THREAT_MODEL.md`) — sends 45 wrong-guess
`/auth/v1/verify` requests to confirm Supabase's documented, non-
customizable, IP-based token-bucket rate limit (burst 30) actually fires.
Disposable account. Confirmed live 2026-08-27: `429 over_request_rate_limit`
from request #31 on.
