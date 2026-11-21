-- AADI: fix shooter avatar storage permissions for single and family accounts.
-- Apply this migration in Supabase SQL Editor after migration 024.

-- The first path segment is now the shooter row ID. This helper checks ownership
-- without exposing other shooter records through Storage policy subqueries.
create or replace function public.can_manage_shooter_avatar(p_shooter_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and (
    exists (
      select 1 from public.shooters s
      where s.id::text = p_shooter_id and s.user_id = auth.uid()
    )
    or public.is_academy_admin()
  );
$$;
revoke all on function public.can_manage_shooter_avatar(text) from public, anon;
grant execute on function public.can_manage_shooter_avatar(text) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('shooter-avatars', 'shooter-avatars', true, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set
  public = true,
  file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg','image/png','image/webp'];

-- Remove the old auth-user-folder policies introduced in migration 024.
drop policy if exists "Shooter uploads own avatar" on storage.objects;
drop policy if exists "Shooter updates own avatar" on storage.objects;
drop policy if exists "Shooter deletes own avatar" on storage.objects;
drop policy if exists "Shooter avatar public read" on storage.objects;

create policy "Shooter avatar public read"
on storage.objects for select to public
using (bucket_id = 'shooter-avatars');

create policy "Shooter or admin uploads avatar"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'shooter-avatars'
  and public.can_manage_shooter_avatar((storage.foldername(name))[1])
);

create policy "Shooter or admin updates avatar"
on storage.objects for update to authenticated
using (
  bucket_id = 'shooter-avatars'
  and public.can_manage_shooter_avatar((storage.foldername(name))[1])
)
with check (
  bucket_id = 'shooter-avatars'
  and public.can_manage_shooter_avatar((storage.foldername(name))[1])
);

create policy "Shooter or admin deletes avatar"
on storage.objects for delete to authenticated
using (
  bucket_id = 'shooter-avatars'
  and public.can_manage_shooter_avatar((storage.foldername(name))[1])
);
