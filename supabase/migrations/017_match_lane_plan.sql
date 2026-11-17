-- 017: Lane plan for matches.
--  * The academy has 10 lanes. Admin chooses which lanes a match uses (matches.lanes).
--  * Shooters are split into relays (batches / squads) when there are more shooters than lanes.
--  * Admin assigns each registered shooter a relay + lane, and a target-sheet number for every series (sheet).
--  * Shots per target sheet already lives on matches.shots_per_sheet.
--  * Shooters see their lane / relay / target numbers only after the admin PUBLISHES the lane plan.

alter table public.matches add column if not exists lanes int[] not null default '{1,2,3,4,5,6,7,8,9,10}';
alter table public.matches add column if not exists relays int not null default 1 check (relays between 1 and 20);
alter table public.matches add column if not exists lanes_published boolean not null default false;

alter table public.match_registrations add column if not exists relay int not null default 1 check (relay > 0);
alter table public.match_registrations add column if not exists sheet_targets text[];

-- A lane can hold only one shooter per relay, must be one of the match's lanes, and the relay must exist.
create or replace function public.check_lane_assignment()
returns trigger language plpgsql security definer set search_path = public
as $$
declare v_lanes int[]; v_relays int;
begin
  if new.lane_no is null or trim(new.lane_no) = '' then
    new.lane_no := null;
    return new;
  end if;
  select lanes, relays into v_lanes, v_relays from public.matches where id = new.match_id;
  if new.lane_no ~ '^[0-9]+$' and v_lanes is not null and not (new.lane_no::int = any(v_lanes)) then
    raise exception 'Lane % is not used in this match', new.lane_no;
  end if;
  if new.relay > coalesce(v_relays, 1) then raise exception 'This match has only % relay(s)', v_relays; end if;
  if exists (select 1 from public.match_registrations r
             where r.match_id = new.match_id and r.id <> new.id and r.relay = new.relay and r.lane_no = new.lane_no) then
    raise exception 'Lane % in relay % is already taken', new.lane_no, new.relay;
  end if;
  return new;
end; $$;
drop trigger if exists match_registrations_lane_check on public.match_registrations;
create trigger match_registrations_lane_check before insert or update of lane_no, relay on public.match_registrations
  for each row execute function public.check_lane_assignment();

-- Shooter's OWN numbers. Lane / relay / target numbers are returned only once the lane plan is published.
create or replace function public.my_match_position(p_match_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare
  v_sid uuid := public.my_shooter_id();
  v_visible boolean; v_pub boolean; v_status text; v_max numeric; v_sheets int; v_per int; v_lane_pub boolean;
  v_rank bigint; v_total bigint; v_score numeric; v_inner int; v_sheet_scores numeric[];
  v_lane text; v_relay int; v_targets text[];
begin
  if v_sid is null then return jsonb_build_object('registered', false, 'visible', false); end if;
  select lane_no, relay, sheet_targets into v_lane, v_relay, v_targets
    from public.match_registrations where match_id = p_match_id and shooter_id = v_sid;
  if not found then return jsonb_build_object('registered', false, 'visible', false); end if;
  select positions_visible, results_published, status, max_score, sheets, shots_per_sheet, lanes_published
    into v_visible, v_pub, v_status, v_max, v_sheets, v_per, v_lane_pub from public.matches where id = p_match_id;
  select score, inner_tens, sheet_scores into v_score, v_inner, v_sheet_scores
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
  return jsonb_build_object('registered', true, 'visible', v_visible, 'rank', v_rank, 'total', v_total,
    'score', v_score, 'inner_tens', v_inner, 'sheet_scores', to_jsonb(v_sheet_scores),
    'lane_no', v_lane, 'relay', v_relay, 'sheet_targets', to_jsonb(v_targets), 'lane_published', coalesce(v_lane_pub, false),
    'max_score', v_max, 'sheets', v_sheets, 'shots_per_sheet', v_per);
end; $$;

-- Tell each assigned shooter when the lane plan is published.
create or replace function public.notify_lanes_published()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.lanes_published and not old.lanes_published then
    insert into public.notifications(audience, shooter_id, type, title, message, data)
    select 'shooter', r.shooter_id, 'match_lane_assigned', 'Your lane is ready',
           new.name || ' · Lane ' || r.lane_no
             || case when new.relays > 1 then ' · Relay ' || r.relay else '' end
             || case when r.sheet_targets is not null and cardinality(r.sheet_targets) > 0
                     then ' · Target sheets ' || array_to_string(r.sheet_targets, ', ') else '' end,
           jsonb_build_object('match_id', new.id)
    from public.match_registrations r where r.match_id = new.id and r.lane_no is not null;
  end if;
  return new;
end; $$;
drop trigger if exists matches_notify_lanes on public.matches;
create trigger matches_notify_lanes after update of lanes_published on public.matches for each row execute function public.notify_lanes_published();

-- Mark every unread notification of the signed-in user as read (not only the ones currently on screen).
create or replace function public.mark_all_notifications_read(p_audience text default 'shooter')
returns void language plpgsql security definer set search_path = public
as $$
begin
  if p_audience = 'admin' then
    if not public.is_academy_admin() then raise exception 'Not allowed'; end if;
    update public.notifications set read_at = now() where audience = 'admin' and read_at is null;
  else
    update public.notifications set read_at = now()
      where audience = 'shooter' and shooter_id = public.my_shooter_id() and read_at is null;
  end if;
end; $$;
revoke all on function public.mark_all_notifications_read(text) from public, anon;
grant execute on function public.mark_all_notifications_read(text) to authenticated;
