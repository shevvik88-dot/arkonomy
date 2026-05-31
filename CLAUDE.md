# Arkonomy

## Current status (2026-05-31)
- Production live at app.arkonomy.com — last stable commit: `5e57f6e`
- QA audit complete: 12 security and stability fixes deployed
- Security: brute force lockout, user enumeration fix, Stripe URL validation, deleteAccount cleanup
- Stability: Error Boundary, bgSync race condition fix, chat loading state
- Refactored: cleanMerchantName extracted to src/utils/helpers.js (single source of truth)

## Next tasks (priority order)
1. **Merchant navigation** — tap a transaction in Dashboard "Recent Transactions" → navigate to Transactions screen filtered by that merchant (cleanMerchantName now in helpers.js)
2. **Notification preferences UI** — Settings screen section: frequency selector + email digest content toggles; table `notification_preferences` already exists in Supabase
3. **E2E testing** — Playwright tests for critical flows (auth, bank connection, transaction add)

## Self-improvement protocol
- После любой моей коррекции предложи лаконичное правило и допиши его в подходящую секцию этого файла.
- Формат правила: одно императивное предложение, без обоснования и без примеров, если случай не двусмысленный.
- Перед добавлением правила выполни поиск по файлу — не дублируй, а уточни существующее.
- Держи общий объём CLAUDE.md в пределах 2500 токенов; при превышении объедини пересекающиеся правила и удали устаревшие.
- После фикса бага записывай правило про класс корневой причины, а не про конкретный симптом.

---

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
- src/hooks/usePlan.js — free/pro plan gating via Supabase profiles table
- src/recurringDetector.js — recurring charges detection
- supabase/functions/ — edge functions (Finnhub market data, etc.)
- public/ — PWA manifest, service worker, icons

## Styling conventions
- Inline styles only via the C color object — no CSS files, no Tailwind.
- C is defined at top of App.jsx and passed down as needed.
- No external UI libraries (no MUI, no shadcn).
- Never hardcode hex values — always use the existing C color object.

## Storage conventions
- Chat history uses sessionStorage (key: arkonomy_chat_history) — clears on tab close; never switch to localStorage for this key.

## Coding rules
- One step at a time — show the change, wait for confirmation before proceeding.
- Never rewrite large blocks when a targeted edit suffices.
- Never change auth flow, Supabase schema, or Vercel config without explicit instruction.
- Never add TypeScript, CSS modules, or new dependencies without asking first.
- Keep components in the file where they are used unless explicitly asked to extract.
- When editing a file, re-read it first; never rely on stale context.

## Security decisions — DO NOT CHANGE without explicit instruction
- **plaid_items has NO SELECT RLS policy** — intentional. Removed during security audit to prevent `access_token` from being exposed to the client. Never add a SELECT policy back.
- **checkBankConnection() calls `check-bank-connection` edge function** (supabase/functions/check-bank-connection/) — uses service role key server-side, returns only `{ connected, institution_name, count }`. Never revert to direct `.from("plaid_items").select()` in the frontend.
- **Plaid env vars** — Production approval in progress; do not touch.
- **usePlan.js** — Free/Pro gating is core business logic; never bypass.

## Supabase rules
- Test user UUID: 90eb11c3-c1e9-4241-8362-9e15ce231c33
- Never run destructive migrations without showing the SQL first.
- RLS policies must be verified after any schema change.
- Edge functions deploy via: supabase functions deploy <name>
- Accounts cache key: `arkonomy_accounts_v1` (localStorage, 1hr TTL) — only cache non-empty arrays.

## Business context
- Free/Pro plan gating is core — never bypass or break usePlan.js logic.
- Plaid Production approval is in progress — do not touch Plaid env vars.
- App URL: app.arkonomy.com | Marketing: arkonomy.com
- Target market: US personal finance, competing with Copilot / Monarch.

## Communication style
- Respond in the same language the user writes in — Russian if they write Russian, English if English.
- Direct and informal — no filler, no apologies, no preamble.
- Provide exact ready-to-use code blocks.
- Ask before making architectural decisions.
