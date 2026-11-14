-- 011: deliver newly published/updated scores to the Shooter Portal without a page refresh.
-- Safe to run after migration 004/005/007/009.
do $$ begin
  alter publication supabase_realtime add table public.shooting_scores;
exception when duplicate_object then null; end $$;
