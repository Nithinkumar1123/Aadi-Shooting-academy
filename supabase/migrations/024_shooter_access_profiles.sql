-- AADI: first-time account activation, optional profile photos and admin archive.
-- Apply after migrations 001-023 in the Supabase SQL Editor.

alter table public.shooters add column if not exists avatar_url text;

-- When an admin pre-registers a shooter with an email address, the shooter can
-- activate access by choosing Create account with that same email. Link all
-- unclaimed records for that email to the newly created Auth user (family support).
create or replace function public.link_pre_registered_shooters()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  update public.shooters
     set user_id = new.id, updated_at = now()
   where user_id is null
     and email is not null
     and lower(trim(email)) = lower(trim(new.email));
  return new;
end; $$;

drop trigger if exists on_auth_user_created_link_shooters on auth.users;
create trigger on_auth_user_created_link_shooters
  after insert on auth.users
  for each row execute function public.link_pre_registered_shooters();

-- Private ownership check: a shooter can only change the photo on their own
-- currently selected family member. The URL is stored, never an arbitrary file upload.
drop function if exists public.update_my_shooter_photo(text);
create or replace function public.update_my_shooter_photo(p_shooter_id uuid, p_avatar_url text)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Please sign in again and retry'; end if;
  if p_avatar_url is not null and length(p_avatar_url) > 2048 then raise exception 'Invalid photo URL'; end if;
  if p_avatar_url is not null and p_avatar_url !~ '^https://[^ ]+$' then raise exception 'Invalid photo URL'; end if;
  -- Explicit member ID avoids updating the wrong person when a family account switches profiles.
  update public.shooters set avatar_url = p_avatar_url, updated_at = now()
   where id = p_shooter_id and user_id = auth.uid();
  if not found then raise exception 'This profile is not linked to your family account. Switch to the correct member and try again.'; end if;
end; $$;
revoke all on function public.update_my_shooter_photo(uuid,text) from public, anon;
grant execute on function public.update_my_shooter_photo(uuid,text) to authenticated;

-- Admins can archive a shooter directly. Keep their records; block archive while checked in.
create or replace function public.archive_shooter(p_shooter_id uuid, p_reason text default 'Archived by academy admin')
returns void language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_academy_admin() then raise exception 'Not authorized'; end if;
  if exists(select 1 from public.attendance where shooter_id = p_shooter_id and checked_out_at is null) then
    raise exception 'Please check the shooter out before archiving this membership';
  end if;
  update public.shooters
     set status = 'inactive', archived_at = now(), archive_reason = coalesce(nullif(trim(p_reason), ''), 'Archived by academy admin'), updated_at = now()
   where id = p_shooter_id and approval_status = 'approved' and status = 'active';
  if not found then raise exception 'Only an active, approved shooter can be archived'; end if;
  update public.shooter_qr_codes set is_active = false, revoked_at = now()
   where shooter_id = p_shooter_id and is_active;
  insert into public.notifications(audience, shooter_id, type, title, message, data)
  values ('shooter', p_shooter_id, 'membership_archived', 'Membership archived',
          'Your membership has been archived by the academy. Please contact the academy if you believe this is a mistake.',
          jsonb_build_object('shooter_id', p_shooter_id));
end; $$;
revoke all on function public.archive_shooter(uuid,text) from public, anon;
grant execute on function public.archive_shooter(uuid,text) to authenticated;

-- Optional public-read avatars; uploads are restricted to the authenticated user's folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('shooter-avatars', 'shooter-avatars', true, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = true, file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg','image/png','image/webp'];

drop policy if exists "Shooter uploads own avatar" on storage.objects;
create policy "Shooter uploads own avatar" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'shooter-avatars' and (storage.foldername(name))[1] = auth.uid()::text
  );
drop policy if exists "Shooter updates own avatar" on storage.objects;
create policy "Shooter updates own avatar" on storage.objects
  for update to authenticated using (
    bucket_id = 'shooter-avatars' and (storage.foldername(name))[1] = auth.uid()::text
  ) with check (
    bucket_id = 'shooter-avatars' and (storage.foldername(name))[1] = auth.uid()::text
  );
drop policy if exists "Shooter deletes own avatar" on storage.objects;
create policy "Shooter deletes own avatar" on storage.objects
  for delete to authenticated using (
    bucket_id = 'shooter-avatars' and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Admin registration supports both new logins and an existing family login.
-- If the email already belongs to an Auth user, attach this shooter immediately;
-- otherwise the Auth-user trigger above links it when they create their account.
create or replace function public.admin_register_shooter(
  p_full_name text,
  p_phone text default null,
  p_email text default null,
  p_date_of_birth date default null,
  p_guardian_name text default null,
  p_guardian_phone text default null,
  p_discipline text default '10m Air Rifle'
) returns uuid language plpgsql security definer set search_path = public
as $$
declare v_id uuid; v_user_id uuid; v_email text := lower(trim(coalesce(p_email, '')));
begin
  if not public.is_academy_admin() then raise exception 'Not authorized'; end if;
  if trim(coalesce(p_full_name, '')) = '' then raise exception 'Shooter name is required'; end if;
  if v_email = '' or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'A valid email address is required for account activation'; end if;
  select id into v_user_id from auth.users where lower(email) = v_email limit 1;
  if v_user_id is not null and exists(select 1 from public.profiles where id = v_user_id and role in ('super_admin','admin','coach','reception')) then
    raise exception 'This email belongs to an academy staff account. Use a separate shooter email address';
  end if;
  insert into public.shooters(shooter_code, full_name, phone, email, date_of_birth, guardian_name, guardian_phone,
                              discipline, status, approval_status, user_id, relationship)
  values ('AADI-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,7)), trim(p_full_name), nullif(trim(p_phone), ''),
          v_email, p_date_of_birth, nullif(trim(p_guardian_name), ''), nullif(trim(p_guardian_phone), ''),
          coalesce(nullif(trim(p_discipline), ''), '10m Air Rifle'), 'active', 'approved', v_user_id, 'self')
  returning id into v_id;
  return v_id;
end; $$;
revoke all on function public.admin_register_shooter(text,text,text,date,text,text,text) from public, anon;
grant execute on function public.admin_register_shooter(text,text,text,date,text,text,text) to authenticated;

-- Replace the original delete routine so its direct rifle-allocation foreign key
-- is cleaned up safely. Other dependent history rows cascade as defined in schema.
create or replace function public.permanently_delete_shooter(p_shooter_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_academy_admin() then raise exception 'Not authorized'; end if;
  if not exists(select 1 from public.shooters where id = p_shooter_id and status = 'inactive' and archived_at is not null) then
    raise exception 'Only an archived past shooter can be permanently deleted';
  end if;
  if exists(select 1 from public.attendance where shooter_id = p_shooter_id and checked_out_at is null) then
    raise exception 'Please close the active attendance session before deleting this record';
  end if;
  delete from public.rifle_allocations where shooter_id = p_shooter_id;
  delete from public.attendance where shooter_id = p_shooter_id;
  delete from public.shooters where id = p_shooter_id;
end; $$;
revoke all on function public.permanently_delete_shooter(uuid) from public, anon;
grant execute on function public.permanently_delete_shooter(uuid) to authenticated;
