-- OPTIONAL: automatic daily fee-reminder emails.
-- Run once in the Supabase SQL Editor AFTER deploying the `fee-mail` function.
-- (Kept outside /migrations because it contains your project URL and secret.)
--
-- 1. Replace YOUR_PROJECT_REF, YOUR_ANON_KEY (the public anon/publishable key, needed to pass Supabase's gateway)
--    and YOUR_CRON_SECRET (same value you set as the CRON_SECRET function secret).
-- 2. Runs every day at 09:00 India time (03:30 UTC). Each pending fee gets a reminder starting 3 days
--    before its due date, then again every 3 days until it is marked paid.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('aadi-fee-reminders') where exists (select 1 from cron.job where jobname = 'aadi-fee-reminders');

select cron.schedule(
  'aadi-fee-reminders',
  '30 3 * * *',
  $$
  select net.http_post(
    url     := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/fee-mail',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer YOUR_ANON_KEY', 'x-cron-secret', 'YOUR_CRON_SECRET'),
    body    := '{"kind":"auto"}'::jsonb
  );
  $$
);
