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
