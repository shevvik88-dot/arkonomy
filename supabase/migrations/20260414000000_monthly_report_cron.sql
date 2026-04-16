-- supabase/migrations/20260414000000_monthly_report_cron.sql
--
-- Sets up a pg_cron job that fires on the 1st of every month at 08:00 UTC,
-- calling the generate-monthly-report edge function for all users.
--
-- Prerequisites (enable once in Supabase Dashboard → Database → Extensions):
--   • pg_cron   (schedules the job)
--   • pg_net    (makes the HTTP call from Postgres)
--
-- Before running this migration, replace YOUR_SERVICE_ROLE_KEY with the
-- actual value from: Supabase Dashboard → Project Settings → API → service_role key

-- ── 1. Enable required extensions ────────────────────────────────────────────
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net  with schema extensions;

-- ── 2. Remove any previous version of this job (idempotent) ──────────────────
do $$
begin
  perform cron.unschedule('arkonomy-monthly-report');
exception when others then
  null; -- job didn't exist yet — that's fine
end;
$$;

-- ── 3. Schedule: 08:00 UTC on the 1st of every month ─────────────────────────
select cron.schedule(
  'arkonomy-monthly-report',   -- job name
  '0 8 1 * *',                 -- cron expression: minute hour day month weekday
  $$
  select net.http_post(
    url     => 'https://hvnkxxazjfesbxdkzuba.supabase.co/functions/v1/generate-monthly-report',
    headers => jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY'
               ),
    body    => '{}'::jsonb
  ) as request_id;
  $$
);

-- ── Verify the job was created ────────────────────────────────────────────────
-- Run this query manually to confirm:
--   select jobid, jobname, schedule, active from cron.job where jobname = 'arkonomy-monthly-report';
