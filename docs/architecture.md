# Arkonomy — Architecture / project structure, full detail

Extracted from CLAUDE.md on 2026-08-19 to keep the root file short. The
compressed pointer list lives in CLAUDE.md's "Stack essentials" section;
this is the full original wording including the historical asides that
explain *why* a file looks the way it does.

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
- src/lib/appCheck.js — Firebase App Check init (reCAPTCHA v3); **orphaned, not imported anywhere** (disabled in `66ea690`, see docs/changelog.md)
- src/lib/callEdgeFunction.js — unified edge function caller; injects auth + apikey (does NOT inject an App Check token, despite older docs here saying otherwise); use instead of supabase.functions.invoke()
- src/hooks/usePlan.js — free/pro plan gating via Supabase profiles table
- src/utils/recurringSummary.js — single source for recurring-payment detection: `computeRecurringSummary` (subscriptions/regularPayments/possiblyCancelled), `getUpcomingCharges`/`getUpcomingCardPayments` (next-charge date projection, feeds the Home carousel + Cash Flow Forecast), `findDuplicateSubscriptions`/`findMerchantAliasCandidates` (merchant_aliases merge). `src/recurringDetector.js` (the old, independent, alias-unaware detector) was deleted 2026-07-12 — both its consumers migrated to this file.
- src/utils/lessons.js — Today's Lesson content + logic: `LESSONS` (12 curated, English-only for v1), `getTodaysLesson()`, `computeNextStreak()` (pure, no I/O), `getPersonalizedLessonNote()`.
- supabase/functions/ — edge functions (Finnhub market data, ai-chat, etc.)
  - supabase/functions/_shared/appCheck.ts — JWKS-based App Check JWT verification (RS256); **defined but not called by any function** (disabled in `66ea690`, see docs/changelog.md)
  - supabase/functions/ai-chat/ — AI chat endpoint; version-controlled, deploy via `npx supabase functions deploy ai-chat`
- public/ — PWA manifest, service worker, icons

## Styling conventions
- Inline styles only via the C color object — no CSS files, no Tailwind.
- C is defined at top of App.jsx and passed down as needed.
- No external UI libraries (no MUI, no shadcn).
- Never hardcode hex values — always use the existing C color object.

## Storage conventions
- arkonomy_chat_history: sessionStorage (not localStorage), intentional — scoped to tab, no persistence across sessions/tabs, cleared on signOut() and deleteAccount(). Contains AI chat history referencing financial context (balances, subscriptions) but never Plaid/Stripe/Alpaca tokens (those never reach the client — see docs/security-log.md: `plaid_items` has no SELECT RLS policy, `alpaca_access_token`/`alpaca_refresh_token` are never SELECTed client-side).
- Related: CodeQL alert #7 "Clear text storage of sensitive information" — dismissed as accepted risk (2026-08-15), see App.jsx:1290 comment.
- arkonomy_diagnosis_lesson_<userId>_<date>: localStorage (not sessionStorage) — deliberate exception to the pattern above, via `src/utils/diagnosisLessonCache.js`. Needs to survive a same-day reload (the whole point is avoiding a re-fetch/re-Claude-call on every Dashboard mount), which sessionStorage's tab-scoping would defeat. Contains the Financial Diagnosis Phase 2 AI-generated lesson (real dollar figures, a referenced transaction). Kept safe the same way accountsCache.js is: explicitly cleared on signOut()/deleteAccount(), and self-prunes any non-today key for the user on every read so it can't accumulate one key per user per day forever (added 2026-08-23, security-auditor finding on daily-lesson-v2).
