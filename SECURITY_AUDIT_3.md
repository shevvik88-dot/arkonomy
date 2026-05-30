# Arkonomy Security Audit #3 — Extended Attack Surface
**Date:** 2026-05-28  
**Vectors:** User enumeration · Brute force · JWT · IDOR · Stripe · Data deletion · XSS · Open redirects

---

## Summary

| # | Vector | Result | Severity |
|---|--------|--------|----------|
| 1 | User enumeration | ❌ FAIL | Medium |
| 2 | Brute force on sign-in | ❌ FAIL | Medium |
| 3 | JWT token handling | ⚠️ WARN | Low |
| 4 | IDOR — cross-user data access | ✅ PASS | — |
| 5 | Stripe — subscribe as another user | ✅ PASS | — |
| 6 | Account deletion completeness | ⚠️ WARN | Medium |
| 7 | XSS — browser | ✅ PASS | — |
| 7b | XSS — email templates | ⚠️ WARN | Low |
| 8 | Open redirects | ⚠️ WARN | Low |

---

## 1. User Enumeration — ❌ FAIL

**Sign Up with existing email** (`src/components/AuthScreen.jsx:147`)

Supabase returns the string `"User already registered"` for duplicate email sign-ups. The app's `friendlyError()` function (lines 117–123) only maps three specific error strings (`"missing email or phone"`, `"invalid login credentials"`, `"email not confirmed"`). Everything else passes through verbatim. Result: the UI shows **"User already registered"** to any unauthenticated visitor who submits a sign-up form, confirming that the email exists in the system.

**Forgot Password** — partial pass: `supabase.auth.resetPasswordForEmail()` returns a generic success response regardless of whether the email exists (Supabase default behaviour). No enumeration on this path today. However, if Supabase returns a distinct error in edge cases, `friendlyError()` would display it raw.

**Fix:** In `friendlyError()`, map all sign-up errors to a single generic message:
```js
if (mode === "signup") return t("auth.error_generic_signup");
```
Or specifically for the duplicate case: map `"user already registered"` to `"Check your inbox — we sent a confirmation link"` (same message shown for new accounts, indistinguishable).

---

## 2. Brute Force on Sign In — ❌ FAIL

**`src/components/AuthScreen.jsx:135–154`** — no attempt counter, lockout counter, backoff timer, or UI disable after N failures. The `loading` flag only blocks the button during a single in-flight network request. Once the response returns (immediately, with an error), the button is re-enabled and the user can submit again immediately.

Brute-force protection depends entirely on Supabase's server-side IP-based rate limiter. Supabase's default is 10 sign-in attempts per hour per IP — this is a real protection, but:
- It's per-IP, not per-account. Distributed attacks from many IPs are unconstrained.
- It provides no user-visible feedback ("your account is temporarily locked"), creating confusion.

**Fix:** After 5 consecutive failed sign-in attempts, add a 30-second client-side cooldown using the same `cooldown` / `timerRef` pattern already in place for email resend (lines 98–106). This doesn't stop server-side attacks but closes the trivial client-side case and improves UX on lockout.

---

## 3. JWT Token Handling — ⚠️ WARN

**Session storage:** `src/utils/supabase.js:5` — `createClient(URL, KEY)` with no `auth.storage` override. Supabase JS v2 defaults to **`localStorage`**. The JWT access token and refresh token are persisted in `localStorage`, readable by any JavaScript on the page. If a stored XSS were ever introduced, the full session would be exfiltrable.

**Current XSS surface:** Low — no `dangerouslySetInnerHTML` found anywhere in `src/`, so there is no known path to stored XSS today (see Q7).

**No manual token storage:** No `localStorage.setItem('token', ...)` outside the Supabase client found. Session refresh is handled automatically by the SDK.

**Token expiry:** Supabase default is 1-hour access tokens with automatic silent refresh via the refresh token. We could not query `auth.config` directly, but the `onAuthStateChange` listener in `src/App.jsx:458` will receive `TOKEN_REFRESHED` events and keeps the session live automatically.

**Token used as Bearer:** `src/App.jsx` passes `session.access_token` as `Authorization: Bearer` to edge functions — correct pattern, never stored manually.

**INFO — anon key as fallback Bearer:** `src/App.jsx:833` — `const token = session?.access_token ?? SUPABASE_KEY`. This sends the anon key when there is no session. Live test confirms edge functions correctly reject it with 401 (anon key does not resolve to a user via `auth.getUser`), so no privilege escalation. But it is semantically incorrect and will silently fail if the endpoint ever tightens auth.

---

## 4. IDOR — Cross-User Data Access — ✅ PASS

All paths verified:

| Path | Check | Result |
|------|-------|--------|
| `stripe-checkout` | `client_reference_id` = `user.id` from JWT, body not parsed | ✅ |
| `alpaca-invest` | Profile fetched with `.eq('id', user.id)` from JWT | ✅ |
| `get-insights` | Body `userId` explicitly ignored; `user.id` from JWT used | ✅ |
| `App.jsx loadAll()` | All queries use `.eq("user_id", user.id)` from session | ✅ |
| RLS policies | Every table enforces `auth.uid() = user_id` at DB level | ✅ |

**Live test:** `GET /get-insights` with the Supabase anon key as Bearer → **401**. The anon key is a publishable token that does not resolve to any user identity via `auth.getUser()`.

Double protection on every data path: explicit `user_id` filter in the query *and* RLS at the DB level.

---

## 5. Stripe — Subscribe as Another User — ✅ PASS

**`supabase/functions/stripe-checkout/index.ts:31–52`**

1. `Authorization` header required — missing → 401
2. `supabase.auth.getUser(token)` validates the JWT
3. `client_reference_id: user.id` and `customer_email: user.email` come exclusively from the JWT-resolved user
4. Request body is never parsed — no `userId` accepted from the caller

**Live test:** `POST /stripe-checkout` with no auth → **401**. No path to create a subscription for another account.

---

## 6. Account Deletion — ⚠️ WARN (two gaps)

`src/App.jsx:786–800` explicitly deletes: `transactions`, `savings`, `categories`, `plaid_items`, `profiles`.

**Database cascade coverage (from FK schema):**

| Table | On profiles DELETE | Covered? |
|-------|--------------------|---------|
| transactions | CASCADE | ✅ (also deleted explicitly) |
| categories | CASCADE | ✅ (also deleted explicitly) |
| savings | CASCADE | ✅ (also deleted explicitly) |
| savings_reminders | CASCADE via savings | ✅ |
| plaid_items | FK → `auth.users`, not profiles — **no cascade** | ✅ deleted explicitly in code |
| **investments** | FK → `auth.users`, not profiles — **no cascade** | ❌ **not deleted in code** |

**Gap 1 — `investments` table not deleted.** The `deleteAccount` function has no `supabase.from('investments').delete().eq('user_id', user.id)` call. After account deletion, Alpaca order records remain orphaned in the DB.

**Gap 2 — `auth.users` record not removed.** `supabase.auth.admin.deleteUser()` is never called. The profile row in `public.profiles` is deleted, but the upstream identity in `auth.users` is left intact. This means:
- The email remains registered in Supabase Auth
- Re-registration with the same email triggers "User already registered" (confirms the enumeration issue)
- Orphaned auth records accumulate

**Fix for Gap 1:** Add to `deleteAccount`:
```js
await supabase.from('investments').delete().eq('user_id', user.id);
```

**Fix for Gap 2:** Call the Supabase admin delete user API from an edge function (requires service role key — cannot be done from the client). Create a `delete-account` edge function that validates the user JWT, then calls `supabase.auth.admin.deleteUser(user.id)` with the service role client.

---

## 7. XSS — ✅ PASS (browser) / ⚠️ WARN (email)

**Browser — PASS**
- `dangerouslySetInnerHTML` not found anywhere in `src/`
- All transaction names, AI chat responses, category names, and user-supplied strings are rendered as React text children (safe by default — React escapes HTML entities)
- AI responses in `Chat.jsx` rendered as `{m.text}`, not raw HTML

**Email templates — WARN**
Three edge functions interpolate user-controlled strings directly into HTML without escaping:

| Function | Unescaped value | Line |
|----------|----------------|------|
| `weekly-report` | `name.split(' ')[0]` (profile full_name) | `buildEmailHtml:line 266` |
| `weekly-report` | `c.name` (category names from DB) | `buildEmailHtml:line 253` |
| `generate-monthly-report` | `firstName` (profile full_name) | `buildEmailHtml:line 609,623` |

If a user's `full_name` contains `<b>bold</b>` or `<img src=x onerror=...>`, it renders in the email. Email clients typically strip `<script>` but may render arbitrary HTML. This could cause visual phishing in emails (fake UI elements). It is **not** a browser XSS.

**Fix:** Add a one-liner HTML escaper to both functions:
```ts
const esc = (s: string) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
```
Then use `esc(firstName)`, `esc(c.name)` in all email templates.

---

## 8. Open Redirects — ⚠️ WARN (one low-risk instance)

| Location | Redirect target | User-controlled? | Risk |
|----------|----------------|-----------------|------|
| `AuthScreen.jsx:130` | `window.location.origin` (OAuth) | No — current origin | ✅ Safe |
| `AuthScreen.jsx:145,160,172` | Hardcoded `https://app.arkonomy.com` | No | ✅ Safe |
| `alpaca-oauth-callback` | `APP_URL` constant = `https://app.arkonomy.com` | No | ✅ Safe |
| `OnboardingFlow.jsx:228` | `window.location.origin + "?trial_started=true"` | No | ✅ Safe |
| **`UpgradeModal.jsx:83`** | `data.url` from edge function response | **Indirect** | ⚠️ |

**`UpgradeModal.jsx:83`:** `window.location.href = data.url` where `data.url` is the Stripe Checkout URL returned by the `stripe-checkout` edge function. The URL comes from Stripe's API (not from user input), so it is not directly user-controlled. However, the client does not validate that `data.url` is a `https://checkout.stripe.com/` URL before following it. If the edge function response were tampered with (compromised CDN, network interception without HTTPS, future bug), an arbitrary URL could be followed.

**Fix (defense-in-depth):**
```js
const url = new URL(data.url);
if (url.hostname !== 'checkout.stripe.com') throw new Error('Unexpected redirect URL');
window.location.href = data.url;
```

---

## Prioritised Fix List

| Priority | Severity | Finding | Fix |
|----------|----------|---------|-----|
| 1 | Medium | User enumeration via "User already registered" on sign-up | Map all sign-up errors to generic message in `friendlyError()` |
| 2 | Medium | No brute-force protection on sign-in | Add 30s client-side cooldown after 5 failed attempts |
| 3 | Medium | `investments` not deleted on account deletion | Add `delete().eq('user_id', user.id)` to `deleteAccount` |
| 4 | Medium | `auth.users` record not removed on account deletion | Create `delete-account` edge function using `admin.deleteUser()` |
| 5 | Low | Unescaped HTML in email templates | Add `esc()` helper to `weekly-report` and `generate-monthly-report` |
| 6 | Low | Stripe redirect URL not domain-validated | Add `checkout.stripe.com` hostname check in `UpgradeModal.jsx` |
| 7 | Low | JWT in `localStorage` | Consider `auth.storage: sessionStorage` if session-persistence is not required, or accept as-is given no current XSS vector |
| 8 | Info | No client-side brute-force feedback | Add visible lockout message pointing users to "wait 30s" |
