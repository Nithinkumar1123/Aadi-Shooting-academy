-- 021: Family accounts — one login (one email), several members.
--
-- Typical case: a parent signs up with the family email and registers two children, and may also join
-- as a shooter. Each person is still their OWN shooter record: their own membership ID, approval,
-- QR pass, attendance, scores, fees, matches and notifications. Only the login is shared.
--
--   login (auth user) 1 ──── * shooters (family members)
--
-- Nothing changes for existing single-member accounts: they keep working exactly as before.
--
-- How "which member am I acting as?" works
--   * Reading data (scores, fees, attendance, notifications...) is allowed for EVERY member on the login,
--     so the app can show unread counts for all members and realtime keeps working.
--   * Actions "as me" (show my QR, register for a match, request to leave, ...) go through my_shooter_id().
--     The web app sends the chosen member in the `x-aadi-member` request header; the database only honours it
--     if that member belongs to the signed-in login, so nobody can act as someone else's family member.

-- 1) Allow many shooters per login --------------------------------------------------------------------
do $$
declare c text;
begin
  for c in
    select con.conname from pg_constraint con
    join pg_attribute att on att.attrelid = con.conrelid and att.attnum = any (con.conkey)
    where con.conrelid = 'public.shooters'::regclass and con.contype = 'u'
      and array_length(con.conkey, 1) = 1 and att.attname = 'user_id'
  loop
    execute format('alter table public.shooters drop constraint %I', c);
  end loop;
end $$;
create index if not exists shooters_user_idx on public.shooters(user_id) where user_id is not null;

-- Who this person is to the account holder (shown to admins; helps the parent tell cards apart).
alter table public.shooters add column if not exists relationship text not null default 'self';
do $$ begin
  alter table public.shooters add constraint shooters_relationship_check check (relationship in ('self','child','other'));
exception when duplicate_object then null; end $$;

-- 2) Which members belong to me, and which one am I acting as ----------------------------------------
create or replace function public.my_shooter_ids()
returns setof uuid language sql stable security definer set search_path = public
as $$ select id from public.shooters where user_id = auth.uid() $$;
revoke all on function public.my_shooter_ids() from public, anon;
grant execute on function public.my_shooter_ids() to authenticated;

create or replace function public.my_shooter_id()
returns uuid language plpgsql stable security definer set search_path = public
as $$
declare v_pick uuid;
begin
  if auth.uid() is null then return null; end if;
  begin
    v_pick := nullif(current_setting('request.headers', true)::json ->> 'x-aadi-member', '')::uuid;
  exception when others then v_pick := null;
  end;
  if v_pick is not null and exists(select 1 from public.shooters where id = v_pick and user_id = auth.uid()) then
    return v_pick;
  end if;
  -- No (valid) choice sent: single-member accounts land here and get their only record, as before.
  -- For families, prefer an active member over a pending one.
  return (select id from public.shooters where user_id = auth.uid()
          order by (approval_status = 'approved' and status = 'active') desc, created_at, id limit 1);
end $$;
grant execute on function public.my_shooter_id() to authenticated;

-- 3) Read policies: every member of the login may be read by that login ---------------------------------
drop policy if exists "Shooters read own scores" on public.shooting_scores;
create policy "Shooters read own scores" on public.shooting_scores
  for select to authenticated using (shooter_id in (select public.my_shooter_ids()));

drop policy if exists "Shooters read own attendance" on public.attendance;
create policy "Shooters read own attendance" on public.attendance
  for select to authenticated using (shooter_id in (select public.my_shooter_ids()));

drop policy if exists "Shooters read own fees" on public.fees;
create policy "Shooters read own fees" on public.fees
  for select to authenticated using (shooter_id in (select public.my_shooter_ids()));

drop policy if exists "Shooters read own match registrations" on public.match_registrations;
create policy "Shooters read own match registrations" on public.match_registrations
  for select to authenticated using (shooter_id in (select public.my_shooter_ids()));

drop policy if exists "Shooters read own notifications" on public.notifications;
create policy "Shooters read own notifications" on public.notifications
  for select to authenticated using (audience = 'shooter' and shooter_id in (select public.my_shooter_ids()));

drop policy if exists "Users mark their notifications read" on public.notifications;
create policy "Users mark their notifications read" on public.notifications
  for update to authenticated
  using ((audience = 'admin' and public.is_academy_admin()) or (audience = 'shooter' and shooter_id in (select public.my_shooter_ids())))
  with check ((audience = 'admin' and public.is_academy_admin()) or (audience = 'shooter' and shooter_id in (select public.my_shooter_ids())));

drop policy if exists "Shooters read own exit requests" on public.shooter_exit_requests;
create policy "Shooters read own exit requests" on public.shooter_exit_requests
  for select to authenticated
  using (shooter_id in (select public.my_shooter_ids()) or public.is_academy_admin());

-- 4) Add a member / resubmit a rejected one ---------------------------------------------------------------
-- Replaces the single-member version from 002/010 (same first six arguments, so older callers still work).
drop function if exists public.register_as_shooter(text,text,date,text,text,text);

create or replace function public.register_as_shooter(
  p_full_name text,
  p_phone text default null,
  p_date_of_birth date default null,
  p_guardian_name text default null,
  p_guardian_phone text default null,
  p_discipline text default '10m Air Rifle',
  p_relationship text default 'self',
  p_shooter_id uuid default null          -- set only to correct and resubmit a rejected application
) returns uuid language plpgsql security definer set search_path = public
as $$
declare
  v_email text;
  v_existing public.shooters%rowtype;
  v_id uuid;
  v_name text := trim(coalesce(p_full_name, ''));
  v_rel text := coalesce(nullif(trim(p_relationship), ''), 'self');
  c_max constant int := 6;
begin
  if auth.uid() is null then raise exception 'Please sign in first'; end if;
  if public.is_academy_admin() then raise exception 'Academy staff accounts cannot register as shooters'; end if;
  if v_name = '' then raise exception 'Full name is required'; end if;
  if v_rel not in ('self','child','other') then raise exception 'Invalid relationship'; end if;
  select email into v_email from auth.users where id = auth.uid();

  -- Correct and resubmit a rejected application (one specific member).
  if p_shooter_id is not null then
    select * into v_existing from public.shooters where id = p_shooter_id and user_id = auth.uid() for update;
    if v_existing.id is null then raise exception 'That member was not found on your account'; end if;
    if v_existing.approval_status <> 'rejected' then
      raise exception '% already has an application. Current status: %', v_existing.full_name, v_existing.approval_status;
    end if;
    update public.shooters set
      full_name = v_name, phone = p_phone, email = v_email, date_of_birth = p_date_of_birth,
      guardian_name = p_guardian_name, guardian_phone = p_guardian_phone,
      discipline = coalesce(p_discipline,'10m Air Rifle'), relationship = v_rel,
      status = 'inactive', approval_status = 'pending',
      rejection_reason = null, reviewed_by = null, reviewed_at = null, updated_at = now()
    where id = v_existing.id;
    return v_existing.id;
  end if;

  -- Add a new member to this login.
  if (select count(*) from public.shooters where user_id = auth.uid()) >= c_max then
    raise exception 'One family account can hold up to % members. Please contact the academy to add more.', c_max;
  end if;
  if exists(select 1 from public.shooters
             where user_id = auth.uid() and lower(trim(full_name)) = lower(v_name)
               and date_of_birth is not distinct from p_date_of_birth) then
    raise exception '% is already on your account', v_name;
  end if;

  insert into public.shooters(shooter_code, full_name, phone, email, date_of_birth, guardian_name, guardian_phone,
                              discipline, status, approval_status, user_id, relationship)
  values ('AADI-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,6)), v_name, p_phone, v_email, p_date_of_birth,
          p_guardian_name, p_guardian_phone, coalesce(p_discipline,'10m Air Rifle'), 'inactive', 'pending', auth.uid(), v_rel)
  returning id into v_id;
  return v_id;
end; $$;
revoke all on function public.register_as_shooter(text,text,date,text,text,text,text,uuid) from public, anon;
grant execute on function public.register_as_shooter(text,text,date,text,text,text,text,uuid) to authenticated;

-- 5) QR pass: issue it for the member being viewed (previously "the" shooter of the login) -------------
create or replace function public.issue_my_qr(p_token text)
returns void language plpgsql security definer set search_path = public, extensions
as $$
declare v_id uuid := public.my_shooter_id();
begin
  if length(p_token) < 32 then raise exception 'Invalid QR token'; end if;
  if v_id is null or not exists(select 1 from public.shooters
        where id = v_id and approval_status not in ('pending','rejected') and status = 'active') then
    raise exception 'Not an approved active member';
  end if;
  update public.shooter_qr_codes set is_active = false, revoked_at = now() where shooter_id = v_id and is_active;
  insert into public.shooter_qr_codes(shooter_id, token_hash) values (v_id, encode(digest(p_token, 'sha256'), 'hex'));
end $$;
grant execute on function public.issue_my_qr(text) to authenticated;

-- 6) Admin alert tells the academy this is part of a family account ---------------------------------------
create or replace function public.notify_new_shooter()
returns trigger language plpgsql security definer set search_path = public
as $$
declare v_others int := 0;
begin
  if new.approval_status = 'pending' then
    if new.user_id is not null then
      select count(*) into v_others from public.shooters where user_id = new.user_id and id <> new.id;
    end if;
    insert into public.notifications(audience,type,title,message,data)
    values ('admin','new_registration','New shooter registration',
            new.full_name || ' submitted a membership request'
              || case when v_others > 0 then ' (family account with ' || v_others || ' other member' || case when v_others = 1 then '' else 's' end || ').' else '.' end,
            jsonb_build_object('shooter_id',new.id,'shooter_code',new.shooter_code));
  end if;
  return new;
end; $$;
