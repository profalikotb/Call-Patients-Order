-- 013: doctor → assistant quick messages («تعال للغرفة», «أدخل التالي» …) instead of the local phone.
--      Reception sees a loud banner until it presses «تم ✓»; the doctor sees that it was read.
create table if not exists staff_messages (
  id         bigserial primary key,
  clinic_id  text not null references clinics(id),
  body       text not null,
  from_label text,
  created_at timestamptz not null default now(),
  ack_at     timestamptz,
  ack_by     text
);
create index if not exists staff_messages_recent on staff_messages (clinic_id, created_at desc);
alter table staff_messages enable row level security;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on table staff_messages from anon, authenticated;
  end if;
end $$;
