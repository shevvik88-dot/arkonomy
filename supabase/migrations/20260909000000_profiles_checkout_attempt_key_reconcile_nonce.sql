-- Independent review Round 7 — two Stripe blockers on PR #97.
--
-- BLOCKER 1 (stripe-checkout): the identity of an in-flight Checkout
-- attempt — the seed of its Stripe idempotency key — was carried by
-- checkout_pending_at, the SAME column the mutex overwrites on every lock
-- acquire. Round 6 papered over it with a second "restore" UPDATE; a crash
-- between the acquire and the restore (or that restore silently failing)
-- still leaves a fresh seed, so a retry mints a second session.
--   Fix: a dedicated column that holds the attempt's idempotency key,
--   stamped exactly ONCE (guarded on IS NULL) when an attempt first starts,
--   never rewritten by a lock acquire or a recovery, and cleared only when
--   the session id is recorded or the checkout completes/expires.
--
-- BLOCKER 2 (stripe-webhook): reconcileSubscription's terminal branch wrote
-- plan=free UNCONDITIONALLY, and its live branch used stripe_event_at
-- (a process wall-clock value) as the optimistic-CAS token.
--   Fix: a per-write random nonce so the compare-and-swap that guards both
--   the upgrade and the downgrade cannot be defeated by a same-millisecond
--   collision of two independent handlers.
--
-- ── ADDITIVE / BACKWARD-COMPATIBLE ──────────────────────────────────────
-- Both columns are NULLABLE with no default. The currently-deployed
-- handlers ignore them; a NULL is the "no attempt in flight" / "never
-- reconciled" state both code paths already handle.
--
-- ── GRANTS / RLS ────────────────────────────────────────────────────────
-- profiles SELECT/UPDATE for `authenticated` is column-scoped
-- (20260906182949 + the profiles pattern). checkout_pending_at,
-- checkout_session_id and stripe_event_at are server-only — NOT in the
-- authenticated grant list — and these two new columns follow suit: no
-- GRANT is issued, so PostgREST never exposes them to a client, and the
-- edge functions reach them through the table-level SELECT/UPDATE that
-- `service_role` already holds. RLS (profiles_owner_select /
-- profiles_owner_update, both auth.uid() = id) is row-scoped and unchanged.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS checkout_attempt_key text,
  ADD COLUMN IF NOT EXISTS reconcile_nonce      text;
