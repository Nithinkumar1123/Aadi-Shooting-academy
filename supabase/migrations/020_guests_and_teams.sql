-- 020: On-the-spot guest registration + single-player / team matches.
--  GUESTS: a guest is stored as a shooters row with is_guest = true and status 'inactive', so they never show up in
--          member lists, fees, check-in or the member count. Admin registers them at the venue (even if the match is
--          closed or live). A returning guest is recognised by phone number and reused.
--  TEAMS : matches.format is 'individual' or 'team'. Only admins create teams and place players in them.
--          Team score = sum of its players' scores. Individual ranking is still kept.

alter table public.shooters add column if not exists is_guest boolean not null default false;
alter table public.shooters add column if not exists guest_club text;
create index if not exists shooters_guest_phone_idx on public.shooters(phone) where is_guest;

alter table public.matches add column if not exists format text not null default 'individual' check (format in ('individual','team'));
alter table public.matches add column if not exists team_size int not null default 2 check (team_size between 2 and 10);

create table if not exists public.match_teams (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  created_at timestamptz not null default now()
);
create unique index if not exists match_teams_name_idx on public.match_teams(match_id, lower(name));
alter table public.match_teams enable row level security;
drop policy if exists "Admins manage teams" on public.match_teams;
create policy "Admins manage teams" on public.match_teams for all to authenticated
  using (public.is_academy_admin()) with check (public.is_academy_admin());

alter table public.match_registrations add column if not exists team_id uuid references public.match_teams(id) on delete set null;

-- A team belongs to the same match, the match must be a team match, and the team cannot exceed its size.
create or replace function public.check_team_assignment()
returns trigger language plpgsql security definer set search_path = public
as $$
declare v_team_match uuid; v_format text; v_size int; v_count int;
begin
  if new.team_id is null then return new; end if;
  select match_id into v_team_match from public.match_teams where id = new.team_id;
  if v_team_match is distinct from new.match_id then raise exception 'That team belongs to a different match'; end if;
  select format, team_size into v_format, v_size from public.matches where id = new.match_id;
  if v_format <> 'team' then raise exception 'This is a single-player match'; end if;
  select count(*) into v_count from public.match_registrations where team_id = new.team_id and id <> new.id;
  if v_count >= v_size then raise exception 'This team already has % players', v_size; end if;
  return new;
end; $$;
drop trigger if exists match_registrations_team_check on public.match_registrations;
create trigger match_registrations_team_check before insert or update of team_id on public.match_registrations
  for each row execute function public.check_team_assignment();

-- Admin-added guests should not spam the admin with "new registration" alerts.
create or replace function public.notify_match_registration()
returns trigger language plpgsql security definer set search_path = public
as $$
declare v_name text; v_match text; v_guest boolean;
begin
  select full_name, is_guest into v_name, v_guest from public.shooters where id = new.shooter_id;
  if coalesce(v_guest, false) then return new; end if;
  select name into v_match from public.matches where id = new.match_id;
  insert into public.notifications(audience, type, title, message, data)
  values ('admin', 'match_registration', 'New match registration',
          coalesce(v_name,'A shooter') || ' registered for ' || coalesce(v_match,'a match') || '.',
          jsonb_build_object('match_id', new.match_id, 'shooter_id', new.shooter_id));
  return new;
end; $$;

-- On-the-spot guest registration (admin only).
create or replace function public.register_guest_for_match(
  p_match_id uuid, p_name text, p_phone text default null, p_club text default null,
  p_dob date default null, p_team_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_disc text; v_sid uuid; v_code text; v_reused boolean := false; v_phone text := nullif(regexp_replace(coalesce(p_phone,''), '\s+', '', 'g'), '');
begin
  if not public.is_academy_admin() then raise exception 'Not authorized'; end if;
  if coalesce(trim(p_name),'') = '' then raise exception 'Enter the guest''s name'; end if;
  select discipline into v_disc from public.matches where id = p_match_id;
  if v_disc is null then raise exception 'Match not found'; end if;
  if v_phone is not null then
    select id, shooter_code into v_sid, v_code from public.shooters where is_guest and phone = v_phone order by created_at limit 1;
    v_reused := v_sid is not null;
  end if;
  if v_sid is null then
    v_code := 'GUEST-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
    insert into public.shooters(shooter_code, full_name, phone, date_of_birth, discipline, status, approval_status, is_guest, guest_club)
    values (v_code, trim(p_name), v_phone, p_dob, v_disc, 'inactive', 'approved', true, nullif(trim(coalesce(p_club,'')), ''))
    returning id into v_sid;
  end if;
  if exists (select 1 from public.match_registrations where match_id = p_match_id and shooter_id = v_sid) then
    raise exception '% is already registered for this match', trim(p_name);
  end if;
  insert into public.match_registrations(match_id, shooter_id, team_id) values (p_match_id, v_sid, p_team_id);
  return jsonb_build_object('shooter_id', v_sid, 'code', v_code, 'reused', v_reused);
end; $$;
revoke all on function public.register_guest_for_match(uuid,text,text,text,date,uuid) from public, anon;
grant execute on function public.register_guest_for_match(uuid,text,text,text,date,uuid) to authenticated;

-- Shooter's own position, now with format / team / teammates.
create or replace function public.my_match_position(p_match_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare
  v_sid uuid := public.my_shooter_id();
  v_visible boolean; v_pub boolean; v_status text; v_max numeric; v_sheets int; v_per int; v_lane_pub boolean; v_sight int; v_format text;
  v_rank bigint; v_total bigint; v_score numeric; v_inner int; v_sheet_scores numeric[]; v_shots jsonb;
  v_lane text; v_relay int; v_targets text[]; v_team uuid; v_team_name text; v_mates jsonb;
begin
  if v_sid is null then return jsonb_build_object('registered', false, 'visible', false); end if;
  select lane_no, relay, sheet_targets, team_id into v_lane, v_relay, v_targets, v_team
    from public.match_registrations where match_id = p_match_id and shooter_id = v_sid;
  if not found then return jsonb_build_object('registered', false, 'visible', false); end if;
  select positions_visible, results_published, status, max_score, sheets, shots_per_sheet, lanes_published, sighting_sheets, format
    into v_visible, v_pub, v_status, v_max, v_sheets, v_per, v_lane_pub, v_sight, v_format from public.matches where id = p_match_id;
  select score, inner_tens, sheet_scores, shot_scores into v_score, v_inner, v_sheet_scores, v_shots
    from public.match_scores where match_id = p_match_id and shooter_id = v_sid;
  v_visible := coalesce(v_visible, false) or (coalesce(v_pub, false) and v_status = 'completed');
  if v_visible then
    select count(*) into v_total from public.match_scores where match_id = p_match_id;
    if v_score is not null then
      select 1 + count(*) into v_rank from public.match_scores s
        where s.match_id = p_match_id and (s.score > v_score or (s.score = v_score and s.inner_tens > v_inner));
    end if;
  end if;
  if not coalesce(v_lane_pub, false) then v_lane := null; v_relay := null; v_targets := null; end if;
  if v_team is not null then
    select name into v_team_name from public.match_teams where id = v_team;
    select coalesce(jsonb_agg(sh.full_name order by sh.full_name), '[]'::jsonb) into v_mates
      from public.match_registrations r join public.shooters sh on sh.id = r.shooter_id
      where r.team_id = v_team and r.shooter_id <> v_sid;
  end if;
  return jsonb_build_object('registered', true, 'visible', v_visible, 'rank', v_rank, 'total', v_total,
    'score', v_score, 'inner_tens', v_inner, 'sheet_scores', to_jsonb(v_sheet_scores), 'shot_scores', v_shots,
    'lane_no', v_lane, 'relay', v_relay, 'sheet_targets', to_jsonb(v_targets), 'lane_published', coalesce(v_lane_pub, false),
    'max_score', v_max, 'sheets', v_sheets, 'shots_per_sheet', v_per, 'sighting_sheets', v_sight,
    'format', v_format, 'team_name', v_team_name, 'teammates', v_mates);
end; $$;

-- Final results: individual rows (+ guest flag) and, for team matches, team standings.
create or replace function public.match_full_results(p_match_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare v_sid uuid := public.my_shooter_id(); v_pub boolean; v_status text; v_format text; v_rows jsonb; v_teams jsonb := '[]'::jsonb; v_my_team uuid;
begin
  if v_sid is null or not exists (select 1 from public.match_registrations where match_id = p_match_id and shooter_id = v_sid) then
    return jsonb_build_object('available', false);
  end if;
  select results_published, status, format into v_pub, v_status, v_format from public.matches where id = p_match_id;
  if not (coalesce(v_pub, false) and v_status = 'completed') then return jsonb_build_object('available', false); end if;
  select team_id into v_my_team from public.match_registrations where match_id = p_match_id and shooter_id = v_sid;
  select coalesce(jsonb_agg(jsonb_build_object(
      'rank', t.rnk, 'name', t.full_name, 'score', t.score, 'inner_tens', t.inner_tens,
      'sheet_scores', to_jsonb(t.sheet_scores), 'lane_no', t.lane_no, 'is_guest', t.is_guest, 'team', t.team_name,
      'is_me', t.shooter_id = v_sid) order by t.rnk, t.full_name), '[]'::jsonb)
    into v_rows
  from (
    select s.shooter_id, sh.full_name, sh.is_guest, s.score, s.inner_tens, s.sheet_scores, r.lane_no, tm.name as team_name,
           rank() over (order by s.score desc, s.inner_tens desc) as rnk
    from public.match_scores s
    join public.shooters sh on sh.id = s.shooter_id
    left join public.match_registrations r on r.match_id = s.match_id and r.shooter_id = s.shooter_id
    left join public.match_teams tm on tm.id = r.team_id
    where s.match_id = p_match_id
  ) t;
  if v_format = 'team' then
    select coalesce(jsonb_agg(jsonb_build_object('rank', q.rnk, 'name', q.name, 'score', q.total, 'inner_tens', q.inner,
        'scored', q.scored, 'players', q.players, 'members', q.members, 'is_mine', q.id = v_my_team) order by q.rnk, q.name), '[]'::jsonb)
      into v_teams
    from (
      select tm.id, tm.name, sum(s.score) as total, sum(s.inner_tens)::int as inner, count(s.id)::int as scored, count(r.id)::int as players,
             jsonb_agg(sh.full_name order by sh.full_name) as members,
             rank() over (order by sum(s.score) desc nulls last, sum(s.inner_tens) desc) as rnk
      from public.match_teams tm
      join public.match_registrations r on r.team_id = tm.id
      join public.shooters sh on sh.id = r.shooter_id
      left join public.match_scores s on s.match_id = r.match_id and s.shooter_id = r.shooter_id
      where tm.match_id = p_match_id
      group by tm.id, tm.name
      having count(s.id) > 0
    ) q;
  end if;
  return jsonb_build_object('available', true, 'rows', v_rows, 'format', v_format, 'teams', v_teams);
end; $$;
revoke all on function public.match_full_results(uuid) from public, anon;
grant execute on function public.match_full_results(uuid) to authenticated;
