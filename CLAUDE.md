# Arkonomy

## Self-improvement protocol

* После любой моей коррекции предложи лаконичное правило и допиши его в подходящую секцию этого файла.
* Формат правила: одно императивное предложение, без обоснования и без примеров, если случай не двусмысленный.
* Перед добавлением правила выполни поиск по файлу — не дублируй, а уточни существующее.
* Держи общий объём CLAUDE.md в пределах 2500 токенов; при превышении объедини пересекающиеся правила и удали устаревшие.
* После фикса бага записывай правило про класс корневой причины, а не про конкретный симптом.

\---

## Stack

* React 18 + Vite, plain JavaScript (no TypeScript)
* Supabase (auth, database, edge functions) — project: `hvnkxxazjfesbxdkzuba`
* Vercel — auto-deploy on push to main
* Plaid — bank integration, transaction sync
* Alpaca Markets — investing, Live API
* Resend — email (planned)

## Project structure

* `src/App.jsx` — main shell, routing, screen switching
* `src/main.jsx` — entry point, Error Boundary
* `src/hooks/usePlan.js` — free/pro plan gating via Supabase `profiles` table
* `src/engine/checkInEngine.js` — AI Financial Autopilot / insight signal engine (`activeSignals`, `isWarning`, `isPositive`) — moved here from `src/lib/`, still live
* `src/utils/recurringSummary.js` — recurring-payment detection — replaces `src/lib/recurringDetector.js`, deleted 2026-07-12 (see docs/changelog.md)
* `src/components/Insights.jsx` — includes local `sanitizeAiBody()` (line 78) that rewrites specific misleading AI phrases (e.g. "safely move $X") before display; not the same scope as the old `sanitizeCta()`/"language enforcement" description — that half of the old functionality wasn't found anywhere
* `src/lib/callEdgeFunction.js` — unified edge function caller; use instead of `supabase.functions.invoke()`
* `supabase/functions/` — edge functions (Finnhub market data, ai-chat, get-insights, etc.)
* `public/` — PWA manifest, service worker, icons

## Styling conventions

* Inline styles only via the `C` color object — no CSS files, no Tailwind.
* `C` is defined at top of App.jsx and passed down as needed.
* No external UI libraries (no MUI, no shadcn).
* Never hardcode hex values — always use the existing `C` color object.

## Coding rules

* One step at a time — show the change, wait for confirmation before proceeding.
* Never rewrite large blocks when a targeted edit suffices.
* Never change auth flow, Supabase schema, or Vercel config without explicit instruction.
* Never add TypeScript, CSS modules, or new dependencies without asking first.
* Keep components in the file where they're used unless explicitly asked to extract.
* When editing a file, re-read it first; never rely on stale context.

## Subagent usage policy

* First, check what subagents actually exist in this project (list them / check the subagent config) rather than assuming from memory.
* For any change touching production data, financial calculations, authentication, or Plaid/payment integration files: automatically run whichever available subagents are relevant (e.g. security review, code review, test running) on the diff BEFORE deploying — without waiting for an explicit request each time.
* Purely cosmetic/UI changes (styling, copy, layout) with no data or security surface: subagents stay optional/on-request.
* Rationale: pre-deploy subagent review has caught real bugs nothing else did — missing `ON DELETE CASCADE` on an FK, prompt injection via unescaped user text in a system prompt, an unbounded transaction fetch silently truncating at 1000 rows, missing rate limits. Worth being default for financially-sensitive code, not opt-in.

## Supabase rules

* UUID `90eb11c3-c1e9-4241-8362-9e15ce231c33` (`shevvik88@gmail.com`) is the **real personal account**, not an isolated test account — confirmed by the user 2026-08-27 after prior sessions/docs wrongly called it "the test account." Never mutate its auth state (password, sessions) or delete it for testing. Any test that creates sessions, changes credentials, or otherwise mutates auth state must use a freshly created disposable Supabase Auth user instead (see `scripts/_lib-disposable-account.mjs`); read-only checks against this account are fine.
* Never run destructive migrations without showing the SQL first.
* Wrap any standalone ADD CONSTRAINT or CREATE INDEX for an object already declared inline in a CREATE TABLE in an existence check (pg_constraint / pg_class lookup or IF NOT EXISTS).
* RLS policies must be verified after any schema change.
* See docs/security-log.md before touching auth, RLS, payment, or race-condition-sensitive code.
* Edge functions deploy via `supabase functions deploy <name>`.

## Business context

* Free/Pro plan gating is core — never bypass or break `usePlan.js` logic.
* Plaid Production approval is in progress — don't touch Plaid env vars.
* App URL: `app.arkonomy.com` | Marketing: `arkonomy.com`
* Target market: US personal finance, competing with Copilot / Monarch.

## Communication style

* Respond in Russian.
* Direct and informal — no filler, no apologies, no preamble.
* Provide exact ready-to-use code blocks.
* Ask before making architectural decisions.

## Reference docs (read when relevant, not by default)
* docs/coding-principles.md — 4 core coding principles with examples
* docs/architecture.md — detailed structure, styling/storage conventions
* docs/security-log.md — security design decisions and rationale
* docs/changelog.md — feature history
* docs/known-issues.md — known tech debt
