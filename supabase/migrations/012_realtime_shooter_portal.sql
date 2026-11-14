-- Enable Supabase Realtime for all shooter-facing records so the portal
-- updates automatically without a manual refresh.

do $$
begin
  begin alter publication supabase_realtime add table public.attendance; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.fees; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.shooter_exit_requests; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.shooters; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.shooting_scores; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.notifications; exception when duplicate_object then null; end;
end $$;
