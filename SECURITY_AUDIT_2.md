# Arkonomy Security Audit #2 — Verification Report
**Date:** 2026-05-28  
**Scope:** Verify all 7 fixes from Audit #1 are live; identify new issues

---

## Critical note: fixes were in local code but NOT yet deployed

When the first round of HTTP tests ran, all 5 patched edge functions were still serving the **old vulnerable code** (HTTP 200 on unauthenticated requests, real financial data returned). The `supabase functions deploy` step had not been performed after editing. Functions were deployed during this audit and all subsequent tests passed.

**Lesson:** After editing any edge function, always run `npx supabase functions deploy <name> --project-ref hvnkxxazjfesbxdkzuba`.

---

## Audit #1 Fix Verification

### 1. Edge Function Auth — Live HTTP Tests

| Test | Endpoint | Attack | HTTP Before Deploy | HTTP After Deploy | Result |
|------|----------|--------|-------------------|-------------------|--------|
| No auth token | `get-insights` | `POST { userId: "..." }` | **200** (data returned) | **401** `{"error":"Unauthorized"}` | ✅ FIXED |
| Fake Bearer token | `get-insights` | `Authorization: Bearer invalid` | **200** (data returned) | **401** `{"error":"Unauthorized"}` | ✅ FIXED |
| Email exfiltration | `weekly-report` | `POST { userId, email: "attacker@evil.com" }` | **200** (report sent) | **401** `Unauthorized` | ✅ FIXED |
| Email exfiltration | `generate-monthly-report` | `POST { userId, email: "attacker@evil.com" }` | **200** (report sent) | **401** `{"error":"Unauthorized"}` | ✅ FIXED |
| Batch scan, no auth | `push-notify` | `POST {}` (no token) | **200** (scan ran) | **401** `{"error":"Unauthorized"}` | ✅ FIXED |
| Direct notify, no auth | `push-notify` | `POST { user_id: "..." }` (no token) | **200** | **401** `{"error":"Unauthorized"}` | ✅ FIXED |
| No webhook secret | `stripe-webhook` | No `stripe-signature` header | **200** (plan upgraded) | **400** `Missing stripe-signature` | ✅ FIXED |
| Wrong signature | `stripe-webhook` | `stripe-signature: t=123,v1=badhash` | **200** (plan upgraded) | **400** `Webhook Error: No signatures found` | ✅ FIXED |

> **stripe-webhook note:** Test 7 returned 400 (not 500), which means `STRIPE_WEBHOOK_SECRET` IS configured in production — the function correctly passed the "secret exists" guard and then rejected the request for having no `stripe-signature` header. This is correct behavior.

### 2. Code Verification (static analysis of deployed source)

| Fix | Check | Result |
|-----|-------|--------|
| `get-insights` — userId from body ignored | `buildFinancialInput` called with `user.id` from JWT, never `body.userId` | ✅ CONFIRMED |
| `weekly-report` — emailOverride removed | String `emailOverride` does not appear anywhere in file | ✅ CONFIRMED |
| `generate-monthly-report` — emailOverride removed | String `emailOverride` does not appear anywhere in file | ✅ CONFIRMED |
| `push-notify` — isCron guard before batch | `if (!isCron) return 401` at line 252, before any batch DB query | ✅ CONFIRMED |
| `stripe-webhook` — no silent fallback | No `JSON.parse(body)` fallback; missing secret → 500; bad sig → 400 | ✅ CONFIRMED |

### 3. plaid_items RLS — No Client-Facing Policies

Live DB query confirms zero policies on `plaid_items`:

```
tablename   │ policyname  │ cmd
────────────┼─────────────┼─────
(no rows)
```

✅ CONFIRMED — `access_token` column is unreachable from client sessions.

### 4. Duplicate RLS Policies Cleaned Up

| Table | Before | After |
|-------|--------|-------|
| `profiles` | 2× SELECT + 2× UPDATE | 1× SELECT (`profiles_owner_select`) + 1× UPDATE (`profiles_owner_update`) |
| `investments` | ALL + SELECT + INSERT | SELECT + INSERT only (ALL dropped — also removed unintended UPDATE/DELETE grants) |
| `plaid_items` | ALL + SELECT | (empty) |

✅ CONFIRMED — 17 clean policies remain, no duplicates, no overly-broad ALL grants.

---

## New Findings From This Audit

### 5. New Edge Functions — None
No functions were added since Audit #1. Directory contains exactly the same 15 functions.

### 6. Secrets in Client-Side Code — PASS
No hardcoded secrets, API keys, or credentials found in `src/`. All sensitive values flow from `import.meta.env.*` (Vite) or `Deno.env.get()` (edge functions).

### 7. CORS Headers — WARN (12/15 functions use `*`)

| CORS Policy | Functions |
|-------------|-----------|
| `*` (open) | `get-insights`, `weekly-report`, `generate-monthly-report`, `push-notify`, `stripe-webhook`, `plaid-get-accounts`, `plaid-batch-sync`, `stripe-checkout`, `alpaca-invest`, `stock-ai-analysis`, `market-data` (11 functions) |
| Origin allowlist | `plaid-link-token`, `plaid-exchange-token`, `plaid-sync-transactions` (these use `app.arkonomy.com`, `localhost:5173/4173/3000`) |
| None | `alpaca-oauth-callback` (redirect-only, no CORS needed) |

**Risk level: LOW.** `Access-Control-Allow-Origin: *` on these functions is mitigated by mandatory Bearer auth — a browser on a rogue origin gets a CORS preflight pass but its actual request is rejected with 401 if it has no valid JWT. However, defense-in-depth would tighten all functions to the same allowlist used by the Plaid functions.

### 8. Rate Limiting — NONE (systemic gap)

Zero of 15 functions implement any rate limiting. Highest-risk targets:

| Function | Risk |
|----------|------|
| `stock-ai-analysis` | Every request calls Anthropic API — no token cap, no per-user throttle. A valid user can run unlimited AI calls at your cost. |
| `get-insights` | Executes 4 parallel DB queries per call. No per-user throttle. |
| `market-data` | No auth AND no rate limit — Finnhub API key can be exhausted by anyone. |

**Recommended:** Add Supabase's built-in rate limiting (available in Dashboard → Edge Functions → Rate Limiting), or enforce a simple per-user token bucket in the function itself.

### 9. market-data — Still Unauthenticated (LOW, unchanged from Audit #1)
No auth check. Exposes Finnhub API key to unlimited quota abuse. No user data at risk. Mitigation: add a JWT check (one line) or restrict invocations to authenticated users only via Supabase dashboard settings.

---

## Final Scorecard

| Check | Audit #1 | Audit #2 | Status |
|-------|----------|----------|--------|
| `get-insights` JWT auth | ❌ FAIL | ✅ PASS | Fixed & deployed |
| `weekly-report` JWT auth + no emailOverride | ❌ FAIL | ✅ PASS | Fixed & deployed |
| `generate-monthly-report` JWT auth + no emailOverride | ❌ FAIL | ✅ PASS | Fixed & deployed |
| `push-notify` batch auth | ❌ FAIL | ✅ PASS | Fixed & deployed |
| `stripe-webhook` no silent fallback | ⚠️ WARN | ✅ PASS | Fixed & deployed |
| `plaid_items` no client SELECT on access_token | ❌ FAIL | ✅ PASS | Fixed (DB) |
| Duplicate RLS policies | ⚠️ WARN | ✅ PASS | Fixed (DB) |
| No new functions without auth | — | ✅ PASS | No new functions |
| No secrets in client code | ✅ PASS | ✅ PASS | Unchanged |
| CORS headers | ⚠️ WARN | ⚠️ WARN | Open finding |
| Rate limiting | ❌ NONE | ❌ NONE | Open finding |
| `market-data` unauthenticated | ⚠️ WARN | ⚠️ WARN | Open finding |

**All 7 Audit #1 fixes are confirmed live in production.**  
3 open findings remain (CORS, rate limiting, market-data) — none are data-exfiltration risks.
