-- 005: fees & offline payments, email log, optional shot-by-shot scores.
-- Payments are collected OFFLINE (cash/UPI at the academy). This only records them and drives the emails.

-- ---------------------------------------------------------------- fees
create table if not exists public.fees (
  id uuid primary key default gen_random_uuid(),
  shooter_id uuid not null references public.shooters(id) on delete cascade,
  title text not null,                                   -- e.g. "Monthly fee - November 2026"
  amount numeric(10,2) not null check (amount > 0),
  due_date date not null,
  status text not null default 'pending' check (status in ('pending','paid')),
  paid_at timestamptz,
  payment_method text check (payment_method in ('cash','upi','card','bank_transfer','other')),
  payment_reference text,                                -- UPI ref / receipt no. (optional)
  marked_paid_by uuid references auth.users(id),
  last_reminder_at timestamptz,
  reminder_count int not null default 0,
  notes text,
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  check ((status = 'paid') = (paid_at is not null))
);
create index if not exists fees_shooter_idx on public.fees(shooter_id, due_date desc);
create index if not exists fees_status_due_idx on public.fees(status, due_date);

-- Every email the system tries to send (so the admin can see sent / failed).
create table if not exists public.fee_email_log (
  id uuid primary key default gen_random_uuid(),
  fee_id uuid references public.fees(id) on delete cascade,
  shooter_id uuid references public.shooters(id) on delete set null,
  kind text not null check (kind in ('reminder','receipt')),
  trigger text not null default 'manual' check (trigger in ('manual','auto')),
  to_email text,
  status text not null check (status in ('sent','failed')),
  error text,
  created_at timestamptz not null default now()
);
create index if not exists fee_email_log_fee_idx on public.fee_email_log(fee_id, created_at desc);

alter table public.fees enable row level security;
alter table public.fee_email_log enable row level security;

drop policy if exists "Admins manage fees" on public.fees;
create policy "Admins manage fees" on public.fees
  for all to authenticated using (public.is_academy_admin()) with check (public.is_academy_admin());

drop policy if exists "Shooters read own fees" on public.fees;
create policy "Shooters read own fees" on public.fees
  for select to authenticated using (shooter_id = public.my_shooter_id());

drop policy if exists "Admins read email log" on public.fee_email_log;
create policy "Admins read email log" on public.fee_email_log
  for select to authenticated using (public.is_academy_admin());
-- (inserts into fee_email_log come only from the Edge Function using the service role)

-- ---------------------------------------------------------------- mark paid
create or replace function public.mark_fee_paid(
  p_fee_id uuid,
  p_method text default 'cash',
  p_reference text default null,
  p_paid_on date default null
) returns void language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_academy_admin() then raise exception 'Not authorized'; end if;
  if p_method not in ('cash','upi','card','bank_transfer','other') then raise exception 'Invalid payment method'; end if;
  update public.fees set
    status = 'paid',
    paid_at = coalesce(p_paid_on::timestamptz, now()),
    payment_method = p_method,
    payment_reference = nullif(trim(coalesce(p_reference,'')), ''),
    marked_paid_by = auth.uid()
  where id = p_fee_id and status = 'pending';
  if not found then raise exception 'Fee not found or already marked as paid'; end if;
end; $$;

create or replace function public.mark_fee_unpaid(p_fee_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_academy_admin() then raise exception 'Not authorized'; end if;
  update public.fees set status = 'pending', paid_at = null, payment_method = null,
    payment_reference = null, marked_paid_by = null
  where id = p_fee_id and status = 'paid';
  if not found then raise exception 'Fee not found or not marked as paid'; end if;
end; $$;

-- Create the same fee for several shooters at once (e.g. monthly fee for every active member).
create or replace function public.create_fees(
  p_shooter_ids uuid[], p_title text, p_amount numeric, p_due_date date, p_notes text default null
) returns int language plpgsql security definer set search_path = public
as $$
declare v_count int;
begin
  if not public.is_academy_admin() then raise exception 'Not authorized'; end if;
  if coalesce(trim(p_title),'') = '' then raise exception 'Title is required'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Amount must be greater than zero'; end if;
  insert into public.fees(shooter_id, title, amount, due_date, notes)
  select s.id, trim(p_title), p_amount, p_due_date, p_notes
    from public.shooters s where s.id = any(p_shooter_ids);
  get diagnostics v_count = row_count;
  return v_count;
end; $$;

revoke all on function public.mark_fee_paid(uuid,text,text,date) from public;
revoke all on function public.mark_fee_unpaid(uuid) from public;
revoke all on function public.create_fees(uuid[],text,numeric,date,text) from public;
grant execute on function public.mark_fee_paid(uuid,text,text,date) to authenticated;
grant execute on function public.mark_fee_unpaid(uuid) to authenticated;
grant execute on function public.create_fees(uuid[],text,numeric,date,text) to authenticated;

-- ---------------------------------------------------------------- shot-by-shot scores (optional)
-- When the coach enters individual shots, the app can show deeper "where to improve" tips.
alter table public.shooting_scores add column if not exists shot_values numeric(3,1)[];
alter table public.shooting_scores drop constraint if exists shooting_scores_shots_match;
alter table public.shooting_scores add constraint shooting_scores_shots_match
  check (shot_values is null or cardinality(shot_values) = shots);
