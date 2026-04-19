-- supabase/migrations/20260419000001_daily_sync_cron.sql
--
-- Daily Plaid transaction sync: runs at 06:00 UTC every day.
-- Calls plaid-batch-sync for all users with connected banks.
--
-- Prerequisites (enable once in Supabase Dashboard → Database → Extensions):
--   • pg_cron  (schedules the job)
--   • pg_net   (makes the HTTP call from Postgres)

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net  with schema extensions;

-- Remove any previous version (idempotent)
do $$
begin
  perform cron.unschedule('arkonomy-daily-sync');
exception when others then
  null;
end;
$$;

-- Schedule: 06:00 UTC every day
select cron.schedule(
  'arkonomy-daily-sync',
  '0 6 * * *',
  $$
  select net.http_post(
    url     => 'https://hvnkxxazjfesbxdkzuba.supabase.co/functions/v1/plaid-batch-sync',
    headers => jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY'
               ),
    body    => '{}'::jsonb
  ) as request_id;
  $$
);

-- Verify:
--   select jobid, jobname, schedule, active from cron.job where jobname = 'arkonomy-daily-sync';
