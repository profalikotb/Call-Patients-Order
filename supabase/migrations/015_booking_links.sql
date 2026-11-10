-- 015: link a waiting-list patient to an online booking made under ANOTHER name
--      (e.g. «أحمد علي» came on the booking of his brother «حسين علي», serial #12 at 8:30 PM).
--      A snapshot of the booking is kept, so it also works when typed by hand (no feed).
create table if not exists booking_links (
  entry_id     uuid primary key references queue_entries(id) on delete cascade,
  clinic_id    text not null references clinics(id),
  service_date date not null,
  serial       int,
  b_name       text,
  b_time       text,
  b_phone      text,
  b_code       text,
  created_by   text,
  created_at   timestamptz not null default now()
);
create index if not exists booking_links_day on booking_links (clinic_id, service_date);
alter table booking_links enable row level security;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on table booking_links from anon, authenticated;
  end if;
end $$;
