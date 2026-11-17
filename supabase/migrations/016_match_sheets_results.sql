-- 016: Sheet-wise match scoring, lane / target numbers, and full results after a match is completed.
--  * A match is shot over several sheets (series), e.g. 6 sheets x 10 shots. Admin enters each sheet's score;
--    the total is calculated automatically. Sheets can be filled in one by one while the match is running.
--  * A shooter always sees their OWN sheet-wise scores and total (live).
--  * Their position is shown only when the admin switches "positions_visible" on.
--  * Other shooters' positions and scores are shown only when the match is COMPLETED and the admin has
--    published the results (results_published).

alter table public.matches add column if not exists sheets int not null default 6 check (sheets > 0);
alter table public.matches add column if not exists shots_per_sheet int not null default 10 check (shots_per_sheet > 0);
alter table public.matches add column if not exists results_published boolean not null default false;

alter table public.match_registrations add column if not exists lane_no text;

-- One entry per sheet; an entry stays null until that sheet has been shot.
alter table public.match_scores add column if not exists sheet_scores numeric(5,1)[];

-- Total = sum of the sheets entered; each sheet is checked against its own maximum.
create or replace function public.check_match_score()
returns trigger language plpgsql security definer set search_path = public
as $$
declare v_max numeric; v_sheets int; v_sheet_max numeric; v_val numeric; v_n int := 0;
begin
  select max_score, sheets into v_max, v_sheets from public.matches where id = new.match_id;
  if v_max is null then raise exception 'Match not found'; end if;
  if not exists (select 1 from public.match_registrations r where r.match_id = new.match_id and r.shooter_id = new.shooter_id) then
    raise exception 'This shooter is not registered for the match';
  end if;
  if new.sheet_scores is not null and cardinality(new.sheet_scores) > 0 then
    if cardinality(new.sheet_scores) > v_sheets then raise exception 'This match has only % sheets', v_sheets; end if;
    v_sheet_max := v_max / v_sheets;
    new.score := 0;
    foreach v_val in array new.sheet_scores loop
      if v_val is not null then
        if v_val < 0 or v_val > v_sheet_max + 0.0001 then raise exception 'Each sheet must be between 0 and %', round(v_sheet_max, 1); end if;
        new.score := new.score + v_val; v_n := v_n + 1;
      end if;
    end loop;
    if v_n = 0 then raise exception 'Enter at least one sheet score'; end if;
  end if;
  if new.score > v_max then raise exception 'Score % is higher than the match maximum of %', new.score, v_max; end if;
  return new;
end; $$;

-- The shooter's OWN numbers. Score and sheets are always returned; rank only when the admin allows it
-- (or the results are published for a completed match).
create or replace function public.my_match_position(p_match_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare
  v_sid uuid := public.my_shooter_id();
  v_visible boolean; v_pub boolean; v_status text; v_max numeric; v_sheets int; v_per int;
  v_rank bigint; v_total bigint; v_score numeric; v_inner int; v_sheet_scores numeric[]; v_lane text;
begin
  if v_sid is null then return jsonb_build_object('registered', false, 'visible', false); end if;
  select lane_no into v_lane from public.match_registrations where match_id = p_match_id and shooter_id = v_sid;
  if not found then return jsonb_build_object('registered', false, 'visible', false); end if;
  select positions_visible, results_published, status, max_score, sheets, shots_per_sheet
    into v_visible, v_pub, v_status, v_max, v_sheets, v_per from public.matches where id = p_match_id;
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
  return jsonb_build_object('registered', true, 'visible', v_visible, 'rank', v_rank, 'total', v_total,
    'score', v_score, 'inner_tens', v_inner, 'sheet_scores', to_jsonb(v_sheet_scores), 'lane_no', v_lane,
    'max_score', v_max, 'sheets', v_sheets, 'shots_per_sheet', v_per);
end; $$;

-- Full results (everyone's position and scores). Only for registered shooters, only when the match is
-- completed AND the admin has published the results.
create or replace function public.match_full_results(p_match_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare v_sid uuid := public.my_shooter_id(); v_pub boolean; v_status text; v_rows jsonb;
begin
  if v_sid is null or not exists (select 1 from public.match_registrations where match_id = p_match_id and shooter_id = v_sid) then
    return jsonb_build_object('available', false);
  end if;
  select results_published, status into v_pub, v_status from public.matches where id = p_match_id;
  if not (coalesce(v_pub, false) and v_status = 'completed') then return jsonb_build_object('available', false); end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'rank', t.rnk, 'name', t.full_name, 'score', t.score, 'inner_tens', t.inner_tens,
      'sheet_scores', to_jsonb(t.sheet_scores), 'lane_no', t.lane_no, 'is_me', t.shooter_id = v_sid) order by t.rnk, t.full_name), '[]'::jsonb)
    into v_rows
  from (
    select s.shooter_id, sh.full_name, s.score, s.inner_tens, s.sheet_scores, r.lane_no,
           rank() over (order by s.score desc, s.inner_tens desc) as rnk
    from public.match_scores s
    join public.shooters sh on sh.id = s.shooter_id
    left join public.match_registrations r on r.match_id = s.match_id and r.shooter_id = s.shooter_id
    where s.match_id = p_match_id
  ) t;
  return jsonb_build_object('available', true, 'rows', v_rows);
end; $$;
revoke all on function public.match_full_results(uuid) from public, anon;
grant execute on function public.match_full_results(uuid) to authenticated;

-- Tell registered shooters when the final results are published.
create or replace function public.notify_results_published()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.results_published and not old.results_published then
    insert into public.notifications(audience, shooter_id, type, title, message, data)
    select 'shooter', r.shooter_id, 'match_results_published', 'Results are out',
           'The final results of ' || new.name || ' are now available in the Matches tab.',
           jsonb_build_object('match_id', new.id)
    from public.match_registrations r where r.match_id = new.id;
  end if;
  return new;
end; $$;
drop trigger if exists matches_notify_results on public.matches;
create trigger matches_notify_results after update of results_published on public.matches for each row execute function public.notify_results_published();

-- Publishing results also nudges shooters' screens (scores_version drives the live refresh).
create or replace function public.bump_on_publish()
returns trigger language plpgsql as $$
begin
  if new.results_published is distinct from old.results_published or new.status is distinct from old.status then
    new.scores_version := old.scores_version + 1;
  end if;
  return new;
end; $$;
drop trigger if exists matches_bump_publish on public.matches;
create trigger matches_bump_publish before update on public.matches for each row execute function public.bump_on_publish();
