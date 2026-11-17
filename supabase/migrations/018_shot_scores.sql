-- 018: Shot-by-shot scoring.
--  * match_scores.shot_scores holds one array per sheet (series), one number per shot, e.g. [[10.4,9.8,...],[...]].
--  * Sheet totals are calculated from the shots; the match total from the sheets. Sheet-total-only entry still works.
--  * Each shot is checked against the per-shot maximum (max_score / total shots, 10.9 for decimal scoring).
--  * A shooter can see their OWN shot-by-shot scores.

alter table public.match_scores add column if not exists shot_scores jsonb;

create or replace function public.check_match_score()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  v_max numeric; v_sheets int; v_per int; v_sheet_max numeric; v_shot_max numeric; v_val numeric; v_n int := 0;
  v_arr numeric[]; v_i int; v_j int; v_sum numeric; v_cnt int; v_row jsonb; v_el jsonb;
begin
  select max_score, sheets, shots_per_sheet into v_max, v_sheets, v_per from public.matches where id = new.match_id;
  if v_max is null then raise exception 'Match not found'; end if;
  if not exists (select 1 from public.match_registrations r where r.match_id = new.match_id and r.shooter_id = new.shooter_id) then
    raise exception 'This shooter is not registered for the match';
  end if;

  -- Shot-by-shot entry: derive every sheet total from its shots.
  if new.shot_scores is not null and jsonb_typeof(new.shot_scores) = 'array' and jsonb_array_length(new.shot_scores) > 0 then
    if jsonb_array_length(new.shot_scores) > v_sheets then raise exception 'This match has only % sheets', v_sheets; end if;
    v_shot_max := v_max / (v_sheets * v_per);
    v_arr := array_fill(null::numeric, array[v_sheets]);
    for v_i in 0 .. jsonb_array_length(new.shot_scores) - 1 loop
      v_row := new.shot_scores -> v_i; v_sum := 0; v_cnt := 0;
      if jsonb_typeof(v_row) = 'array' then
        if jsonb_array_length(v_row) > v_per then raise exception 'Each sheet has only % shots', v_per; end if;
        for v_j in 0 .. jsonb_array_length(v_row) - 1 loop
          v_el := v_row -> v_j;
          if jsonb_typeof(v_el) = 'number' then
            v_val := (v_el #>> '{}')::numeric;
            if v_val < 0 or v_val > v_shot_max + 0.0001 then raise exception 'Each shot must be between 0 and %', round(v_shot_max, 1); end if;
            v_sum := v_sum + v_val; v_cnt := v_cnt + 1;
          end if;
        end loop;
      end if;
      if v_cnt > 0 then v_arr[v_i + 1] := round(v_sum, 1); end if;
    end loop;
    new.sheet_scores := v_arr;
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

-- Add the shooter's own shot-by-shot scores to my_match_position (everything else unchanged from 017).
create or replace function public.my_match_position(p_match_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare
  v_sid uuid := public.my_shooter_id();
  v_visible boolean; v_pub boolean; v_status text; v_max numeric; v_sheets int; v_per int; v_lane_pub boolean;
  v_rank bigint; v_total bigint; v_score numeric; v_inner int; v_sheet_scores numeric[]; v_shots jsonb;
  v_lane text; v_relay int; v_targets text[];
begin
  if v_sid is null then return jsonb_build_object('registered', false, 'visible', false); end if;
  select lane_no, relay, sheet_targets into v_lane, v_relay, v_targets
    from public.match_registrations where match_id = p_match_id and shooter_id = v_sid;
  if not found then return jsonb_build_object('registered', false, 'visible', false); end if;
  select positions_visible, results_published, status, max_score, sheets, shots_per_sheet, lanes_published
    into v_visible, v_pub, v_status, v_max, v_sheets, v_per, v_lane_pub from public.matches where id = p_match_id;
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
    'max_score', v_max, 'sheets', v_sheets, 'shots_per_sheet', v_per);
end; $$;
