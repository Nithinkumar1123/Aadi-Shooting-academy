create or replace function public.issue_my_qr(p_token text)
returns void language plpgsql security definer set search_path = public, extensions
as $$
declare v_id uuid;
begin
  if length(p_token) < 32 then raise exception 'Invalid QR token'; end if;
  select id into v_id from public.shooters
   where user_id = auth.uid()
     and approval_status not in ('pending','rejected')
     and status = 'active';
  if v_id is null then raise exception 'Not an approved active member'; end if;
  update public.shooter_qr_codes set is_active = false, revoked_at = now()
   where shooter_id = v_id and is_active;
  insert into public.shooter_qr_codes(shooter_id, token_hash)
   values (v_id, encode(digest(p_token, 'sha256'), 'hex'));
end $$;

grant execute on function public.issue_my_qr(text) to authenticated;