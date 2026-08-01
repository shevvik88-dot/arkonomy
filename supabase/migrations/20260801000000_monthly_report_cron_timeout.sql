-- supabase/migrations/20260801000000_monthly_report_cron_timeout.sql
--
-- pg_net's net.http_post defaults to a 5000ms wait for a response. The
-- arkonomy-monthly-report job legitimately takes ~20-25s (per-user Excel
-- generation + Resend send, in a loop) — well past that default, so pg_net
-- logs a spurious "Timeout of 5000 ms reached" in net._http_response on
-- every real run even though generate-monthly-report itself completes and
-- returns 200 normally (confirmed live 2026-08-01: pg_net timeout at
-- 08:00:05, edge function's own 200 log at 08:00:23, same invocation).
-- Cron dispatch was already fire-and-forget (net.http_post queues the call
-- and returns immediately — pg_cron's own "succeeded" status reflects that,
-- not the HTTP response); only pg_net's own response-wait window was too
-- short, producing a misleading timeout entry in future logs. Raising
-- timeout_milliseconds so a normal run logs its real 200 instead.
--
-- Before running this migration, replace YOUR_SERVICE_ROLE_KEY with the
-- actual value from: Supabase Dashboard → Project Settings → API → service_role key

select cron.alter_job(
  job_id  := (select jobid from cron.job where jobname = 'arkonomy-monthly-report'),
  command := $$
  select net.http_post(
    url                => 'https://hvnkxxazjfesbxdkzuba.supabase.co/functions/v1/generate-monthly-report',
    headers            => jsonb_build_object(
                             'Content-Type',  'application/json',
                             'Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY'
                           ),
    body               => '{}'::jsonb,
    timeout_milliseconds => 60000
  ) as request_id;
  $$
);

-- ── Verify ─────────────────────────────────────────────────────────────────
-- select jobid, jobname, command from cron.job where jobname = 'arkonomy-monthly-report';
