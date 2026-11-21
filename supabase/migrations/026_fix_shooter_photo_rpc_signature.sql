-- AADI: align the profile-photo RPC argument names/order with the frontend.
-- Apply after migrations 024 and 025.

-- Remove previous overloads so PostgREST cannot resolve an obsolete signature.
drop function if exists public.update_my_shooter_photo(uuid, text);
drop function if exists public.update_my_shooter_photo(text, uuid);
drop function if exists public.update_my_shooter_photo(text);

-- Keep the argument names exactly as sent by the web client.
create function public.update_my_shooter_photo(
  p_avatar_url text,
  p_shooter_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Please sign in again and retry';
  end if;

  if p_avatar_url is not null and length(p_avatar_url) > 2048 then
    raise exception 'Invalid photo URL';
  end if;

  if p_avatar_url is not null and p_avatar_url !~ '^https://[^ ]+$' then
    raise exception 'Invalid photo URL';
  end if;

  -- A shooter can update only a shooter row linked to the current login.
  -- Multiple family-member rows may share this same auth user ID.
  update public.shooters
     set avatar_url = p_avatar_url,
         updated_at = now()
   where id = p_shooter_id
     and user_id = auth.uid();

  if not found then
    raise exception 'This profile is not linked to your family account. Switch to the correct member and try again.';
  end if;
end;
$$;

revoke all on function public.update_my_shooter_photo(text, uuid) from public, anon;
grant execute on function public.update_my_shooter_photo(text, uuid) to authenticated;

-- Ask PostgREST to refresh its function/schema cache immediately.
notify pgrst, 'reload schema';
