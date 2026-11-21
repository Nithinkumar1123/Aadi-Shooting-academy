-- 027: Keep the main Shooting Scores history in sync with competition results.
-- A shooter's match result becomes a normal score-history entry automatically.
-- Practice scores remain independent (match_id is NULL).

alter table public.shooting_scores
  add column if not exists match_id uuid references public.matches(id) on delete cascade;

create unique index if not exists shooting_scores_match_id_uidx
  on public.shooting_scores(match_id)
  where match_id is not null;

create index if not exists shooting_scores_match_shooter_idx
  on public.shooting_scores(shooter_id, session_date desc)
  where match_id is not null;

create or replace function public.sync_match_score_to_shooting_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match public.matches%rowtype;
  v_notes text;
begin
  if tg_op = 'DELETE' then
    delete from public.shooting_scores where match_id = old.match_id;
    return old;
  end if;

  -- If an admin changes the shooter or match on an existing result, remove
  -- the old linked history row before writing the new one.
  if tg_op = 'UPDATE' and (old.match_id is distinct from new.match_id
      or old.shooter_id is distinct from new.shooter_id) then
    delete from public.shooting_scores where match_id = old.match_id;
  end if;

  select * into v_match
  from public.matches
  where id = new.match_id;

  if not found then
    raise exception 'Cannot add this result to score history: match not found';
  end if;

  v_notes := nullif(trim(coalesce(new.notes, '')), '');
  if new.inner_tens is not null then
    v_notes := concat_ws(' · ', v_notes, 'Inner tens: ' || new.inner_tens);
  end if;

  insert into public.shooting_scores (
    shooter_id,
    match_id,
    session_date,
    event_name,
    shots,
    score,
    max_score,
    notes,
    recorded_by
  ) values (
    new.shooter_id,
    new.match_id,
    v_match.match_date,
    v_match.name,
    greatest(coalesce(v_match.shots, 1), 1),
    new.score,
    v_match.max_score,
    v_notes,
    new.recorded_by
  )
  on conflict (match_id) where match_id is not null
  do update set
    shooter_id = excluded.shooter_id,
    session_date = excluded.session_date,
    event_name = excluded.event_name,
    shots = excluded.shots,
    score = excluded.score,
    max_score = excluded.max_score,
    notes = excluded.notes,
    recorded_by = excluded.recorded_by;

  return new;
end;
$$;

revoke all on function public.sync_match_score_to_shooting_history() from public;

drop trigger if exists match_scores_sync_shooting_history on public.match_scores;
create trigger match_scores_sync_shooting_history
after insert or update or delete on public.match_scores
for each row execute function public.sync_match_score_to_shooting_history();

-- Backfill results already recorded before this migration was installed.
insert into public.shooting_scores (
  shooter_id, match_id, session_date, event_name, shots,
  score, max_score, notes, recorded_by
)
select
  ms.shooter_id,
  ms.match_id,
  m.match_date,
  m.name,
  greatest(coalesce(m.shots, 1), 1),
  ms.score,
  m.max_score,
  concat_ws(' · ', nullif(trim(coalesce(ms.notes, '')), ''),
    case when ms.inner_tens is not null then 'Inner tens: ' || ms.inner_tens end),
  ms.recorded_by
from public.match_scores ms
join public.matches m on m.id = ms.match_id
on conflict (match_id) where match_id is not null
 do update set
  shooter_id = excluded.shooter_id,
  session_date = excluded.session_date,
  event_name = excluded.event_name,
  shots = excluded.shots,
  score = excluded.score,
  max_score = excluded.max_score,
  notes = excluded.notes,
  recorded_by = excluded.recorded_by;

comment on column public.shooting_scores.match_id is
  'Links this score-history entry to its competition result. NULL for practice scores.';
