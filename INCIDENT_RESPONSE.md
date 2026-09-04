# Arkonomy — Incident Response Runbook

Created 2026-09-03. This runbook is **generalised from real incident work
already done on this project**, not written from theory:

- **I7** — a legacy `service_role` JWT found hardcoded in git history by the
  daily gitleaks full-history scan. Decoded, verified against the live API,
  confirmed already dead. (`SECURITY_THREAT_MODEL.md` I7.)
- **T7** — `push-notify`'s `subscription.endpoint` (from the client-writable
  `profiles.push_subscription` column) reaching an unvalidated `fetch()`
  inside `web-push` — an authenticated SSRF primitive found during the
  pentest-plan SSRF sweep, fixed and live-verified the same day.
  (`SECURITY_THREAT_MODEL.md` T7.)

The step patterns below (decode the credential, test it empirically against
the live system rather than trusting a dashboard label, verify the fix from
an independent source of truth) are exactly what those two responses used.

> **Golden rule, learned repeatedly this project** (`CLAUDE.md`): *"Succeeded"
> on one layer ≠ "actually worked" on the next.* A dashboard label, a CLI
> "Deployed" message, a "0 vulnerabilities" report — none of these is proof.
> Verify every claim against an independent source: the live API, a direct
> SQL read, `mcp__supabase__get_edge_function` returning the actual deployed
> file, the third party's own request log.

---

## 0. First 15 minutes (any incident type)

1. **Write down the clock.** Note the time you became aware, in UTC, and how
   (gitleaks alert / Sentry / user report / manual review). Every timestamp
   below is measured against this.
2. **Don't destroy evidence.** Do not force-push, rewrite history, delete
   log lines, or rotate anything yet — first capture what you can see
   (screenshots, `git log`, log exports). Rotation comes after scope
   assessment unless the credential is *actively* being abused right now.
3. **Classify** (§1) — this picks the checklist.
4. **Decide blast radius**: does this touch money (Stripe/Alpaca), bank data
   (Plaid), or auth (Supabase)? If yes, assume the worst until scope
   assessment says otherwise.
5. **Open a scratch incident log** — a plain file in `scratchpad/` or a
   private gist: timeline, what was checked, what each check returned. This
   becomes the `SECURITY_THREAT_MODEL.md` entry in §4.

---

## 1. Incident classification

| # | Type | Typical trigger | Checklist |
|---|---|---|---|
| A | **Secret / credential leak** — an API key, `service_role`, JWT, webhook secret, or token exposed in git history, a log, a bug report, a screenshot, or a public scan | daily gitleaks full-history scan; GitHub secret-scanning alert; a key pasted into an issue/PR/Slack | §2.A |
| B | **Compromised user account** — a real user's session/credentials in someone else's hands (phished, cred-stuffed, session token stolen) | user report ("I didn't do that"); impossible-travel login; a support ticket about unexpected trades / plan changes / bank unlinks | §2.B |
| C | **Exploitable vulnerability found in production** — a concrete, reproducible bug that lets an attacker cross a trust boundary (IDOR, SSRF, authz bypass, injection), whether found by us, a researcher, or in the wild | pentest-plan finding; security-auditor subagent; external disclosure; anomalous data in a table | §2.C |
| D | **Suspicious activity in Sentry / logs** — a spike, a novel error shape, repeated 4xx/5xx from one source, an unexplained state change, without (yet) a known root cause | Sentry alert; a weird pattern in `mcp__supabase__get_logs`; PostHog funnel anomaly; a cron function behaving oddly | §2.D |

An incident can be more than one type at once (a leaked key → suspicious
activity → compromised accounts). Run the checklists in that order.

---

## 2. Per-type checklists

Each has the same four phases: **Contain → Assess scope → Rotate → Verify**.

### 2.A — Secret / credential leak

#### A.1 Identify exactly what leaked

- **Decode it before doing anything else.** For a JWT (`eyJ...`), decode the
  payload — this tells you the type, project, role, and validity window:

  ```bash
  # header + payload only, no verification needed to read the claims
  echo "$LEAKED_JWT" | cut -d. -f2 | base64 -d 2>/dev/null | jq .
  ```

  Real example (I7): the leaked value decoded to

  ```json
  {"iss":"supabase","ref":"hvnkxxazjfesbxdkzuba","role":"service_role",
   "iat":1773028365,"exp":2088604365}
  ```

  — a real, project-matching, full-admin credential with a 10-year expiry.
  `iat`/`exp` are Unix seconds: `date -d @1773028365 -u`.

- For a non-JWT key, identify by **prefix**: `sb_secret_...` (Supabase
  service role, new format), `sb_publishable_...` (Supabase publishable —
  *safe to be public by design*), `sk_live_...` / `sk_test_...` (Stripe
  secret), `whsec_...` (Stripe webhook secret), `pk_live_...` (Stripe
  publishable — public by design), `AIza...` (Google/Firebase),
  Plaid/Alpaca client secrets are opaque hex/base64.

- **Where and since when.** For git history:

  ```bash
  git log --all --oneline -S "$LEAKED_FRAGMENT"          # commits that added/removed it
  git log --all --format='%H %cI' -1 -S "$LEAKED_FRAGMENT" # first commit + its ISO date
  ```

  The leak's exposure window is *first commit date → now* (or → the date it
  was disabled/rotated). In I7 the window turned out to be ~13 hours because
  the key had been platform-disabled the same day it was committed — but you
  only know that after A.3.

#### A.2 Contain

- If the secret is **still valid and high-privilege** (`service_role`,
  Stripe secret, Plaid secret, Alpaca client secret): begin rotation
  (A.4) **now**, in parallel with scope assessment. Do not wait.
- If it's a **webhook secret** (`whsec_...`): rotation is low-risk and fast
  — do it immediately; third parties retry failed deliveries.
- If it's **publishable / by-design-public** (`sb_publishable_...`,
  `pk_live_...`, a referrer-restricted Firebase key): no emergency. Confirm
  it's genuinely the public kind (A.1), note it, move to A.3 at normal pace.
- Do **not** delete the offending file/commit yet — the value is already
  permanent in history and GitHub's cache; deleting it now only loses
  forensic context. Clean the working tree later.

#### A.3 Assess scope — *was it actually used?*

The I7 method: **test the leaked credential against the live system
directly. Do not trust the dashboard's "Revoked" label.**

- **Supabase key** — hit an admin endpoint with the leaked key as *both*
  headers (Supabase checks both):

  ```bash
  curl -s -o /dev/null -w '%{http_code}\n' \
    "https://<ref>.supabase.co/auth/v1/admin/users?page=1&per_page=1" \
    -H "apikey: $LEAKED_KEY" -H "Authorization: Bearer $LEAKED_KEY"
  ```

  In I7 this returned `401 {"message":"Legacy API keys are disabled",
  "hint":"...disabled on 2026-04-12T20:13:41.082883+00:00..."}` — proof the
  key was dead *and* the exact disable timestamp. A `200` with a user list
  would mean it's live and you're now in a much worse incident.

  **Dashboard gotcha (real, from I7):** Supabase's *"JWT Signing Keys"*
  section (session-token signing) and the *"API Keys"* section's
  legacy-key toggle are **two different settings**. Only the live-API test
  proves the specific leaked credential is rejected.

- **Stripe secret key** — `curl https://api.stripe.com/v1/charges?limit=1 -u
  "$LEAKED_KEY:"` → `200` means live. Then in the Stripe Dashboard →
  Developers → **Logs**, filter by API key and by the exposure window: any
  request you don't recognise (especially from an unfamiliar IP or
  user-agent) is a hit.

- **Plaid secret** — `POST /categories/get` (a harmless authenticated call)
  with the leaked `client_id`/`secret`; `200` = live. Plaid Dashboard →
  Activity for anomalous item creation / token exchanges.

- **Alpaca client secret** — try the OAuth token endpoint; check Alpaca's
  dashboard for OAuth grants you didn't initiate.

- **Blast-radius query on our own data** (was the key used *through* us?):

  ```
  mcp__supabase__get_logs        # Postgres / edge / auth logs for the window
  mcp__supabase__query_logs      # filtered
  mcp__supabase__get_advisors    # type: security — catches new RLS gaps
  ```

  Direct SQL for state that shouldn't have changed:

  ```sql
  -- e.g. plan escalations, token writes, admin-only column changes in the window
  select id, plan, stripe_customer_id, updated_at
  from profiles
  where updated_at between '<leak_start>' and now()
  order by updated_at desc;
  ```

- **Sentry** — access gap, be explicit: this project currently has **no
  Sentry API/MCP access** (noted three times during the session's work).
  Scope assessment in Sentry is **manual, in the dashboard**: filter Issues
  by the incident window, look for a spike or a novel error shape, and for
  events tagged with the affected `function_name`. `_shared/sentry.ts`
  scrubs `amount`/`balance`/`email`/token-shaped keys, so Sentry will **not**
  show you the exact values in a suspicious request — pivot to Supabase
  logs / DB rows for that (`SECURITY_THREAT_MODEL.md` R3).

#### A.4 Rotate — order matters

Rotate the leaked credential's **own** type first, then anything that
*depends on it*, then anything that merely lives near it (rotate-the-blast-
radius is a judgement call — do it if abuse is confirmed or the exposure
window is long).

| Credential | Where to rotate | What breaks during the gap | Must update / redeploy after | Order notes |
|---|---|---|---|---|
| **Supabase `service_role`** (`sb_secret_...`) | Dashboard → Settings → API → roll `service_role` | every edge function (all use it via auto-injected `SUPABASE_SERVICE_ROLE_KEY`); local `scripts/*.mjs` that read `.env.local` | edge functions pick up the new auto-injected value on next deploy — **redeploy every function** (`mcp__supabase__list_edge_functions` for the current set); update `.env.local` for local scripts | rotate this **before** anything else if it leaked — it's total admin |
| **Supabase `anon` / publishable** (`sb_publishable_...`) | same section | the SPA's Supabase client; `apikey` header on every edge-function call | `vercel` env `VITE_SUPABASE_ANON_KEY` → redeploy frontend; edge functions read `SUPABASE_ANON_KEY` (auto-injected) → redeploy | publishable key is **public by design** — only rotate if you must invalidate an old one, not as an emergency |
| **Supabase JWT signing key** | Dashboard → Settings → API → JWT Keys → rotate | **every existing user session** is invalidated (all JWTs re-signed) | nothing to redeploy; users must re-log-in | high user impact — only for a confirmed session-forgery incident |
| **Stripe webhook secret** (`whsec_...`) | Stripe Dashboard → Developers → Webhooks → roll signing secret | `stripe-webhook` rejects all events (signature fail → `400`); Stripe **retries** for up to 3 days | `vercel`/Supabase env `STRIPE_WEBHOOK_SECRET` → **redeploy `stripe-webhook`** | fast, low-risk, do first among Stripe items; check `stripe_webhook_events` for a gap after |
| **Stripe secret key** (`sk_live_...`) | Stripe Dashboard → Developers → API keys → roll | `stripe-checkout` + `stripe-webhook` + any Stripe call | env `STRIPE_SECRET_KEY` → redeploy `stripe-checkout`, `stripe-webhook` | roll → deploy → **verify a test checkout** → *then* revoke the old key (Stripe lets both live briefly) |
| **Plaid `secret`** | Plaid Dashboard → Team Settings → Keys → rotate for the environment | all Plaid sync (`plaid-sync-transactions`, `plaid-batch-sync`, refresh, link, exchange) | env `PLAID_SECRET` → redeploy every `plaid-*` function | **Plaid Production approval is in progress — coordinate with whoever owns that before rotating** (`CLAUDE.md`) |
| **Alpaca OAuth client secret** | Alpaca OAuth app settings | `alpaca-oauth-callback` token exchange + per-user token *refresh* (not immediate use) | env `ALPACA_CLIENT_SECRET` → redeploy `alpaca-oauth-callback` | existing `profiles.alpaca_access_token` values keep working until they expire and can't be refreshed — users re-connect |
| **VAPID keys** (web push) | regenerate pair | every existing `push_subscription` becomes undeliverable | env `VAPID_*` → redeploy `push-notify`; client re-subscribes users on next load | high-friction; only for a confirmed VAPID-key compromise |
| **Firebase API key** (App Check, `AIza...`) | Firebase Console → Project Settings → rotate; keep referrer/package restrictions | App Check token minting on unlisted origins | `vercel` env + `src/utils/appCheck.js` if inlined | referrer-restricted → low urgency (open low finding in I7) |
| **`FINNHUB_API_KEY`**, **`RESEND_API_KEY`**, **`ANTHROPIC_API_KEY`**, **`SENTRY_DSN`** | each provider's dashboard | the one feature (market data / email / ai-chat / error reporting) | env + redeploy the specific function(s) | independent — no ordering constraints between them |

**After any rotation, confirm the new value is actually live** — don't trust
the deploy CLI:

```
mcp__supabase__list_edge_functions      # version bumped? verify_jwt unchanged?
mcp__supabase__get_edge_function <slug>  # returns the ACTUAL deployed file body
```

(This is exactly how the T7 `push-notify` fix deploy was confirmed — the CLI
said "Deployed", `get_edge_function` proved the new code was actually
running.)

#### A.5 Verify & close

- Re-run the A.3 live test against the **now-rotated** old credential —
  expect the same rejection I7 got (`401`, legacy/disabled).
- Confirm the app still works end-to-end on the new credential (a real
  login, a real Stripe test checkout, a Plaid sync, an ai-chat call — as
  applicable).
- Clean the working tree if the secret still sits in a tracked file (the
  history copy is permanent and now harmless).
- Go to §4.

---

### 2.B — Compromised user account

#### B.1 Contain

- **Revoke the user's sessions now.** Supabase Admin API:

  ```bash
  curl -X POST "https://<ref>.supabase.co/auth/v1/admin/users/$USER_ID/logout" \
    -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY"
  ```

  (or `DELETE .../admin/users/$USER_ID/sessions` depending on GoTrue
  version). This kills all refresh tokens; access tokens die at their next
  ~1h expiry.
- If trading/payments are in play, also **null the brokerage token** so an
  in-flight access token can't place orders:

  ```sql
  update profiles set alpaca_access_token = null, alpaca_refresh_token = null,
    alpaca_account_id = null, alpaca_connected_at = null
  where id = '<user_id>';
  ```

  (`alpaca-invest`/`-portfolio`/`-oauth-start` now gate on plan too — E4 — but
  don't rely on a single control.)
- Force a password reset: `POST /auth/v1/recover` for their email, or
  `PUT /auth/v1/admin/users/$USER_ID` with a new random password + tell them
  via a trusted channel.

#### B.2 Assess scope — *what did the attacker do while in?*

- **Auth log** — every login for this user in the window:

  ```
  mcp__supabase__get_logs   (auth)   — filter by user / email
  ```

  Look for a new IP / user-agent / country, and the first such event
  (that's when they got in).
- **State changes by this user in the window** — check each sensitive
  table with `updated_at`/`created_at` in range:

  ```sql
  select 'investments' t, id, symbol, amount, status, created_at
    from investments where user_id = '<uid>' and created_at >= '<t0>'
  union all
  select 'plaid_items', id::text, null, null, error_status, created_at
    from plaid_items where user_id = '<uid>' and created_at >= '<t0>'
  union all
  select 'profiles', id::text, plan, null, stripe_customer_id, updated_at
    from profiles where id = '<uid>' and updated_at >= '<t0>';
  ```

- **Stripe** — Dashboard → Customers → this customer: new subscriptions,
  payment methods, refunds, or a changed email in the window.
- **Alpaca** — if connected, check their Alpaca account's order history
  directly (Alpaca is the system of record — `SECURITY_THREAT_MODEL.md` R2)
  for orders with no matching `investments` row.
- **`push_subscription`** — was it overwritten (the T7 vector)? A non-vendor
  `endpoint` host means the account was used to probe:

  ```sql
  select push_subscription->>'endpoint' from profiles where id = '<uid>';
  ```

#### B.3 Rotate / remediate

- No shared credentials to rotate unless the attacker reached a shared
  secret (then → §2.A).
- If they placed real Alpaca orders: that's real money — §3 (Alpaca
  support), and the user needs to dispute via Alpaca's own statement.
- If they created a Stripe subscription / changed billing: §3 (Stripe),
  reverse via the Dashboard, refund if charged.
- Reset anything the attacker could have set: `monthly_budget`,
  `watchlist`, merchant aliases, scheduled payments — from a known-good
  prior state if you have one.

#### B.4 Verify

- Confirm the new sessions the *real* user creates work, and the attacker's
  refresh tokens are dead (try one if you captured it).
- Re-check the tables from B.2 show no new unexpected rows.
- §4 (as a user-security incident — may not need a T-entry unless it
  exposed a systemic gap, in which case that gap gets one).

---

### 2.C — Exploitable vulnerability found in production

This is the **T7 / I6 / E4 pattern** — the session did this repeatedly.

#### C.1 Contain

- **Assess reachability before panicking** (`CLAUDE.md`: *"vulnerability
  exists in a dependency" ≠ "vulnerability is reachable"*). Is the vulnerable
  path actually callable by an attacker with only a valid JWT (or less)? T7
  was reachable on demand → MEDIUM-HIGH. A dead code path → note and
  schedule, don't hotfix at 2am.
- If reachable and serious: the fastest containment is usually a **code
  fix + redeploy of the one function**, not disabling the feature. T7 went
  from found → fixed → deployed → live-verified in a day. If a fix isn't
  ready, options: tighten the RLS policy (`mcp__supabase__apply_migration`),
  flip `verify_jwt` on, or `REVOKE` a grant — whichever is a one-liner that
  closes the boundary.

#### C.2 Assess scope — *was it exploited before we found it?*

- **Reconstruct the exact attack** and look for its fingerprint in the data.
  T7's fingerprint would be a `profiles.push_subscription.endpoint` pointing
  at a non-push-vendor host:

  ```sql
  select id, push_subscription->>'endpoint' as endpoint
  from profiles
  where push_subscription->>'endpoint' !~ '(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|notify\.windows\.com)$';
  ```

  I6's fingerprint: a `savings_reminders` row whose `goal_id` points at a
  `savings.id` owned by a *different* `user_id`:

  ```sql
  select r.user_id, r.goal_id, s.user_id as goal_owner
  from savings_reminders r join savings s on s.id = r.goal_id
  where r.user_id <> s.user_id;
  ```

- **Logs for the exploit shape** — `mcp__supabase__get_logs` for the
  function, filtered to unusual request bodies / response codes over the
  plausible exposure window (which may be "since the vulnerable code
  shipped" — check `git log` for that function).
- **`mcp__supabase__get_advisors` (security)** — run it; it catches
  RLS/grant regressions that a migration may have introduced.

#### C.3 Fix, deploy, and prove the deploy

- Fix in code / migration. Keep the change minimal and targeted
  (`CLAUDE.md`).
- Deploy: `mcp__supabase__deploy_edge_function` (bundle the entrypoint +
  every `_shared/*.ts` it imports) or `mcp__supabase__apply_migration`
  (**not** `supabase db push` — this project has known local/remote
  migration-history drift, see I6).
- **Prove it deployed** from an independent source, not the CLI message:
  - edge function: `mcp__supabase__get_edge_function <slug>` → the returned
    file body must contain your change; `mcp__supabase__list_edge_functions`
    → version bumped, `verify_jwt` still what you intended.
  - migration / policy: query `pg_policy` / `pg_proc` directly —

    ```sql
    select polname, pg_get_expr(polwithcheck, polrelid) as with_check
    from pg_policy where polrelid = 'savings_reminders'::regclass;

    select prosecdef,
      has_function_privilege('anon', oid, 'EXECUTE') as anon,
      has_function_privilege('service_role', oid, 'EXECUTE') as svc
    from pg_proc where proname = 'check_and_increment_ip_rate_limit';
    ```

    (This is exactly how I6's `EXISTS` clause and 6.3's REVOKE/GRANT were
    confirmed — the deploy "succeeding" was not accepted as proof.)

#### C.4 Live-verify the fix by re-running the attack

The T7 standard: **recreate the exact attack vector with a disposable test
account, programmatically, and confirm an explicit refusal.**

- Use `scripts/_lib-disposable-account.mjs` — `createDisposableUser` /
  `passwordSignIn` / `deleteUser`. **Never** the real personal account
  (`shevvik88@gmail.com` / `90eb11c3-...`).
- Set up the malicious precondition the way a real attacker would (T7:
  overwrite `push_subscription.endpoint` via service-role SQL — same
  effective write an attacker gets via direct PostgREST, since the column is
  client-writable regardless of path).
- Fire the exploit call with the **test account's own JWT**.
- Assert the refusal on **more than one axis**:
  - the response itself (`HTTP 400 {"reason":"invalid_endpoint"}`),
  - **and** an independent source proving the side effect did *not* happen —
    T7 checked webhook.site's own request-log API (**0 requests received**)
    *and* a direct SQL read showing `push_subscription` unchanged (proving
    the *new* branch fired, not a pre-existing cleanup branch that would
    have masked it).
- Clean up: `deleteUser`, restore any row you mutated to its pre-test value.
- Commit the test as `scripts/test-<slug>-<finding>.mjs` so it's repeatable
  (not a scratch file) — see the existing `scripts/test-*.mjs`.

#### C.5 Close → §4.

---

### 2.D — Suspicious activity in Sentry / logs (no known root cause yet)

Goal: get from "something's weird" to a classified incident (A/B/C) or a
confident "benign".

1. **Bound it.** When did it start? Is it still happening? One source or
   many? `mcp__supabase__get_logs` / `query_logs` with a tight time filter;
   Sentry Issues filtered to the window (manual — no API access); PostHog
   via `mcp__claude_ai_PostHog__exec` for a user-behaviour angle.
2. **Characterise the shape.** One novel error type repeated = likely a bug
   or a probe. Many different 4xx from one IP = scanning. A state change
   with no corresponding legitimate request = authz/RLS problem → §2.C.
   A spike in `auth-login` failures for many emails from few IPs =
   credential stuffing → watch for §2.B.
3. **Check the guards that should have caught it:**
   - rate limits: `select * from rate_limits order by window_start desc` /
     `select * from ip_rate_limits order by window_start desc` — is a limit
     being hit, or being evaded?
   - `login_attempts` — lockouts firing?
   - `stripe_webhook_events` — a gap (missing `event_id`s) or a flood
     (retries)?
4. **Correlate with deploys.** `git log --since='<window start>'` and
   `mcp__supabase__list_edge_functions` (`updated_at`) — did something ship
   right before it started? A regression is the most common cause of "new
   error shape".
5. **Decide:**
   - benign (known third-party blip, a client bug spamming a valid
     endpoint): note it, maybe add a guard, done.
   - a real boundary was crossed → §2.C.
   - a specific account is affected → §2.B.
   - a credential is implicated → §2.A.
6. If it stays unexplained after this, treat it as a latent §2.C: assume a
   boundary *might* be crossable, and schedule a targeted audit of the
   implicated surface (the pentest plan is the template).

---

## 3. Contacts & escalation

Use these when the incident needs the **third party** to act — reverse a
charge, freeze an OAuth grant, confirm whether a leaked key of theirs was
used, investigate on their side.

> **Before you need them:** log into each dashboard now and confirm (a) the
> support tier your plan actually has, (b) the fastest channel (some are
> chat-only on lower tiers, email-only, or have a separate security address),
> and (c) who on the team holds the account. Paste the specifics into this
> section so they're not being looked up mid-incident.

| Provider | What they own for us | Public channel | Security / urgent | Status page |
|---|---|---|---|---|
| **Supabase** | Postgres, Auth (GoTrue), edge functions, `service_role`/`anon` keys, JWT signing | Dashboard → Support; `support@supabase.com` | `security@supabase.com` for vuln disclosure; Dashboard support marked urgent for account compromise | `status.supabase.com` |
| **Stripe** | subscriptions, checkout, real charges, `sk_live_`, `whsec_` | Dashboard → Help & Support (chat/email); `https://support.stripe.com` | Dashboard support flagged *fraud / unauthorized activity* routes to priority; for a leaked `sk_live_` roll it yourself first, then contact | `status.stripe.com` |
| **Alpaca** | brokerage accounts, real trades, OAuth partner app + client secret | `support@alpaca.markets`; `https://alpaca.markets/support`; broker API docs | for OAuth-app / partner issues use the developer/partner channel in the dashboard; disputed trades → the affected user files via Alpaca directly (Alpaca is the system of record, `SECURITY_THREAT_MODEL.md` R2) | `status.alpaca.markets` |
| **Plaid** | bank linking, transaction data, `client_id` + `secret` | Dashboard → Support; `https://dashboard.plaid.com/support` | `security@plaid.com`; **note Production approval is in progress — loop in that owner before any Plaid key rotation** (`CLAUDE.md`) | `status.plaid.com` |
| **Vercel** | frontend hosting, env vars, deploys, DNS for `app.arkonomy.com` | Dashboard → Help | Dashboard support; for a suspected build/deploy compromise, rotate any secrets that were in build env | `vercel-status.com` |
| **Resend** | transactional email (`api.resend.com`) | `support@resend.com` | same — rotate `RESEND_API_KEY` if leaked; low blast radius (email only) | `resend.com` status |
| **Anthropic** | `ai-chat` / `stock-ai-analysis` LLM calls | Console → Support; `support@anthropic.com` | rotate `ANTHROPIC_API_KEY` in the Console; watch for unexpected spend | `status.anthropic.com` |
| **Cloudflare** (if fronting `app.arkonomy.com` / the Supabase domain) | WAF, DNS, `CF-Connecting-IP` | Dashboard → Support | Dashboard; relevant when the incident is a traffic flood / the `X-Forwarded-For` spoof branch (see 1.1) | `cloudflarestatus.com` |
| **GitHub** | repo, git history, secret scanning, gitleaks Action | `https://support.github.com` | `https://github.com/contact/security` if the repo itself is compromised | `githubstatus.com` |

**Internal:** the repo is `github.com/shevvik88-dot/arkonomy`, single
maintainer. There is no second on-call — the `security-auditor` /
`code-reviewer` subagents are the substitute for a second pair of eyes
(`CLAUDE.md`); use them during response, not just before.

---

## 4. Post-incident checklist

1. **Write the `SECURITY_THREAT_MODEL.md` entry** in the house format —
   match the existing I6 / T7 / E4 / D5 entries exactly:

   ```markdown
   ### <Letter><N>. <short title> — **<status> <YYYY-MM-DD>**
   - **Entry point:** <file:line / endpoint / table>
   - **Attack vector:** <how it was found, and the concrete mechanism —
     "found by X (date)", not a hypothesis>
   - **Impact (pre-fix):** <what an attacker could actually do; the severity
     rating and the one-sentence reason for it>
   - **Fix:** <what changed, where; migration id / function version; note if
     deployed via apply_migration vs deploy_edge_function and why>
   - **Live-verified <YYYY-MM-DD>:** <the re-run-the-attack test; the script
     name; the ≥2 independent confirmations; cleanup done>
   - **Not independently confirmed:** <anything you could only check by
     code-read, e.g. "the Sentry event — no Sentry API access this session">
   - **Recommendation:** <residual / follow-up, or "none open">
   ```

   - Pick the STRIDE letter by category (Spoofing / Tampering / Repudiation /
     Info-disclosure / DoS / Elevation) and the next free number.
   - If the incident was a *credential leak that's now dead*, model it on
     **I7**: include the decode, the live-API test, the exact rejection
     body, and the exposure-window math.
   - If it exposed a *pattern* (like I6's FK-ownership shape), add the
     "worth a periodic grep for this shape elsewhere" note and say what
     else you checked and ruled out.

2. **Update the Summary section** of `SECURITY_THREAT_MODEL.md` — move the
   item into "Fixed since the initial pass" with a one-line pointer, and
   remove it from the open list if it was there.

3. **If the incident came from a pentest-plan scenario**, update that row in
   `PENETRATION_TEST_PLAN.md`'s Status table (Verified date / Result /
   Severity → Closed / Fix status).

4. **Regression test committed** — the C.4 script lives in `scripts/` as
   `test-<slug>-<finding>.mjs`, not a scratch file. Add a one-liner to the
   plan's §4 (Regression Test Coverage) if relevant.

5. **Rule extracted** — per `CLAUDE.md`'s self-improvement protocol, add one
   imperative rule about the **root-cause class** (not the symptom) to the
   right section of `CLAUDE.md`. Search first, refine an existing rule
   rather than duplicating.

6. **Rotation record** — if anything was rotated, note in
   `docs/security-log.md`: what, when, old→new format, what was redeployed,
   and the independent check that confirmed the new value live.

7. **Timeline archived** — fold the scratch incident log (from §0.5) into
   the `SECURITY_THREAT_MODEL.md` entry or `docs/security-log.md`; delete
   the scratch copy.

8. **Documentation-ages-silently check** (`CLAUDE.md`): if the response
   revealed that a *documented* control was no longer true (like I7's
   Dashboard label, or E4's false "checked server-side" claim), fix that
   line wherever it appears and note in the entry that the doc was stale.
