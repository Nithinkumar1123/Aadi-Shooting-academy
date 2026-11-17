-- 019: Sighting sheets (weapon set-up).
--  * Usually 2 sheets are issued first so the shooter can zero the weapon. They are NOT part of the match:
--    they never count towards the sheet scores, the total, the maximum or the ranking.
--  * matches.sighting_sheets = how many such sheets the match gives (0-5, default 2).
--  * match_scores.sighting_scores = optional record of the sighting shots (information only).
--  * match_registrations.sheet_targets now lists EVERY sheet issued: sighting sheets first, then the scored series.

alter table public.matches add column if not exists sighting_sheets int not null default 2 check (sighting_sheets between 0 and 5);
alter table public.match_scores add column if not exists sighting_scores jsonb;

-- Shooter's own numbers (adds sighting_sheets; scores/rank still come only from the scored sheets).
create or replace function public.my_match_position(p_match_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare
  v_sid uuid := public.my_shooter_id();
  v_visible boolean; v_pub boolean; v_status text; v_max numeric; v_sheets int; v_per int; v_lane_pub boolean; v_sight int;
  v_rank bigint; v_total bigint; v_score numeric; v_inner int; v_sheet_scores numeric[]; v_shots jsonb;
  v_lane text; v_relay int; v_targets text[];
begin
  if v_sid is null then return jsonb_build_object('registered', false, 'visible', false); end if;
  select lane_no, relay, sheet_targets into v_lane, v_relay, v_targets
    from public.match_registrations where match_id = p_match_id and shooter_id = v_sid;
  if not found then return jsonb_build_object('registered', false, 'visible', false); end if;
  select positions_visible, results_published, status, max_score, sheets, shots_per_sheet, lanes_published, sighting_sheets
    into v_visible, v_pub, v_status, v_max, v_sheets, v_per, v_lane_pub, v_sight from public.matches where id = p_match_id;
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
  return jsonb_build_object('registered', true, 'visible', v_visible, 'rank', v_rank, 'total', v_total,
    'score', v_score, 'inner_tens', v_inner, 'sheet_scores', to_jsonb(v_sheet_scores), 'shot_scores', v_shots,
    'lane_no', v_lane, 'relay', v_relay, 'sheet_targets', to_jsonb(v_targets), 'lane_published', coalesce(v_lane_pub, false),
    'max_score', v_max, 'sheets', v_sheets, 'shots_per_sheet', v_per, 'sighting_sheets', v_sight);
end; $$;
