-- 017: end-of-clinic closing (like the Access CASES form) – one row per clinic per day.
--      items = {no_cases, fees_back, fees, mohamed_day, …}; grand_net and report are stored for quick reading/export.
create table if not exists day_closing (
  clinic_id    text not null references clinics(id),
  service_date date not null,
  items        jsonb not null default '{}'::jsonb,
  grand_net    numeric,
  report       text,
  updated_by   text,
  updated_at   timestamptz not null default now(),
  primary key (clinic_id, service_date)
);
alter table day_closing enable row level security;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on table day_closing from anon, authenticated;
  end if;
end $$;
