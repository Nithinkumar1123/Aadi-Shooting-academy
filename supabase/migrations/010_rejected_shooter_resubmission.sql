-- 010: allow a rejected shooter to correct details and resubmit the same application.
-- Run after 002_shooter_signup_approval.sql and 007_notifications.sql.

create or replace function public.register_as_shooter(
  p_full_name text,
  p_phone text default null,
  p_date_of_birth date default null,
  p_guardian_name text default null,
  p_guardian_phone text default null,
  p_discipline text default '10m Air Rifle'
) returns void language plpgsql security definer set search_path = public
as $$
declare
  v_email text;
  v_existing public.shooters%rowtype;
begin
  if auth.uid() is null then raise exception 'Please sign in first'; end if;
  if public.is_academy_admin() then raise exception 'Academy staff accounts cannot register as shooters'; end if;
  if coalesce(trim(p_full_name),'') = '' then raise exception 'Full name is required'; end if;

  select * into v_existing from public.shooters where user_id = auth.uid() for update;
  select email into v_email from auth.users where id = auth.uid();

  if v_existing.id is not null then
    if v_existing.approval_status <> 'rejected' then
      raise exception 'You already have an application. Current status: %', v_existing.approval_status;
    end if;

    update public.shooters set
      full_name = trim(p_full_name),
      phone = p_phone,
      email = v_email,
      date_of_birth = p_date_of_birth,
      guardian_name = p_guardian_name,
      guardian_phone = p_guardian_phone,
      discipline = coalesce(p_discipline,'10m Air Rifle'),
      status = 'inactive',
      approval_status = 'pending',
      rejection_reason = null,
      reviewed_by = null,
      reviewed_at = null,
      updated_at = now()
    where id = v_existing.id;
    return;
  end if;

  insert into public.shooters(shooter_code, full_name, phone, email, date_of_birth, guardian_name, guardian_phone, discipline, status, approval_status, user_id)
  values ('AADI-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,6)), trim(p_full_name), p_phone, v_email, p_date_of_birth,
          p_guardian_name, p_guardian_phone, coalesce(p_discipline,'10m Air Rifle'), 'inactive', 'pending', auth.uid());
end; $$;

-- Notify Admin when an existing rejected application is resubmitted.
create or replace function public.notify_shooter_resubmission()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if old.approval_status = 'rejected' and new.approval_status = 'pending' then
    insert into public.notifications(audience,type,title,message,data)
    values ('admin','registration_resubmitted','Shooter resubmitted application',new.full_name || ' corrected the application and submitted it again for review.',jsonb_build_object('shooter_id',new.id,'shooter_code',new.shooter_code));
  end if;
  return new;
end; $$;

drop trigger if exists shooters_notify_resubmission on public.shooters;
create trigger shooters_notify_resubmission after update of approval_status on public.shooters for each row execute function public.notify_shooter_resubmission();

revoke all on function public.register_as_shooter(text,text,date,text,text,text) from public;
grant execute on function public.register_as_shooter(text,text,date,text,text,text) to authenticated;
