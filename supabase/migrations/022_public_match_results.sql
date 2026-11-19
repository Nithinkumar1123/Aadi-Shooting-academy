-- 022: Published results are visible to EVERY shooter, not only those who registered.
--
-- Before: match_full_results() returned nothing unless the caller had registered for the match, and the
--         app only asked for registration counts on matches the shooter was part of (so a completed match
--         showed "0 registered" to everyone else).
-- Now:    once the academy marks a completed match as "results published", any signed-in shooter (including
--         a new member or someone who skipped the match) can see the podium, full standings and team
--         standings. Personal data (lane, targets, own shot-by-shot) still comes only from my_match_position().

create or replace function public.match_full_results(p_match_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare v_sid uuid := public.my_shooter_id(); v_pub boolean; v_status text; v_format text; v_rows jsonb; v_teams jsonb := '[]'::jsonb; v_my_team uuid;
        v_registered int; v_took_part boolean := false;
begin
  if v_sid is null then return jsonb_build_object('available', false); end if;
  select results_published, status, format into v_pub, v_status, v_format from public.matches where id = p_match_id;
  if not (coalesce(v_pub, false) and v_status = 'completed') then return jsonb_build_object('available', false); end if;
  select team_id into v_my_team from public.match_registrations where match_id = p_match_id and shooter_id = v_sid;
  select count(*)::int into v_registered from public.match_registrations where match_id = p_match_id;
  select exists (select 1 from public.match_registrations where match_id = p_match_id and shooter_id = v_sid) into v_took_part;
  select coalesce(jsonb_agg(jsonb_build_object(
      'rank', t.rnk, 'name', t.full_name, 'score', t.score, 'inner_tens', t.inner_tens,
      'sheet_scores', to_jsonb(t.sheet_scores), 'lane_no', t.lane_no, 'is_guest', t.is_guest, 'team', t.team_name,
      'is_me', coalesce(t.shooter_id = v_sid, false)) order by t.rnk, t.full_name), '[]'::jsonb)
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
        'scored', q.scored, 'players', q.players, 'members', q.members, 'is_mine', coalesce(q.id = v_my_team, false)) order by q.rnk, q.name), '[]'::jsonb)
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
  return jsonb_build_object('available', true, 'rows', v_rows, 'format', v_format, 'teams', v_teams,
                            'registered', v_registered, 'took_part', v_took_part);
end; $$;
revoke all on function public.match_full_results(uuid) from public, anon;
grant execute on function public.match_full_results(uuid) to authenticated;

-- Registration counts for every match in ONE call (replaces one request per match).
create or replace function public.match_registration_counts()
returns jsonb language sql stable security definer set search_path = public
as $$
  select coalesce(jsonb_object_agg(m.id::text, coalesce(c.n, 0)), '{}'::jsonb)
  from public.matches m
  left join (select match_id, count(*)::int as n from public.match_registrations group by match_id) c on c.match_id = m.id
$$;
revoke all on function public.match_registration_counts() from public, anon;
grant execute on function public.match_registration_counts() to authenticated;

notify pgrst, 'reload schema';
