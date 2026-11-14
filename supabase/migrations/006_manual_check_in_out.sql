-- Manual check-in / check-out (no QR scan), for when the camera or the shooter's QR is not available.
-- Admin-only. Same duplicate-session and rifle-allocation protection as the QR versions.
-- The attendance row is marked in `notes` so manual entries can be told apart later.

create or replace function public.check_in_manual(p_shooter_id uuid, p_rifle_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_shooter public.shooters%rowtype; v_attendance_id uuid; v_rifle_code text;
begin
  if not public.is_academy_admin() then raise exception 'Not authorized'; end if;
  select * into v_shooter from public.shooters where id = p_shooter_id and status = 'active' and approval_status = 'approved' for update;
  if not found then raise exception 'Shooter not found or not an active member'; end if;
  if exists(select 1 from public.attendance where shooter_id = v_shooter.id and checked_out_at is null) then raise exception 'Shooter already has an open session'; end if;
  if p_rifle_id is not null then
    select rifle_code into v_rifle_code from public.rifles where id = p_rifle_id and status = 'available' for update;
    if not found then raise exception 'Selected rifle is unavailable'; end if;
    if exists(select 1 from public.rifle_allocations where rifle_id = p_rifle_id and returned_at is null) then raise exception 'Rifle is already allocated'; end if;
  end if;
  insert into public.attendance(shooter_id, recorded_by, notes) values (v_shooter.id, auth.uid(), 'Manual check-in (no QR)') returning id into v_attendance_id;
  if p_rifle_id is not null then insert into public.rifle_allocations(attendance_id, shooter_id, rifle_id, issued_by) values (v_attendance_id, v_shooter.id, p_rifle_id, auth.uid()); end if;
  return jsonb_build_object('attendance_id', v_attendance_id, 'shooter_id', v_shooter.id, 'shooter_name', v_shooter.full_name, 'shooter_code', v_shooter.shooter_code, 'rifle_code', v_rifle_code, 'checked_in_at', now());
end; $$;

create or replace function public.check_out_manual(p_shooter_id uuid)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_shooter public.shooters%rowtype; v_attendance_id uuid; v_rifle_code text; v_now timestamptz := now();
begin
  if not public.is_academy_admin() then raise exception 'Not authorized'; end if;
  select * into v_shooter from public.shooters where id = p_shooter_id;
  if not found then raise exception 'Shooter not found'; end if;
  select id into v_attendance_id from public.attendance where shooter_id = v_shooter.id and checked_out_at is null for update;
  if not found then raise exception 'Shooter has no open session to check out'; end if;
  update public.attendance set checked_out_at = v_now, notes = concat_ws(' · ', notes, 'Manual check-out (no QR)') where id = v_attendance_id;
  select r.rifle_code into v_rifle_code from public.rifle_allocations a join public.rifles r on r.id = a.rifle_id where a.attendance_id = v_attendance_id and a.returned_at is null limit 1;
  update public.rifle_allocations set returned_at = v_now, returned_by = auth.uid() where attendance_id = v_attendance_id and returned_at is null;
  return jsonb_build_object('attendance_id', v_attendance_id, 'shooter_id', v_shooter.id, 'shooter_name', v_shooter.full_name, 'shooter_code', v_shooter.shooter_code, 'rifle_code', v_rifle_code, 'checked_out_at', v_now);
end; $$;

revoke all on function public.check_in_manual(uuid, uuid) from public, anon;
revoke all on function public.check_out_manual(uuid) from public, anon;
grant execute on function public.check_in_manual(uuid, uuid) to authenticated;
grant execute on function public.check_out_manual(uuid) to authenticated;
