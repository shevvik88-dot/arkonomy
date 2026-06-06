# Arkonomy Security Audit Report

## Summary of Findings

| Severity | Count | Areas |
|----------|-------|-------|
| 🔴 CRITICAL | 2 | Supabase RLS exposures (Plaid tokens, Alpaca tokens) |
| 🟠 HIGH | 1 | User enumeration on signup |
| 🟡 MEDIUM | 2 | Injection via email templates; account deletion orphans |
| 🔵 LOW | 2 | Open redirect risk in Stripe checkout; unprotected market-data |

## 1. RLS Policies
- **Finding**: `plaid_items` was readable client-side, leaking bank `access_token`.
- **Status**: 🔴 FIXED via migration `20260531000000_fix_rls_token_exposure.sql`.
- **Finding**: `profiles` had duplicate policies and exposed sensitive Alpaca tokens.
- **Status**: 🔴 FIXED via migration and code hardening.

## 2. Authentication & Privacy
- **Finding**: Signup flow leaked email existence via "User already registered" message.
- **Status**: 🟠 FIXED in `AuthScreen.jsx` with generic success messages.
- **Finding**: Account deletion left records in `auth.users` and `investments`.
- **Status**: 🟡 FIXED in `App.jsx` with admin Edge Function call.

## 3. Injection & Safety
- **Finding**: Email templates used unescaped user-controlled strings.
- **Status**: 🟡 FIXED in `weekly-report` and `generate-monthly-report` with `esc()` helper.
- **Finding**: Stripe redirects lacked hostname validation.
- **Status**: 🔵 FIXED in `UpgradeModal.jsx`.

## 4. Infrastructure & Robustness
- **Finding**: `market-data` Edge Function lacked JWT auth.
- **Status**: 🔵 FIXED in `market-data/index.ts`.
- **Finding**: Systemic lack of rate limiting across Edge Functions.
- **Status**: ⚠️ OPEN (Recommended Supabase dashboard enforcement).
- **Finding**: Raw error leakage in `catch` blocks.
- **Status**: ✅ FIXED across all Edge Functions.

## 5. Code Quality
- **Finding**: Unhandled promise rejections and missing try/catch in React components.
- **Status**: ✅ FIXED with centralized `logger` and robust try/catch blocks.
