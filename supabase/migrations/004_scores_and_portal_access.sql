-- 004: shooting scores + let shooters read their own attendance, scores and QR status.

-- The signed-in shooter's own id (used by the policies below).
create or replace function public.my_shooter_id()
returns uuid language sql stable security definer set search_path = public
as $$ select id from public.shooters where user_id = auth.uid() limit 1 $$;
grant execute on function public.my_shooter_id() to authenticated;

-- Scores recorded by academy staff.
create table if not exists public.shooting_scores (
  id uuid primary key default gen_random_uuid(),
  shooter_id uuid not null references public.shooters(id) on delete cascade,
  session_date date not null default current_date,
  event_name text not null default 'Practice',
  shots int not null default 10 check (shots > 0),
  score numeric(6,1) not null check (score >= 0),
  max_score numeric(6,1) not null default 100 check (max_score > 0),
  notes text,
  recorded_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  check (score <= max_score)
);
create index if not exists shooting_scores_shooter_idx on public.shooting_scores(shooter_id, session_date desc);

alter table public.shooting_scores enable row level security;

drop policy if exists "Admins manage scores" on public.shooting_scores;
create policy "Admins manage scores" on public.shooting_scores
  for all to authenticated using (public.is_academy_admin()) with check (public.is_academy_admin());

drop policy if exists "Shooters read own scores" on public.shooting_scores;
create policy "Shooters read own scores" on public.shooting_scores
  for select to authenticated using (shooter_id = public.my_shooter_id());

-- Shooters can read their own attendance history.
drop policy if exists "Shooters read own attendance" on public.attendance;
create policy "Shooters read own attendance" on public.attendance
  for select to authenticated using (shooter_id = public.my_shooter_id());

-- Lets the shooter's page check whether the QR saved on their device is still the active one.
create or replace function public.my_qr_is_valid(p_token text)
returns boolean language sql stable security definer set search_path = public, extensions
as $$
  select exists(
    select 1 from public.shooter_qr_codes q
    where q.shooter_id = public.my_shooter_id()
      and q.is_active
      and q.token_hash = encode(digest(p_token, 'sha256'), 'hex'));
$$;
revoke all on function public.my_qr_is_valid(text) from public;
grant execute on function public.my_qr_is_valid(text) to authenticated;
