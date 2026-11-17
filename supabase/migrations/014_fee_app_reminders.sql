-- 014: automatic in-app + phone (push) fee reminders, sent every morning without anyone opening the app.
-- Each pending fee gets ONE notification per day: from 3 days before the due date, on the due date,
-- and every day while overdue, until it is marked paid. Every notification also becomes a push (migration 013).

create or replace function public.send_fee_app_reminders()
returns int language plpgsql security definer set search_path = public
as $$
declare v_today date := (now() at time zone 'Asia/Kolkata')::date; v_count int;
begin
  insert into public.notifications(audience, shooter_id, type, title, message, data)
  select 'shooter', f.shooter_id,
    case when f.due_date < v_today then 'fee_overdue' else 'fee_reminder' end,
    case when f.due_date < v_today then 'Fee overdue'
         when f.due_date = v_today then 'Fee due today'
         else 'Fee due soon' end,
    f.title || ' · ₹' || to_char(f.amount, 'FM999999990.00') || ' ' ||
    case when f.due_date < v_today then 'was due on ' || to_char(f.due_date, 'DD Mon') || ' (' || (v_today - f.due_date) || ' day' || case when v_today - f.due_date = 1 then '' else 's' end || ' overdue).'
         when f.due_date = v_today then 'is due today.'
         else 'is due in ' || (f.due_date - v_today) || ' day' || case when f.due_date - v_today = 1 then '' else 's' end || ' (' || to_char(f.due_date, 'DD Mon') || ').' end
    || ' Please pay at the academy front desk.',
    jsonb_build_object('fee_id', f.id)
  from public.fees f
  join public.shooters s on s.id = f.shooter_id
  where f.status = 'pending'
    and f.due_date <= v_today + 3
    and not exists (
      select 1 from public.notifications n
      where n.shooter_id = f.shooter_id and n.type in ('fee_reminder','fee_overdue')
        and n.data->>'fee_id' = f.id::text
        and (n.created_at at time zone 'Asia/Kolkata')::date = v_today
    );
  get diagnostics v_count = row_count;
  return v_count;
end; $$;
-- Only the database scheduler may run this (not the app or the public).
revoke all on function public.send_fee_app_reminders() from public, anon, authenticated;

-- Run every day at 09:00 India time (03:30 UTC).
do $$ begin
  create extension if not exists pg_cron;
  perform cron.unschedule('aadi-fee-app-reminders') where exists (select 1 from cron.job where jobname = 'aadi-fee-app-reminders');
  perform cron.schedule('aadi-fee-app-reminders', '30 3 * * *', 'select public.send_fee_app_reminders();');
exception when others then
  raise notice 'pg_cron not available - enable it in Supabase: Database -> Extensions -> pg_cron, then re-run this migration. (%)', sqlerrm;
end $$;
