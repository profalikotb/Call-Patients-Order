-- ============================================================================
-- 004 – The sheet (Oracle) is the source of truth for numbers and the list.
--   • every patient in QUEUE_TODAY carries EXACTLY its «رقم النداء» – also after
--     being called / in the room (numbers follow Oracle when bookings are deleted)
--   • patients removed from Oracle leave the active list (called / in room → done)
--   • walk-ins added in the app are numbered after the sheet's numbers
-- Run ONCE in Supabase → SQL Editor (after 001, 002, 003). Safe to re-run.
-- ============================================================================
create or replace function queue_mirror_sheet(p_clinic text, p_date date)
returns int language plpgsql as $$
declare n int := 0; m int; v_max int;
begin
  -- 1) gone from the sheet but still active → finished
  update queue_entries
     set status = 'done', done_at = coalesce(done_at, now()),
         in_room_at = coalesce(in_room_at, called_at), updated_at = now()
   where clinic_id = p_clinic and service_date = p_date and source = 'sheet'
     and not sheet_present and status in ('called', 'in_room', 'absent', 'postponed');
  get diagnostics m = row_count; n := n + m;

  -- 2) release numbers that must change (gone / cancelled sheet rows, mismatched numbers,
  --    walk-ins sitting on a sheet number) so the unique index never blocks the re-assignment
  update queue_entries q set queue_number = null
   where q.clinic_id = p_clinic and q.service_date = p_date and q.queue_number is not null
     and (
          (q.source = 'sheet' and (not q.sheet_present or q.status = 'cancelled'))
       or (q.source = 'sheet' and q.sheet_present and q.status <> 'cancelled'
           and q.sheet_number is not null and q.queue_number <> q.sheet_number)
       or (q.source <> 'sheet' and exists (
             select 1 from queue_entries s where s.clinic_id = p_clinic and s.service_date = p_date
               and s.source = 'sheet' and s.sheet_present and s.status <> 'cancelled'
               and s.sheet_number = q.queue_number))
     );
  get diagnostics m = row_count; n := n + m;

  -- 3) sheet rows take their sheet number
  update queue_entries
     set queue_number = sheet_number, sort_key = sheet_number, sheet_applied = sheet_number, updated_at = now()
   where clinic_id = p_clinic and service_date = p_date and source = 'sheet' and sheet_present
     and status <> 'cancelled' and sheet_number is not null and queue_number is null;
  get diagnostics m = row_count; n := n + m;

  -- 4) walk-ins without a number → after the highest number
  select coalesce(max(queue_number), 0) into v_max from queue_entries
   where clinic_id = p_clinic and service_date = p_date;
  with w as (
    select id, row_number() over (order by created_at) rn from queue_entries
     where clinic_id = p_clinic and service_date = p_date and source <> 'sheet'
       and queue_number is null and status <> 'cancelled')
  update queue_entries q set queue_number = v_max + w.rn, sort_key = v_max + w.rn, updated_at = now()
    from w where q.id = w.id;
  get diagnostics m = row_count; n := n + m;

  if n > 0 then
    update queue_days set version = version + 1 where clinic_id = p_clinic and service_date = p_date;
    perform refresh_display(p_clinic, p_date);
  end if;
  return n;
end $$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function queue_mirror_sheet(text,date) from public, anon, authenticated;
  end if;
end $$;
