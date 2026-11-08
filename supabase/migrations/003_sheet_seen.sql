-- ============================================================================
-- 003 – Patients already seen in Oracle («تم الكشف» in QUEUE_TODAY → الحالة)
-- are marked DONE in the queue automatically, so reception and the TV match
-- Oracle. Run ONCE in Supabase → SQL Editor (after 001 and 002). Safe to re-run.
-- ============================================================================
create or replace function queue_mark_seen(p_clinic text, p_date date, p_keys text[])
returns int language plpgsql as $$
declare n int;
begin
  if p_keys is null or cardinality(p_keys) = 0 then return 0; end if;
  update queue_entries
     set status = 'done',
         done_at = coalesce(done_at, now()),
         in_room_at = coalesce(in_room_at, called_at, now()),
         updated_at = now()
   where clinic_id = p_clinic and service_date = p_date
     and booking_key = any(p_keys)
     and status not in ('done', 'cancelled');
  get diagnostics n = row_count;
  if n > 0 then
    update queue_days set version = version + 1 where clinic_id = p_clinic and service_date = p_date;
    perform refresh_display(p_clinic, p_date);
  end if;
  return n;
end $$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function queue_mark_seen(text,date,text[]) from public, anon, authenticated;
  end if;
end $$;
