-- 009: tell shooters when a published score contains shot-by-shot details.
create or replace function public.notify_score_published()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  v_has_shot_details boolean := coalesce(cardinality(new.shot_values), 0) > 0;
  v_message text;
begin
  v_message := new.event_name || ' · ' || new.score || '/' || new.max_score || ' · ' || to_char(new.session_date,'DD Mon YYYY');
  if v_has_shot_details then
    v_message := v_message || ' · Shot-by-shot details are available in your Scores section.';
  end if;
  insert into public.notifications(audience,shooter_id,type,title,message,data)
  values ('shooter',new.shooter_id,'score_published','New score published',v_message,
          jsonb_build_object('score_id',new.id,'has_shot_details',v_has_shot_details));
  return new;
end; $$;

drop trigger if exists scores_notify_published on public.shooting_scores;
create trigger scores_notify_published after insert on public.shooting_scores for each row execute function public.notify_score_published();
