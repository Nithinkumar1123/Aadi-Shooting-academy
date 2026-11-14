-- AADI Rifle Shooting: shooter self sign-up with admin approval.
-- Run in Supabase SQL Editor AFTER 001_initial_schema.sql.

alter table public.shooters add column if not exists user_id uuid unique references auth.users(id) on delete set null;
alter table public.shooters add column if not exists approval_status text not null default 'approved'
  check (approval_status in ('pending','approved','rejected'));
alter table public.shooters add column if not exists rejection_reason text;
alter table public.shooters add column if not exists reviewed_by uuid references auth.users(id);
alter table public.shooters add column if not exists reviewed_at timestamptz;

-- Rows created by admins stay 'approved' (the default). Self sign-ups are created as 'pending' by the function below.

-- A signed-in shooter can read ONLY their own record.
drop policy if exists "Shooters read own record" on public.shooters;
create policy "Shooters read own record" on public.shooters
  for select to authenticated using (user_id = auth.uid());

-- Shooter submits their details after creating an account. Creates a pending, inactive record.
create or replace function public.register_as_shooter(
  p_full_name text,
  p_phone text default null,
  p_date_of_birth date default null,
  p_guardian_name text default null,
  p_guardian_phone text default null,
  p_discipline text default '10m Air Rifle'
) returns void language plpgsql security definer set search_path = public
as $$
declare v_email text;
begin
  if auth.uid() is null then raise exception 'Please sign in first'; end if;
  if public.is_academy_admin() then raise exception 'Academy staff accounts cannot register as shooters'; end if;
  if exists(select 1 from public.shooters where user_id = auth.uid()) then raise exception 'You have already submitted a registration'; end if;
  if coalesce(trim(p_full_name),'') = '' then raise exception 'Full name is required'; end if;
  select email into v_email from auth.users where id = auth.uid();
  insert into public.shooters(shooter_code, full_name, phone, email, date_of_birth, guardian_name, guardian_phone, discipline, status, approval_status, user_id)
  values ('AADI-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,6)), trim(p_full_name), p_phone, v_email, p_date_of_birth,
          p_guardian_name, p_guardian_phone, coalesce(p_discipline,'10m Air Rifle'), 'inactive', 'pending', auth.uid());
end; $$;

-- Admin approves or rejects. Approved shooters become active and can be checked in; rejected stay inactive.
create or replace function public.review_shooter(p_shooter_id uuid, p_approve boolean, p_reason text default null)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_academy_admin() then raise exception 'Not authorized'; end if;
  update public.shooters set
    approval_status = case when p_approve then 'approved' else 'rejected' end,
    status = case when p_approve then 'active' else 'inactive' end,
    rejection_reason = case when p_approve then null else p_reason end,
    reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
  where id = p_shooter_id;
  if not found then raise exception 'Shooter not found'; end if;
end; $$;

revoke all on function public.register_as_shooter(text,text,date,text,text,text) from public;
revoke all on function public.review_shooter(uuid,boolean,text) from public;
grant execute on function public.register_as_shooter(text,text,date,text,text,text) to authenticated;
grant execute on function public.review_shooter(uuid,boolean,text) to authenticated;
