-- 008: shooter leave/exit workflow and past-shooter management.
create table if not exists public.shooter_exit_requests (
  id uuid primary key default gen_random_uuid(),
  shooter_id uuid not null references public.shooters(id) on delete cascade,
  reason text not null check (length(trim(reason)) >= 3),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id),
  review_note text
);
create index if not exists shooter_exit_requests_shooter_idx on public.shooter_exit_requests(shooter_id, requested_at desc);
create index if not exists shooter_exit_requests_pending_idx on public.shooter_exit_requests(status, requested_at desc) where status = 'pending';

alter table public.shooters add column if not exists archived_at timestamptz;
alter table public.shooters add column if not exists archive_reason text;

alter table public.shooter_exit_requests enable row level security;

drop policy if exists "Shooters create own exit request" on public.shooter_exit_requests;
create policy "Shooters create own exit request" on public.shooter_exit_requests
  for insert to authenticated
  with check (shooter_id = public.my_shooter_id() and status = 'pending');

drop policy if exists "Shooters read own exit requests" on public.shooter_exit_requests;
create policy "Shooters read own exit requests" on public.shooter_exit_requests
  for select to authenticated
  using (shooter_id = public.my_shooter_id() or public.is_academy_admin());

drop policy if exists "Admins manage exit requests" on public.shooter_exit_requests;
create policy "Admins manage exit requests" on public.shooter_exit_requests
  for update to authenticated
  using (public.is_academy_admin())
  with check (public.is_academy_admin());

drop policy if exists "Admins delete exit requests" on public.shooter_exit_requests;
create policy "Admins delete exit requests" on public.shooter_exit_requests
  for delete to authenticated
  using (public.is_academy_admin());

create or replace function public.request_shooter_exit(p_reason text)
returns uuid language plpgsql security definer set search_path = public
as $$
declare v_shooter_id uuid; v_request_id uuid;
begin
  v_shooter_id := public.my_shooter_id();
  if v_shooter_id is null then raise exception 'Shooter profile not found'; end if;
  if exists(select 1 from public.shooter_exit_requests where shooter_id = v_shooter_id and status = 'pending') then
    raise exception 'You already have a pending leave request';
  end if;
  if exists(select 1 from public.shooters where id = v_shooter_id and (approval_status <> 'approved' or status <> 'active')) then
    raise exception 'Only active approved shooters can request to leave';
  end if;
  insert into public.shooter_exit_requests(shooter_id, reason)
  values (v_shooter_id, trim(p_reason))
  returning id into v_request_id;
  insert into public.notifications(audience,type,title,message,data)
  values ('admin','shooter_exit_request','Shooter leave request',
          (select full_name from public.shooters where id = v_shooter_id) || ' requested to leave the academy.',
          jsonb_build_object('shooter_id',v_shooter_id,'request_id',v_request_id));
  return v_request_id;
end; $$;
revoke all on function public.request_shooter_exit(text) from public;
grant execute on function public.request_shooter_exit(text) to authenticated;

create or replace function public.review_shooter_exit_request(p_request_id uuid, p_approve boolean, p_note text default null)
returns void language plpgsql security definer set search_path = public
as $$
declare v_req public.shooter_exit_requests%rowtype; v_shooter public.shooters%rowtype;
begin
  if not public.is_academy_admin() then raise exception 'Not authorized'; end if;
  select * into v_req from public.shooter_exit_requests where id = p_request_id for update;
  if not found then raise exception 'Exit request not found'; end if;
  if v_req.status <> 'pending' then raise exception 'This exit request has already been reviewed'; end if;
  select * into v_shooter from public.shooters where id = v_req.shooter_id for update;
  if not found then raise exception 'Shooter not found'; end if;
  if p_approve and exists(select 1 from public.attendance where shooter_id = v_req.shooter_id and checked_out_at is null) then
    raise exception 'Please check the shooter out before approving this leave request';
  end if;

  update public.shooter_exit_requests
     set status = case when p_approve then 'approved' else 'rejected' end,
         reviewed_at = now(), reviewed_by = auth.uid(), review_note = nullif(trim(p_note), '')
   where id = p_request_id;

  if p_approve then
    update public.shooters
       set status = 'inactive', archived_at = now(), archive_reason = v_req.reason, updated_at = now()
     where id = v_req.shooter_id;
    update public.shooter_qr_codes set is_active = false, revoked_at = now()
     where shooter_id = v_req.shooter_id and is_active;
    insert into public.notifications(audience,shooter_id,type,title,message,data)
    values ('shooter',v_req.shooter_id,'exit_approved','Membership closed',
            'Your request to leave AADI Rifle Shooting Academy has been approved. Your records have been moved to Past Shooters.',
            jsonb_build_object('request_id',p_request_id));
  else
    insert into public.notifications(audience,shooter_id,type,title,message,data)
    values ('shooter',v_req.shooter_id,'exit_rejected','Leave request not approved',
            coalesce(nullif(trim(p_note), ''),'Your leave request was not approved. Please contact the academy.'),
            jsonb_build_object('request_id',p_request_id));
  end if;
end; $$;
revoke all on function public.review_shooter_exit_request(uuid,boolean,text) from public;
grant execute on function public.review_shooter_exit_request(uuid,boolean,text) to authenticated;

create or replace function public.restore_past_shooter(p_shooter_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_academy_admin() then raise exception 'Not authorized'; end if;
  update public.shooters
     set status = 'active', archived_at = null, archive_reason = null, updated_at = now()
   where id = p_shooter_id and approval_status = 'approved';
  if not found then raise exception 'Past shooter not found or not approved'; end if;
  insert into public.notifications(audience,shooter_id,type,title,message,data)
  values ('shooter',p_shooter_id,'membership_restored','Membership restored','Your AADI membership has been restored. Welcome back.',jsonb_build_object('shooter_id',p_shooter_id));
end; $$;
revoke all on function public.restore_past_shooter(uuid) from public;
grant execute on function public.restore_past_shooter(uuid) to authenticated;

create or replace function public.permanently_delete_shooter(p_shooter_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_academy_admin() then raise exception 'Not authorized'; end if;
  if not exists(select 1 from public.shooters where id = p_shooter_id and status = 'inactive') then
    raise exception 'Only a past shooter can be permanently deleted';
  end if;
  delete from public.attendance where shooter_id = p_shooter_id;
  delete from public.shooters where id = p_shooter_id;
end; $$;
revoke all on function public.permanently_delete_shooter(uuid) from public;
grant execute on function public.permanently_delete_shooter(uuid) to authenticated;
