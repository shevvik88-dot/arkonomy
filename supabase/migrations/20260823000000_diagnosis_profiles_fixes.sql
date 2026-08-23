-- Fixes to diagnosis_profiles found by security-auditor review of Phase 1
-- (financial-diagnosis), before any real user had a row (verified: 0 rows
-- at time of this migration).
--
-- 1. HIGH: user_id FK had no ON DELETE CASCADE (copied verbatim from the
--    spec file's SQL snippet, which itself lacked it — should have been
--    caught against this project's own established pattern:
--    lesson_streaks/scheduled_payments both use ON DELETE CASCADE, and
--    20260731000002_rate_limits_cascade_delete.sql's own comment states the
--    standing rule: "FK + ON DELETE CASCADE ... protects any future table
--    with a user_id column automatically." Without it, delete-account's
--    final supabase.auth.admin.deleteUser() call would fail with a FK
--    violation for any user who ever ran a diagnosis — AFTER delete-account
--    has already deleted their transactions/savings/profile, leaving them
--    half-deleted with a live auth identity and no way to complete removal
--    except manually. delete-account itself doesn't need updating — it
--    relies on cascade for tables not in its explicit delete list, same as
--    every other user-scoped table added since the rate_limits fix.
alter table diagnosis_profiles drop constraint diagnosis_profiles_user_id_fkey;
alter table diagnosis_profiles
  add constraint diagnosis_profiles_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;

-- 2. MEDIUM: the "mark prior active rows stale, then insert a new active
--    row" sequence in the edge function is two separate statements with no
--    transaction — two concurrent requests could both pass the stale-update
--    before either inserts, leaving two 'active' rows for one user. Phase
--    2's daily-lesson-v2 depends on there being exactly one active row.
create unique index diagnosis_profiles_one_active_idx
  on diagnosis_profiles (user_id) where status = 'active';

-- 3. LOW: status was nullable, so an explicit NULL satisfies the CHECK
--    constraint and produces a row invisible to both the staling query and
--    any future "find the active row" query.
alter table diagnosis_profiles alter column status set not null;

-- 4. LOW: SELECT policy had no explicit `to authenticated` — defaults to
--    `to public` (includes anon). Not exploitable (auth.uid() is NULL for
--    anon, so the row never matches), but weaker than intended.
drop policy "select own diagnosis_profiles" on diagnosis_profiles;
create policy "select own diagnosis_profiles" on diagnosis_profiles
  for select to authenticated using (auth.uid() = user_id);
