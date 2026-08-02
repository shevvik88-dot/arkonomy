-- supabase/migrations/20260802000001_large_transaction_alert_cron.sql
--
-- Sets up a pg_cron job that checks every 4 hours for new, non-recurring
-- transactions over $500 and emails the owning user. Frequency is a proposed
-- default, not a hard requirement — adjust the cron expression if a
-- different cadence is wanted before this is actually scheduled live.
--
-- NOT applied automatically as part of this session — per instruction, this
-- feature is code-review + manual single-user testing first (via a user JWT
-- POST to large-transaction-alert) before the cron job is scheduled and
-- before large_transaction_alerts is enabled broadly.
--
-- Before running this migration, replace YOUR_SERVICE_ROLE_KEY with the
-- actual value from: Supabase Dashboard → Project Settings → API → service_role key

select cron.schedule(
  'arkonomy-large-transaction-alert',
  '0 */4 * * *',              -- every 4 hours
  $$
  select net.http_post(
    url                  => 'https://hvnkxxazjfesbxdkzuba.supabase.co/functions/v1/large-transaction-alert',
    headers              => jsonb_build_object(
                               'Content-Type',  'application/json',
                               'Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY'
                             ),
    body                 => '{}'::jsonb,
    timeout_milliseconds => 60000
  ) as request_id;
  $$
);

-- ── Verify ─────────────────────────────────────────────────────────────────
-- select jobid, jobname, schedule, active from cron.job where jobname = 'arkonomy-large-transaction-alert';
