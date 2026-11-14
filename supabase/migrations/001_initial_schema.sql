-- Rifle Shooting Academy: initial schema
-- Apply in Supabase SQL Editor. Do not expose service_role keys in the frontend.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  role text not null default 'admin' check (role in ('super_admin','admin','coach','reception')),
  created_at timestamptz not null default now()
);

create table if not exists public.shooters (
  id uuid primary key default gen_random_uuid(),
  shooter_code text not null unique,
  full_name text not null,
  phone text,
  email text,
  date_of_birth date,
  guardian_name text,
  guardian_phone text,
  discipline text not null default '10m Air Rifle',
  status text not null default 'active' check (status in ('active','inactive','suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.rifles (
  id uuid primary key default gen_random_uuid(),
  rifle_code text not null unique,
  name text,
  serial_number text,
  status text not null default 'available' check (status in ('available','maintenance','retired')),
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.shooter_qr_codes (
  id uuid primary key default gen_random_uuid(),
  shooter_id uuid not null references public.shooters(id) on delete cascade,
  token_hash text not null unique,
  is_active boolean not null default true,
  issued_at timestamptz not null default now(),
  revoked_at timestamptz
);
create unique index if not exists one_active_qr_per_shooter on public.shooter_qr_codes(shooter_id) where is_active;

create table if not exists public.attendance (
  id uuid primary key default gen_random_uuid(),
  shooter_id uuid not null references public.shooters(id),
  checked_in_at timestamptz not null default now(),
  checked_out_at timestamptz,
  recorded_by uuid references auth.users(id),
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists attendance_checked_in_idx on public.attendance(checked_in_at desc);
create unique index if not exists one_open_attendance_per_shooter on public.attendance(shooter_id) where checked_out_at is null;

create table if not exists public.rifle_allocations (
  id uuid primary key default gen_random_uuid(),
  attendance_id uuid not null references public.attendance(id) on delete cascade,
  shooter_id uuid not null references public.shooters(id),
  rifle_id uuid not null references public.rifles(id),
  issued_at timestamptz not null default now(),
  returned_at timestamptz,
  issued_by uuid references auth.users(id),
  returned_by uuid references auth.users(id),
  notes text
);
create unique index if not exists one_open_allocation_per_rifle on public.rifle_allocations(rifle_id) where returned_at is null;
create index if not exists allocations_shooter_idx on public.rifle_allocations(shooter_id, issued_at desc);

create or replace function public.is_academy_admin()
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.profiles where id = auth.uid() and role in ('super_admin','admin','reception')) $$;

alter table public.profiles enable row level security;
alter table public.shooters enable row level security;
alter table public.rifles enable row level security;
alter table public.shooter_qr_codes enable row level security;
alter table public.attendance enable row level security;
alter table public.rifle_allocations enable row level security;

drop policy if exists "Users read own profile" on public.profiles;
create policy "Users read own profile" on public.profiles for select to authenticated using (id = auth.uid() or public.is_academy_admin());
drop policy if exists "Admins update profiles" on public.profiles;
create policy "Admins update profiles" on public.profiles for update to authenticated using (public.is_academy_admin()) with check (public.is_academy_admin());
drop policy if exists "Admins manage shooters" on public.shooters;
create policy "Admins manage shooters" on public.shooters for all to authenticated using (public.is_academy_admin()) with check (public.is_academy_admin());
drop policy if exists "Admins manage rifles" on public.rifles;
create policy "Admins manage rifles" on public.rifles for all to authenticated using (public.is_academy_admin()) with check (public.is_academy_admin());
drop policy if exists "Admins manage QR codes" on public.shooter_qr_codes;
create policy "Admins manage QR codes" on public.shooter_qr_codes for all to authenticated using (public.is_academy_admin()) with check (public.is_academy_admin());
drop policy if exists "Admins read attendance" on public.attendance;
create policy "Admins read attendance" on public.attendance for select to authenticated using (public.is_academy_admin());
drop policy if exists "Admins manage attendance" on public.attendance;
create policy "Admins manage attendance" on public.attendance for update to authenticated using (public.is_academy_admin()) with check (public.is_academy_admin());
drop policy if exists "Admins read allocations" on public.rifle_allocations;
create policy "Admins read allocations" on public.rifle_allocations for select to authenticated using (public.is_academy_admin());

-- Initial setup: create an auth user, then promote that user to super_admin.
-- insert into public.profiles(id, full_name, role) values ('AUTH_USER_UUID','Academy Owner','super_admin');

create or replace function public.issue_shooter_qr(p_shooter_id uuid, p_token text)
returns void language plpgsql security definer set search_path = public, extensions
as $$
begin
  if not public.is_academy_admin() then raise exception 'Not authorized'; end if;
  if length(p_token) < 32 then raise exception 'Invalid QR token'; end if;
  if not exists(select 1 from public.shooters where id = p_shooter_id) then raise exception 'Shooter not found'; end if;
  update public.shooter_qr_codes set is_active = false, revoked_at = now() where shooter_id = p_shooter_id and is_active;
  insert into public.shooter_qr_codes(shooter_id, token_hash) values (p_shooter_id, encode(digest(p_token, 'sha256'), 'hex'));
end; $$;

create or replace function public.check_in_with_rifle(p_token text, p_rifle_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public, extensions
as $$
declare v_shooter public.shooters%rowtype; v_attendance_id uuid; v_rifle_code text;
begin
  if not public.is_academy_admin() then raise exception 'Not authorized'; end if;
  select s.* into v_shooter from public.shooter_qr_codes q join public.shooters s on s.id=q.shooter_id
   where q.token_hash=encode(digest(p_token,'sha256'),'hex') and q.is_active and s.status='active' for update of s;
  if not found then raise exception 'QR code is invalid, expired or shooter is inactive'; end if;
  if exists(select 1 from public.attendance where shooter_id=v_shooter.id and checked_out_at is null) then raise exception 'Shooter already has an open session'; end if;
  if p_rifle_id is not null then
    select rifle_code into v_rifle_code from public.rifles where id=p_rifle_id and status='available' for update;
    if not found then raise exception 'Selected rifle is unavailable'; end if;
    if exists(select 1 from public.rifle_allocations where rifle_id=p_rifle_id and returned_at is null) then raise exception 'Rifle is already allocated'; end if;
  end if;
  insert into public.attendance(shooter_id, recorded_by) values(v_shooter.id,auth.uid()) returning id into v_attendance_id;
  if p_rifle_id is not null then insert into public.rifle_allocations(attendance_id,shooter_id,rifle_id,issued_by) values(v_attendance_id,v_shooter.id,p_rifle_id,auth.uid()); end if;
  return jsonb_build_object('attendance_id',v_attendance_id,'shooter_id',v_shooter.id,'shooter_name',v_shooter.full_name,'shooter_code',v_shooter.shooter_code,'rifle_code',v_rifle_code,'checked_in_at',now());
end; $$;

create or replace function public.check_out_with_rifle(p_token text)
returns jsonb language plpgsql security definer set search_path = public, extensions
as $$
declare v_shooter public.shooters%rowtype; v_attendance_id uuid; v_rifle_code text; v_now timestamptz := now();
begin
  if not public.is_academy_admin() then raise exception 'Not authorized'; end if;
  select s.* into v_shooter from public.shooter_qr_codes q join public.shooters s on s.id=q.shooter_id
   where q.token_hash=encode(digest(p_token,'sha256'),'hex') and q.is_active for update of s;
  if not found then raise exception 'QR code is invalid or expired'; end if;
  select id into v_attendance_id from public.attendance where shooter_id=v_shooter.id and checked_out_at is null for update;
  if not found then raise exception 'No active session found for this shooter'; end if;
  update public.attendance set checked_out_at=v_now where id=v_attendance_id;
  select r.rifle_code into v_rifle_code from public.rifle_allocations a join public.rifles r on r.id=a.rifle_id where a.attendance_id=v_attendance_id and a.returned_at is null limit 1;
  update public.rifle_allocations set returned_at=v_now, returned_by=auth.uid() where attendance_id=v_attendance_id and returned_at is null;
  return jsonb_build_object('attendance_id',v_attendance_id,'shooter_id',v_shooter.id,'shooter_name',v_shooter.full_name,'shooter_code',v_shooter.shooter_code,'rifle_code',v_rifle_code,'checked_out_at',v_now);
end; $$;

revoke all on function public.issue_shooter_qr(uuid,text) from public;
revoke all on function public.check_in_with_rifle(text,uuid) from public;
revoke all on function public.check_out_with_rifle(text) from public;
grant execute on function public.issue_shooter_qr(uuid,text) to authenticated;
grant execute on function public.check_in_with_rifle(text,uuid) to authenticated;
grant execute on function public.check_out_with_rifle(text) to authenticated;
