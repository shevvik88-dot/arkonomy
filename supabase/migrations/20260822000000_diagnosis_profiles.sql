-- diagnosis_profiles: output of the financial-diagnosis edge function —
-- deterministic metrics + rule-based issue classification + Claude-generated
-- narrative, computed server-side from the user's real transaction/account
-- data. Read by the client (Financial Diagnosis result screen, and in
-- Phase 2 the daily-lesson-v2 edge function).
--
-- RLS deliberately diverges from the "full client CRUD" pattern used by
-- e.g. scheduled_payments: this table is analysis OUTPUT computed by
-- trusted server logic (deterministic metrics + a Claude call), not
-- user-entered input. Allowing a client to write arbitrary `primary_issues`/
-- `narrative` into their own row would let them inject fabricated diagnosis
-- text that Phase 2's daily-lesson-v2 later reads back into an AI prompt
-- (a self-targeted prompt-injection vector, low blast radius since RLS
-- still scopes to the caller's own row, but avoidable) and would let the
-- result screen display numbers that never came from real data. So: SELECT
-- is open to the owning user (read their own diagnosis), INSERT/UPDATE/
-- DELETE are service-role only (no client-facing policies for those) —
-- only the financial-diagnosis edge function (service role) ever writes
-- this table.
create table diagnosis_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  metrics jsonb not null,
  primary_issues text[] not null,
  narrative jsonb not null,
  status text default 'active' check (status in ('active','resolved','stale'))
);

create index on diagnosis_profiles (user_id, status);

alter table diagnosis_profiles enable row level security;

create policy "select own diagnosis_profiles" on diagnosis_profiles
  for select using (auth.uid() = user_id);

-- No insert/update/delete policy for anon/authenticated — service_role
-- bypasses RLS by default, so the edge function (using the service role
-- key) can still upsert freely. This is the same posture as plaid_items'
-- "no SELECT policy" pattern, mirrored for the opposite operations.
