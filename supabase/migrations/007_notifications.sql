-- 007: unified in-app notifications for academy staff and shooters.
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  audience text not null check (audience in ('admin','shooter')),
  shooter_id uuid references public.shooters(id) on delete cascade,
  type text not null,
  title text not null,
  message text not null,
  data jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  check ((audience = 'shooter' and shooter_id is not null) or (audience = 'admin' and shooter_id is null))
);
create index if not exists notifications_admin_idx on public.notifications(audience, created_at desc) where audience = 'admin';
create index if not exists notifications_shooter_idx on public.notifications(shooter_id, created_at desc) where audience = 'shooter';

alter table public.notifications enable row level security;

-- Enable realtime delivery for the in-app notification feed.
do $$ begin
  alter publication supabase_realtime add table public.notifications;
exception when duplicate_object then null; end $$;

drop policy if exists "Admins read admin notifications" on public.notifications;
create policy "Admins read admin notifications" on public.notifications
  for select to authenticated using (audience = 'admin' and public.is_academy_admin());

drop policy if exists "Shooters read own notifications" on public.notifications;
create policy "Shooters read own notifications" on public.notifications
  for select to authenticated using (audience = 'shooter' and shooter_id = public.my_shooter_id());

drop policy if exists "Users mark their notifications read" on public.notifications;
create policy "Users mark their notifications read" on public.notifications
  for update to authenticated
  using ((audience = 'admin' and public.is_academy_admin()) or (audience = 'shooter' and shooter_id = public.my_shooter_id()))
  with check ((audience = 'admin' and public.is_academy_admin()) or (audience = 'shooter' and shooter_id = public.my_shooter_id()));

create or replace function public.create_notification(
  p_audience text, p_shooter_id uuid, p_type text, p_title text, p_message text, p_data jsonb default '{}'::jsonb
) returns void language plpgsql security definer set search_path = public
as $$
begin
  if p_audience not in ('admin','shooter') then raise exception 'Invalid notification audience'; end if;
  insert into public.notifications(audience, shooter_id, type, title, message, data)
  values (p_audience, case when p_audience = 'shooter' then p_shooter_id else null end, p_type, p_title, p_message, coalesce(p_data,'{}'::jsonb));
end; $$;
revoke all on function public.create_notification(text,uuid,text,text,text,jsonb) from public;
grant execute on function public.create_notification(text,uuid,text,text,text,jsonb) to authenticated;

-- New registration -> staff notification.
create or replace function public.notify_new_shooter()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.approval_status = 'pending' then
    insert into public.notifications(audience,type,title,message,data)
    values ('admin','new_registration','New shooter registration',new.full_name || ' submitted a membership request.',jsonb_build_object('shooter_id',new.id,'shooter_code',new.shooter_code));
  end if;
  return new;
end; $$;
drop trigger if exists shooters_notify_new_registration on public.shooters;
create trigger shooters_notify_new_registration after insert on public.shooters for each row execute function public.notify_new_shooter();

-- Approval / rejection -> shooter notification.
create or replace function public.notify_shooter_approval()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if old.approval_status is distinct from new.approval_status and new.user_id is not null then
    if new.approval_status = 'approved' then
      insert into public.notifications(audience,shooter_id,type,title,message,data)
      values ('shooter',new.id,'approval_approved','Membership approved','Your AADI membership has been approved. You can now use your member dashboard.',jsonb_build_object('shooter_code',new.shooter_code));
    elsif new.approval_status = 'rejected' then
      insert into public.notifications(audience,shooter_id,type,title,message,data)
      values ('shooter',new.id,'approval_rejected','Registration update',coalesce(new.rejection_reason,'Your registration was not approved. Please contact the academy.'),jsonb_build_object('shooter_code',new.shooter_code));
    end if;
  end if;
  return new;
end; $$;
drop trigger if exists shooters_notify_approval on public.shooters;
create trigger shooters_notify_approval after update of approval_status on public.shooters for each row execute function public.notify_shooter_approval();

-- New fee -> shooter notification; payment -> receipt notification.
create or replace function public.notify_fee_change()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.notifications(audience,shooter_id,type,title,message,data)
    values ('shooter',new.shooter_id,'fee_added','New fee added',new.title || ' · ₹' || to_char(new.amount,'FM999999990.00') || ' · Due ' || to_char(new.due_date,'DD Mon YYYY'),jsonb_build_object('fee_id',new.id));
  elsif tg_op = 'UPDATE' and old.status is distinct from new.status and new.status = 'paid' then
    insert into public.notifications(audience,shooter_id,type,title,message,data)
    values ('shooter',new.shooter_id,'fee_paid','Payment recorded','Your payment for ' || new.title || ' has been recorded. Thank you.',jsonb_build_object('fee_id',new.id,'amount',new.amount,'method',new.payment_method));
    insert into public.notifications(audience,type,title,message,data)
    values ('admin','fee_paid','Fee payment recorded',new.title || ' was marked paid for a shooter.',jsonb_build_object('fee_id',new.id,'shooter_id',new.shooter_id,'amount',new.amount,'method',new.payment_method));
  end if;
  return new;
end; $$;
drop trigger if exists fees_notify_change on public.fees;
create trigger fees_notify_change after insert or update of status on public.fees for each row execute function public.notify_fee_change();

-- New score -> shooter notification.
create or replace function public.notify_score_published()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.notifications(audience,shooter_id,type,title,message,data)
  values ('shooter',new.shooter_id,'score_published','New score published',new.event_name || ' · ' || new.score || '/' || new.max_score || ' · ' || to_char(new.session_date,'DD Mon YYYY'),jsonb_build_object('score_id',new.id));
  return new;
end; $$;
drop trigger if exists scores_notify_published on public.shooting_scores;
create trigger scores_notify_published after insert on public.shooting_scores for each row execute function public.notify_score_published();

-- Generate one in-app overdue notification per fee per calendar day. The existing fee-mail
-- Edge Function remains responsible for email reminders.
create or replace function public.create_overdue_fee_notifications()
returns int language plpgsql security definer set search_path = public
as $$
declare v_count int;
begin
  if auth.uid() is null then raise exception 'Please sign in first'; end if;
  insert into public.notifications(audience,shooter_id,type,title,message,data)
  select 'shooter', f.shooter_id, 'fee_overdue', 'Fee overdue', f.title || ' is overdue by ' || (current_date - f.due_date) || ' day' || case when current_date - f.due_date = 1 then '' else 's' end || '. Please pay at the academy front desk.', jsonb_build_object('fee_id',f.id)
  from public.fees f
  where f.status = 'pending' and f.due_date < current_date
    and not exists (
      select 1 from public.notifications n
      where n.shooter_id = f.shooter_id and n.type = 'fee_overdue'
        and (n.data->>'fee_id')::uuid = f.id and n.created_at::date = current_date
    );
  get diagnostics v_count = row_count;
  return v_count;
end; $$;
revoke all on function public.create_overdue_fee_notifications() from public;
grant execute on function public.create_overdue_fee_notifications() to authenticated;
