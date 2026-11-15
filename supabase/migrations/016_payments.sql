-- 016: payment method per patient (default فوري = no row).
--      Separate table, so the Oracle push never overwrites it; deleted with the patient (cascade).
create table if not exists entry_payments (
  entry_id     uuid primary key references queue_entries(id) on delete cascade,
  clinic_id    text not null references clinics(id),
  service_date date not null,
  method       text not null check (method in ('fawry', 'instapay', 'refund')),
  set_by       text,
  set_at       timestamptz not null default now()
);
create index if not exists entry_payments_day on entry_payments (clinic_id, service_date);
alter table entry_payments enable row level security;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on table entry_payments from anon, authenticated;
  end if;
end $$;
