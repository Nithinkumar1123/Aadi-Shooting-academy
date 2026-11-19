-- 023: Automatic backup of academy data to a Google Sheet.
--
--   any INSERT / UPDATE / DELETE on a backed-up table
--        -> a row in backup_outbox (a queue; written in the SAME transaction, so nothing is missed)
--        -> every minute flush_backup_outbox() sends pending rows to a small Google Apps Script web app
--        -> the script upserts the row into a tab named after the table AND appends a line to "Change Log".
--
-- If Google is unreachable the rows simply stay queued and are retried, so a failed send never loses data.
-- A weekly full snapshot also re-sends everything, which repairs any gap.
-- Deleted rows are NOT removed from the sheet; they are marked deleted (it is a backup).
-- The queue only fills once a Google Sheet has been connected (Admin -> Backup).

create extension if not exists pg_net with schema extensions;

-- Settings: nobody can read these from the app directly (RLS on, no policies); admins use the RPCs below.
create table if not exists public.backup_config (key text primary key, value text not null);
alter table public.backup_config enable row level security;

create table if not exists public.backup_outbox (
  id bigserial primary key,
  table_name text not null,
  op text not null check (op in ('insert','update','delete','snapshot','ping')),
  row_id text,
  data jsonb,
  created_at timestamptz not null default now(),
  request_id bigint,
  requested_at timestamptz,
  attempts int not null default 0,
  sent_at timestamptz
);
create index if not exists backup_outbox_pending_idx on public.backup_outbox(id) where sent_at is null;
alter table public.backup_outbox enable row level security;

-- Tables that are backed up (add a table name here to include it).
create or replace function public.backup_tables() returns text[] language sql immutable
as $$ select array['shooters','rifles','attendance','rifle_allocations','shooting_scores','fees','shooter_exit_requests',
                   'matches','match_registrations','match_scores','match_teams'] $$;

-- Row-level capture. A failure here must never block the original action.
create or replace function public.backup_capture() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_row jsonb;
begin
  if not exists (select 1 from public.backup_config where key = 'sheet_url') then return null; end if;
  if exists (select 1 from public.backup_config where key = 'enabled' and value = 'false') then return null; end if;
  v_row := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  insert into public.backup_outbox(table_name, op, row_id, data) values (tg_table_name, lower(tg_op), v_row->>'id', v_row);
  return null;
exception when others then
  return null;
end; $$;

do $$
declare t text;
begin
  foreach t in array public.backup_tables() loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists backup_capture_trg on public.%I', t);
      execute format('create trigger backup_capture_trg after insert or update or delete on public.%I for each row execute function public.backup_capture()', t);
    end if;
  end loop;
end $$;

-- Sends pending rows (called by the minute job). Safe to call any time.
create or replace function public.flush_backup_outbox(p_batches int default 2)
returns int language plpgsql security definer set search_path = public, extensions as $$
declare v_url text; v_secret text; v_ids bigint[]; v_rows jsonb; v_req bigint; v_sent int := 0; i int;
begin
  select value into v_url from public.backup_config where key = 'sheet_url';
  select value into v_secret from public.backup_config where key = 'secret';
  if v_url is null or v_secret is null then return 0; end if;
  if exists (select 1 from public.backup_config where key = 'enabled' and value = 'false') then return 0; end if;

  -- 1) Settle earlier requests. Apps Script answers either 200 {"ok":true} or a 30x redirect to its result page
  --    (the script has already run by then), so both count as delivered.
  update public.backup_outbox o set sent_at = now()
   where o.sent_at is null and o.request_id is not null
     and exists (select 1 from net._http_response r where r.id = o.request_id
                 and (r.status_code between 300 and 399 or (r.status_code = 200 and r.content like '%"ok":true%')));
  -- anything that failed or never answered goes back in the queue
  update public.backup_outbox o set request_id = null, attempts = attempts + 1
   where o.sent_at is null and o.request_id is not null
     and (exists (select 1 from net._http_response r where r.id = o.request_id) or o.requested_at < now() - interval '10 minutes');
  delete from public.backup_outbox where sent_at < now() - interval '7 days';

  -- 2) Send the next batches, oldest first.
  for i in 1..greatest(p_batches, 1) loop
    select array_agg(id order by id), jsonb_agg(jsonb_build_object('seq', id, 'table', table_name, 'op', op, 'id', row_id, 'data', data, 'at', created_at) order by id)
      into v_ids, v_rows
    from (select * from public.backup_outbox where sent_at is null and request_id is null and attempts < 20 order by id limit 250) q;
    exit when v_ids is null;
    v_req := net.http_post(url := v_url, headers := jsonb_build_object('Content-Type', 'application/json'),
                           body := jsonb_build_object('secret', v_secret, 'rows', v_rows), timeout_milliseconds := 55000);
    update public.backup_outbox set request_id = v_req, requested_at = now() where id = any(v_ids);
    v_sent := v_sent + array_length(v_ids, 1);
  end loop;
  return v_sent;
exception when others then
  return 0;
end; $$;
revoke all on function public.flush_backup_outbox(int) from public, anon, authenticated;

-- Queue every existing row (first-time backup / repair).
create or replace function public._backup_enqueue_snapshot() returns int
language plpgsql security definer set search_path = public as $$
declare t text; n int; total int := 0;
begin
  foreach t in array public.backup_tables() loop
    if to_regclass('public.' || t) is not null then
      execute format('insert into public.backup_outbox(table_name, op, row_id, data) select %L, ''snapshot'', to_jsonb(x)->>''id'', to_jsonb(x) from public.%I x', t, t);
      get diagnostics n = row_count; total := total + n;
    end if;
  end loop;
  return total;
end; $$;
revoke all on function public._backup_enqueue_snapshot() from public, anon, authenticated;

create or replace function public._backup_weekly() returns void
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.backup_config where key = 'sheet_url')
     and not exists (select 1 from public.backup_config where key = 'enabled' and value = 'false') then
    perform public._backup_enqueue_snapshot();
  end if;
end; $$;
revoke all on function public._backup_weekly() from public, anon, authenticated;

-- ---- Admin RPCs (super_admin / admin only) ------------------------------------------------------------
create or replace function public._backup_is_admin() returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.profiles where id = auth.uid() and role in ('super_admin','admin')) $$;
revoke all on function public._backup_is_admin() from public, anon;
grant execute on function public._backup_is_admin() to authenticated;

create or replace function public.backup_status() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_url text;
begin
  if not public._backup_is_admin() then raise exception 'Only an academy admin can view backup settings.'; end if;
  select value into v_url from public.backup_config where key = 'sheet_url';
  return jsonb_build_object(
    'configured', v_url is not null,
    'enabled', not exists (select 1 from public.backup_config where key = 'enabled' and value = 'false'),
    'url_hint', case when v_url is null then null else left(v_url, 40) || '…' || right(v_url, 6) end,
    'pending', (select count(*) from public.backup_outbox where sent_at is null and attempts < 20),
    'failed', (select count(*) from public.backup_outbox where sent_at is null and attempts >= 20),
    'last_sent_at', (select max(sent_at) from public.backup_outbox),
    'backed_up_today', (select count(*) from public.backup_outbox where sent_at > now() - interval '1 day' and op <> 'ping'),
    'tables', to_jsonb(public.backup_tables()));
end; $$;

create or replace function public.save_backup_config(p_url text, p_secret text, p_enabled boolean default true) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public._backup_is_admin() then raise exception 'Only an academy admin can change backup settings.'; end if;
  if p_url !~ '^https://script\.google\.com/macros/s/[A-Za-z0-9_-]+/exec$' then
    raise exception 'That does not look like a Google Apps Script web app link. It should start with https://script.google.com/macros/s/ and end with /exec';
  end if;
  if coalesce(length(trim(p_secret)), 0) < 8 then raise exception 'The secret must be at least 8 characters.'; end if;
  insert into public.backup_config(key, value) values ('sheet_url', trim(p_url)) on conflict (key) do update set value = excluded.value;
  insert into public.backup_config(key, value) values ('secret', trim(p_secret)) on conflict (key) do update set value = excluded.value;
  insert into public.backup_config(key, value) values ('enabled', case when p_enabled then 'true' else 'false' end) on conflict (key) do update set value = excluded.value;
end; $$;

create or replace function public.disconnect_backup() returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public._backup_is_admin() then raise exception 'Only an academy admin can change backup settings.'; end if;
  delete from public.backup_config where key in ('sheet_url','secret','enabled');
  delete from public.backup_outbox where sent_at is null;
end; $$;

create or replace function public.set_backup_enabled(p_enabled boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public._backup_is_admin() then raise exception 'Only an academy admin can change backup settings.'; end if;
  insert into public.backup_config(key, value) values ('enabled', case when p_enabled then 'true' else 'false' end)
    on conflict (key) do update set value = excluded.value;
end; $$;

-- "Back up everything now": queues every row and starts sending.
create or replace function public.backup_resync_all() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public._backup_is_admin() then raise exception 'Only an academy admin can start a backup.'; end if;
  if not exists (select 1 from public.backup_config where key = 'sheet_url') then raise exception 'Connect a Google Sheet first.'; end if;
  n := public._backup_enqueue_snapshot();
  perform public.flush_backup_outbox(3);
  return n;
end; $$;

create or replace function public.backup_flush_now() returns int
language plpgsql security definer set search_path = public as $$
begin
  if not public._backup_is_admin() then raise exception 'Only an academy admin can start a backup.'; end if;
  return public.flush_backup_outbox(3);
end; $$;

create or replace function public.backup_send_test() returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public._backup_is_admin() then raise exception 'Only an academy admin can run a test.'; end if;
  if not exists (select 1 from public.backup_config where key = 'sheet_url') then raise exception 'Connect a Google Sheet first.'; end if;
  insert into public.backup_outbox(table_name, op, row_id, data) values ('_status', 'ping', 'ping', jsonb_build_object('sent_by', auth.uid(), 'sent_at', now()));
  perform public.flush_backup_outbox(1);
end; $$;

revoke all on function public.backup_status(), public.save_backup_config(text,text,boolean), public.disconnect_backup(),
  public.backup_resync_all(), public.backup_flush_now(), public.backup_send_test(), public.set_backup_enabled(boolean) from public, anon;
grant execute on function public.backup_status(), public.save_backup_config(text,text,boolean), public.disconnect_backup(),
  public.backup_resync_all(), public.backup_flush_now(), public.backup_send_test(), public.set_backup_enabled(boolean) to authenticated;

-- ---- Schedules (pg_cron). If pg_cron is not enabled the app still works: "Send now" on the Backup page flushes the queue.
do $$
begin
  create extension if not exists pg_cron;
  perform cron.unschedule(jobid) from cron.job where jobname in ('aadi-sheets-backup', 'aadi-sheets-weekly');
  perform cron.schedule('aadi-sheets-backup', '* * * * *', 'select public.flush_backup_outbox(2)');
  perform cron.schedule('aadi-sheets-weekly', '30 20 * * 0', 'select public._backup_weekly()'); -- Mondays 02:00 India time
exception when others then
  raise notice 'pg_cron not available (%). Enable it in Supabase -> Database -> Extensions, then re-run this migration.', sqlerrm;
end $$;

notify pgrst, 'reload schema';
