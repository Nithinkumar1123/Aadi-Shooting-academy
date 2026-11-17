-- 013: Web Push (notifications that reach a locked phone / closed app).
-- Needs the `push-notify` Edge Function deployed + the one-time config insert described in the README.

-- One row per installed browser/phone. A device belongs to whoever is signed in on it.
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions(user_id);
alter table public.push_subscriptions enable row level security;
-- No direct table policies on purpose: devices are saved/removed only through the two functions below.

create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Please sign in first'; end if;
  insert into public.push_subscriptions(user_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (endpoint) do update
    set user_id = auth.uid(), p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent, updated_at = now();
end; $$;

create or replace function public.remove_push_subscription(p_endpoint text)
returns void language plpgsql security definer set search_path = public
as $$
begin
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
end; $$;

revoke all on function public.save_push_subscription(text,text,text,text) from public, anon;
revoke all on function public.remove_push_subscription(text) from public, anon;
grant execute on function public.save_push_subscription(text,text,text,text) to authenticated;
grant execute on function public.remove_push_subscription(text) to authenticated;

-- Where to send new notifications. Filled once by you (see README); nobody can read it from the app.
create table if not exists public.push_config (key text primary key, value text not null);
alter table public.push_config enable row level security;

-- Every new in-app notification also triggers a push. A failure here must never block the original action.
create extension if not exists pg_net with schema extensions;

create or replace function public.push_on_notification()
returns trigger language plpgsql security definer set search_path = public, extensions
as $$
declare v_url text; v_secret text;
begin
  select value into v_url from public.push_config where key = 'push_function_url';
  select value into v_secret from public.push_config where key = 'push_webhook_secret';
  if v_url is null or v_secret is null then return new; end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type','application/json','x-webhook-secret', v_secret),
    body := jsonb_build_object('record', to_jsonb(new))
  );
  return new;
exception when others then
  return new;
end; $$;

drop trigger if exists notifications_push on public.notifications;
create trigger notifications_push after insert on public.notifications for each row execute function public.push_on_notification();
