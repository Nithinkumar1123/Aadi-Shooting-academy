-- 015: Matches / competitions.
--  * Admin organises a match; approved shooters register for it.
--  * Admin records, edits and deletes each registered shooter's match score.
--  * Admin decides (per match) whether shooters may see THEIR OWN position.
--  * A shooter only ever receives their own rank – never other shooters' names or scores.
--  * Positions update live: every score change bumps matches.scores_version, which
--    shooters receive through Realtime and then re-ask for their own position.

create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  discipline text not null default '10m Air Rifle',
  match_date date not null default current_date,
  venue text,
  description text,
  shots int not null default 60 check (shots > 0),
  max_score numeric(7,1) not null default 654 check (max_score > 0),
  -- open = shooters can register, closed = registration shut, live = match in progress, completed = finished
  status text not null default 'open' check (status in ('open','closed','live','completed')),
  -- Admin switch: when true, registered shooters can see their own position.
  positions_visible boolean not null default false,
  -- Bumped whenever a score changes so shooters know to refresh their position.
  scores_version bigint not null default 0,
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists matches_date_idx on public.matches(match_date desc);

create table if not exists public.match_registrations (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  shooter_id uuid not null references public.shooters(id) on delete cascade,
  registered_at timestamptz not null default now(),
  unique (match_id, shooter_id)
);
create index if not exists match_registrations_shooter_idx on public.match_registrations(shooter_id);

create table if not exists public.match_scores (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  shooter_id uuid not null references public.shooters(id) on delete cascade,
  score numeric(7,1) not null check (score >= 0),
  inner_tens int not null default 0 check (inner_tens >= 0),   -- tie-breaker (more inner tens ranks higher)
  notes text,
  recorded_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (match_id, shooter_id)
);
create index if not exists match_scores_match_idx on public.match_scores(match_id, score desc);

alter table public.matches enable row level security;
alter table public.match_registrations enable row level security;
alter table public.match_scores enable row level security;

-- Matches: everyone signed in can see them; only admins change them.
drop policy if exists "Admins manage matches" on public.matches;
create policy "Admins manage matches" on public.matches
  for all to authenticated using (public.is_academy_admin()) with check (public.is_academy_admin());
drop policy if exists "Signed-in users read matches" on public.matches;
create policy "Signed-in users read matches" on public.matches
  for select to authenticated using (true);

-- Registrations: admins manage all; a shooter reads only their own (they register through the RPCs below).
drop policy if exists "Admins manage match registrations" on public.match_registrations;
create policy "Admins manage match registrations" on public.match_registrations
  for all to authenticated using (public.is_academy_admin()) with check (public.is_academy_admin());
drop policy if exists "Shooters read own match registrations" on public.match_registrations;
create policy "Shooters read own match registrations" on public.match_registrations
  for select to authenticated using (shooter_id = public.my_shooter_id());

-- Scores: admins manage all. Shooters have NO direct access; they get their position from my_match_position().
drop policy if exists "Admins manage match scores" on public.match_scores;
create policy "Admins manage match scores" on public.match_scores
  for all to authenticated using (public.is_academy_admin()) with check (public.is_academy_admin());

-- Keep updated_at fresh.
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at := now(); return new; end; $$;

drop trigger if exists matches_touch on public.matches;
create trigger matches_touch before update on public.matches for each row execute function public.touch_updated_at();
drop trigger if exists match_scores_touch on public.match_scores;
create trigger match_scores_touch before update on public.match_scores for each row execute function public.touch_updated_at();

-- A score can only be saved for a registered shooter and must not exceed the match maximum.
create or replace function public.check_match_score()
returns trigger language plpgsql security definer set search_path = public
as $$
declare v_max numeric;
begin
  select max_score into v_max from public.matches where id = new.match_id;
  if v_max is null then raise exception 'Match not found'; end if;
  if new.score > v_max then raise exception 'Score % is higher than the match maximum of %', new.score, v_max; end if;
  if not exists (select 1 from public.match_registrations r where r.match_id = new.match_id and r.shooter_id = new.shooter_id) then
    raise exception 'This shooter is not registered for the match';
  end if;
  return new;
end; $$;
drop trigger if exists match_scores_check on public.match_scores;
create trigger match_scores_check before insert or update on public.match_scores for each row execute function public.check_match_score();

-- Any score change (or someone leaving) nudges the match row so shooters' live positions refresh.
create or replace function public.bump_match_version()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  update public.matches set scores_version = scores_version + 1 where id = coalesce(new.match_id, old.match_id);
  return coalesce(new, old);
end; $$;
drop trigger if exists match_scores_bump on public.match_scores;
create trigger match_scores_bump after insert or update or delete on public.match_scores for each row execute function public.bump_match_version();

-- Removing a registration also removes that shooter's score for the match.
create or replace function public.drop_score_on_unregister()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  delete from public.match_scores where match_id = old.match_id and shooter_id = old.shooter_id;
  return old;
end; $$;
drop trigger if exists match_registration_cleanup on public.match_registrations;
create trigger match_registration_cleanup after delete on public.match_registrations for each row execute function public.drop_score_on_unregister();

-- Shooter registers for / withdraws from an open match.
create or replace function public.register_for_match(p_match_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
declare v_sid uuid := public.my_shooter_id(); v_status text; v_ok boolean;
begin
  if v_sid is null then raise exception 'Only academy members can register for matches'; end if;
  select (approval_status = 'approved' and status = 'active') into v_ok from public.shooters where id = v_sid;
  if not coalesce(v_ok, false) then raise exception 'Your membership must be active to register'; end if;
  select status into v_status from public.matches where id = p_match_id;
  if v_status is null then raise exception 'Match not found'; end if;
  if v_status <> 'open' then raise exception 'Registration for this match is closed'; end if;
  insert into public.match_registrations(match_id, shooter_id) values (p_match_id, v_sid) on conflict do nothing;
end; $$;

create or replace function public.withdraw_from_match(p_match_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
declare v_sid uuid := public.my_shooter_id(); v_status text;
begin
  if v_sid is null then raise exception 'Only academy members can withdraw from matches'; end if;
  select status into v_status from public.matches where id = p_match_id;
  if v_status is null then raise exception 'Match not found'; end if;
  if v_status <> 'open' then raise exception 'Registration is closed. Please contact the academy to withdraw.'; end if;
  delete from public.match_registrations where match_id = p_match_id and shooter_id = v_sid;
end; $$;

revoke all on function public.register_for_match(uuid) from public, anon;
revoke all on function public.withdraw_from_match(uuid) from public, anon;
grant execute on function public.register_for_match(uuid) to authenticated;
grant execute on function public.withdraw_from_match(uuid) to authenticated;

-- The signed-in shooter's OWN position in a match (competition ranking: equal score + inner tens share a place).
-- Returns only their own numbers, and only when the admin has allowed positions to be shown.
create or replace function public.my_match_position(p_match_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare
  v_sid uuid := public.my_shooter_id();
  v_visible boolean;
  v_max numeric;
  v_rank bigint; v_total bigint; v_score numeric; v_inner int;
begin
  if v_sid is null then return jsonb_build_object('registered', false, 'visible', false); end if;
  if not exists (select 1 from public.match_registrations where match_id = p_match_id and shooter_id = v_sid) then
    return jsonb_build_object('registered', false, 'visible', false);
  end if;
  select positions_visible, max_score into v_visible, v_max from public.matches where id = p_match_id;
  select score, inner_tens into v_score, v_inner from public.match_scores where match_id = p_match_id and shooter_id = v_sid;
  if not coalesce(v_visible, false) then
    return jsonb_build_object('registered', true, 'visible', false);
  end if;
  select count(*) into v_total from public.match_scores where match_id = p_match_id;
  if v_score is not null then
    select 1 + count(*) into v_rank from public.match_scores s
      where s.match_id = p_match_id
        and (s.score > v_score or (s.score = v_score and s.inner_tens > v_inner));
  end if;
  return jsonb_build_object('registered', true, 'visible', true, 'rank', v_rank, 'total', v_total,
                            'score', v_score, 'inner_tens', v_inner, 'max_score', v_max);
end; $$;
revoke all on function public.my_match_position(uuid) from public, anon;
grant execute on function public.my_match_position(uuid) to authenticated;

-- How many shooters have registered (a count only – no names) so shooters can see interest in a match.
create or replace function public.match_registration_count(p_match_id uuid)
returns bigint language sql stable security definer set search_path = public
as $$ select count(*) from public.match_registrations where match_id = p_match_id $$;
revoke all on function public.match_registration_count(uuid) from public, anon;
grant execute on function public.match_registration_count(uuid) to authenticated;

-- ---- Notifications -------------------------------------------------------------------------------
-- New match -> every active, approved shooter.
create or replace function public.notify_match_created()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.notifications(audience, shooter_id, type, title, message, data)
  select 'shooter', s.id, 'match_announced', 'New match: ' || new.name,
         to_char(new.match_date,'DD Mon YYYY') || coalesce(' · ' || new.venue, '') || ' · Register in the Matches tab.',
         jsonb_build_object('match_id', new.id)
  from public.shooters s where s.approval_status = 'approved' and s.status = 'active';
  return new;
end; $$;
drop trigger if exists matches_notify_created on public.matches;
create trigger matches_notify_created after insert on public.matches for each row execute function public.notify_match_created();

-- Positions switched on -> tell registered shooters.
create or replace function public.notify_positions_open()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.positions_visible and not old.positions_visible then
    insert into public.notifications(audience, shooter_id, type, title, message, data)
    select 'shooter', r.shooter_id, 'match_positions_open', 'Positions are now live',
           'You can now see your position in ' || new.name || ' in the Matches tab.',
           jsonb_build_object('match_id', new.id)
    from public.match_registrations r where r.match_id = new.id;
  end if;
  return new;
end; $$;
drop trigger if exists matches_notify_positions on public.matches;
create trigger matches_notify_positions after update of positions_visible on public.matches for each row execute function public.notify_positions_open();

-- Shooter registers -> staff notification.
create or replace function public.notify_match_registration()
returns trigger language plpgsql security definer set search_path = public
as $$
declare v_name text; v_match text;
begin
  select full_name into v_name from public.shooters where id = new.shooter_id;
  select name into v_match from public.matches where id = new.match_id;
  insert into public.notifications(audience, type, title, message, data)
  values ('admin', 'match_registration', 'New match registration',
          coalesce(v_name,'A shooter') || ' registered for ' || coalesce(v_match,'a match') || '.',
          jsonb_build_object('match_id', new.match_id, 'shooter_id', new.shooter_id));
  return new;
end; $$;
drop trigger if exists match_registration_notify on public.match_registrations;
create trigger match_registration_notify after insert on public.match_registrations for each row execute function public.notify_match_registration();

-- ---- Realtime ------------------------------------------------------------------------------------
do $$
begin
  begin alter publication supabase_realtime add table public.matches; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.match_registrations; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.match_scores; exception when duplicate_object then null; end;
end $$;
