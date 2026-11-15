-- 018: (1) every payment change is logged (who / when / from → to) – kept even if the patient row is deleted
--      (2) private storage bucket for the daily automatic backup
create table if not exists payment_log (
  id           bigserial primary key,
  clinic_id    text not null,
  service_date date not null,
  entry_id     uuid,
  patient_name text,
  patient_code text,
  from_method  text,
  to_method    text not null,
  actor        text,
  actor_role   text,
  created_at   timestamptz not null default now()
);
create index if not exists payment_log_day on payment_log (clinic_id, service_date);
alter table payment_log enable row level security;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on table payment_log from anon, authenticated;
  end if;
end $$;

do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public) values ('backups', 'backups', false) on conflict (id) do nothing;
  end if;
end $$;
