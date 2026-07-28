# PostHog post-wizard report

The wizard has completed a deep integration of PostHog analytics into Arkonomy. PostHog is initialized in `src/main.jsx` with `PostHogProvider` wrapping the entire app tree. Users are identified by their Supabase UUID on both login and page refresh (session restore), and reset on logout. 13 events are captured across 4 files, covering the full user journey from signup through bank connection, AI engagement, and monetization. The CSP in `vercel.json` was updated to allow PostHog's ingest and asset CDN domains.

| Event | Description | File |
|---|---|---|
| `user_signed_up` | User successfully submitted the email signup form. | `src/components/AuthScreen.jsx` |
| `user_logged_in` | User successfully authenticated via email/password or OAuth (Google/Apple). | `src/components/AuthScreen.jsx` |
| `bank_connected` | User successfully connected a bank account via Plaid after token exchange. | `src/App.jsx` |
| `ai_chat_opened` | User opened the AI financial advisor chat panel. | `src/App.jsx` |
| `upgrade_modal_viewed` | The Pro upgrade modal was displayed to the user. | `src/App.jsx` |
| `plan_upgraded` | User completed a Pro plan upgrade and returned from Stripe checkout. | `src/App.jsx` |
| `trial_started` | User started a Pro free trial and returned to the app. | `src/App.jsx` |
| `alpaca_account_connected` | User successfully connected their Alpaca investment brokerage account. | `src/App.jsx` |
| `subscription_ai_inquiry_started` | User tapped 'ask about subscription' to open AI chat about a specific subscription. | `src/components/Insights.jsx` |
| `merchant_alias_confirmed` | User confirmed a merchant alias merge to deduplicate a recurring payment. | `src/App.jsx` |
| `savings_goal_created` | User created a new savings goal. | `src/App.jsx` |
| `transaction_added` | User manually added a transaction. | `src/App.jsx` |
| `onboarding_completed` | User completed the onboarding flow (method: 'trial' or 'free'). | `src/components/OnboardingFlow.jsx` |

## Next steps

We've built some insights and a dashboard for you to keep an eye on user behavior, based on the events we just instrumented:

- **Dashboard**: [Analytics basics (wizard)](https://us.posthog.com/project/531321/dashboard/1915163)
- **Insight 1 — Signup → Bank Connection funnel**: [sq90BvkC](https://us.posthog.com/project/531321/insights/sq90BvkC)
- **Insight 2 — Signups and Logins over time**: [6ZGvgtb9](https://us.posthog.com/project/531321/insights/6ZGvgtb9)
- **Insight 3 — Trial starts and plan upgrades**: [UEh1VDG8](https://us.posthog.com/project/531321/insights/UEh1VDG8)
- **Insight 4 — AI chat and upgrade intent**: [kQ08qTmM](https://us.posthog.com/project/531321/insights/kQ08qTmM)
- **Insight 5 — Feature adoption: bank, savings, transactions**: [0cvj7Gr4](https://us.posthog.com/project/531321/insights/0cvj7Gr4)

## Verify before merging

- [ ] Run a full production build (the wizard only verified the files it touched) and fix any lint or type errors introduced by the generated code.
- [ ] Run the test suite — call sites that were rewritten or instrumented may need updated mocks or fixtures.
- [ ] Add `VITE_POSTHOG_PROJECT_TOKEN` and `VITE_POSTHOG_HOST` to `.env.example` and any monorepo/bootstrap scripts so collaborators know what to set.
- [ ] Add both env vars to Vercel's Production and Preview environment variable settings so the deployed bundle includes them (they are only in `.env.local` right now).
- [ ] Wire source-map upload (`posthog-cli sourcemap` or your bundler's upload step) into CI so production stack traces de-minify in PostHog.
- [ ] Confirm the returning-visitor path also calls `identify` — a handler that only identifies on fresh login can leave returning sessions on anonymous distinct IDs. The wizard's identify in `loadAll` covers this, but verify in a real session by logging out and back in, then checking PostHog's Person Profiles.
- [ ] This project has Supabase and Sentry data sources — run `npx @posthog/wizard warehouse` to connect them to PostHog's data warehouse.

### Agent skill

We've left an agent skill folder in your project. You can use this context for further agent development when using Claude Code. This will help ensure the model provides the most up-to-date approaches for integrating PostHog.
