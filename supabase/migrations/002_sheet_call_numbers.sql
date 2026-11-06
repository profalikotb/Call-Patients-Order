-- ============================================================================
-- 002 – Fixed calling numbers from the sheet ("رقم النداء" column in QUEUE_TODAY)
-- Run ONCE in Supabase → SQL Editor, AFTER 001_queue.sql. Safe to re-run.
-- When a booking row carries a call number, that number IS its queue number
-- (TV + reception + voice all say the same number as the sheet's column م).
-- ============================================================================

alter table queue_entries add column if not exists sheet_number  int;   -- number as given by the sheet
alter table queue_entries add column if not exists sheet_applied int;   -- last sheet number applied to queue_number

create or replace function queue_sync(p_clinic text, p_date date, p_rows jsonb, p_complete boolean default true)
returns jsonb
language plpgsql as $$
declare
  d queue_days; v_pol text; r jsonb; n int; v_new boolean; v_ins int := 0; v_upd int := 0; v_canc int := 0;
  v_gone int := 0; v_renum int := 0; v_init text; v_guard boolean := false; v_active_keys text[];
  v_fix int := 0; v_base int; s record;
begin
  d := _lock_day(p_clinic, p_date);
  select policy into v_pol from clinic_settings where clinic_id = p_clinic;
  v_pol := coalesce(v_pol, 'time');
  v_init := case when v_pol = 'checkin' then 'booked' else 'waiting' end;

  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    if coalesce((r->>'cancelled')::boolean, false) then
      update queue_entries set status = 'cancelled', cancel_source = 'sheet', updated_at = now()
        where clinic_id = p_clinic and service_date = p_date and booking_key = r->>'booking_key'
          and status in ('waiting','booked','postponed');
      get diagnostics n = row_count; v_canc := v_canc + n;
      continue;
    end if;

    insert into queue_entries as q (clinic_id, service_date, source, booking_key, booking_id, patient_name,
                                    phone, appt_time, appt_minutes, procedure, status, dup_hint, sheet_number)
    values (p_clinic, p_date, 'sheet', r->>'booking_key', r->>'booking_id', coalesce(r->>'name',''),
            r->>'phone', r->>'appt_time', (r->>'appt_minutes')::int, r->>'procedure', v_init, r->>'dup_hint',
            nullif(r->>'call_no','')::int)
    on conflict (clinic_id, service_date, booking_key) do update set
      booking_id = excluded.booking_id, patient_name = excluded.patient_name, phone = excluded.phone,
      appt_time = excluded.appt_time, appt_minutes = excluded.appt_minutes, procedure = excluded.procedure,
      dup_hint = excluded.dup_hint, sheet_number = excluded.sheet_number, sheet_present = true,
      status = case when q.status = 'cancelled' and q.cancel_source = 'sheet' then v_init else q.status end,
      cancel_source = case when q.status = 'cancelled' and q.cancel_source = 'sheet' then null else q.cancel_source end,
      updated_at = now()
    where (q.booking_id, q.patient_name, q.phone, q.appt_time, q.appt_minutes, q.procedure, q.dup_hint, q.sheet_present, q.sheet_number)
          is distinct from
          (excluded.booking_id, excluded.patient_name, excluded.phone, excluded.appt_time,
           excluded.appt_minutes, excluded.procedure, excluded.dup_hint, true, excluded.sheet_number)
       or (q.status = 'cancelled' and q.cancel_source = 'sheet')
    returning (xmax = 0) into v_new;
    get diagnostics n = row_count;
    if n > 0 then
      if v_new then v_ins := v_ins + 1; else v_upd := v_upd + 1; end if;
    end if;
  end loop;

  -- bookings that vanished from the sheet (deleted rows) → cancel if not yet seen
  select coalesce(array_agg(x->>'booking_key'), '{}') into v_active_keys
    from jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) x
    where not coalesce((x->>'cancelled')::boolean, false);
  if p_complete then
    if cardinality(v_active_keys) = 0 and exists (select 1 from queue_entries where clinic_id = p_clinic
         and service_date = p_date and source = 'sheet' and status not in ('cancelled')) then
      v_guard := true;                                   -- empty read: refuse mass-cancel
    else
      update queue_entries set sheet_present = false,
             status = case when status in ('waiting','booked') then 'cancelled' else status end,
             cancel_source = case when status in ('waiting','booked') then 'sheet' else cancel_source end,
             updated_at = now()
        where clinic_id = p_clinic and service_date = p_date and source = 'sheet' and sheet_present
          and not exists (select 1 from jsonb_array_elements(p_rows) x
                          where x->>'booking_key' = queue_entries.booking_key);
      get diagnostics v_gone = row_count;
    end if;
  end if;

  -- numbering ---------------------------------------------------------------
  -- (A) fixed calling numbers from the sheet ("رقم النداء") ARE the queue numbers.
  --     Applied when new or when the sheet changed it (sheet_applied = last applied value),
  --     so a manual renumber in the app survives until the sheet itself changes that number.
  -- release the old numbers of every not-yet-called entry whose sheet number changed, so numbers
  -- can be swapped / shifted without tripping the unique (clinic, date, number) index
  update queue_entries set queue_number = null
    where clinic_id = p_clinic and service_date = p_date and source = 'sheet'
      and sheet_number is not null and sheet_applied is distinct from sheet_number
      and queue_number is not null and status in ('booked', 'waiting', 'cancelled');
  -- already called / in room / done keep the number they were announced with
  update queue_entries set sheet_applied = sheet_number
    where clinic_id = p_clinic and service_date = p_date and source = 'sheet'
      and sheet_number is not null and sheet_applied is distinct from sheet_number
      and queue_number is not null and status not in ('booked', 'waiting', 'cancelled');

  for s in select id, sheet_number from queue_entries
           where clinic_id = p_clinic and service_date = p_date and source = 'sheet'
             and sheet_number is not null and status <> 'cancelled'
             and (queue_number is null or sheet_applied is distinct from sheet_number)
           order by sheet_number loop
    if v_pol = 'time' and not d.numbers_locked then
      -- before the first call, un-fixed entries are renumbered in (B) anyway → release the number
      update queue_entries set queue_number = null
        where clinic_id = p_clinic and service_date = p_date and queue_number = s.sheet_number
          and sheet_number is null and id <> s.id;
    end if;
    if exists (select 1 from queue_entries o where o.clinic_id = p_clinic and o.service_date = p_date
                 and o.queue_number = s.sheet_number and o.id <> s.id) then
      -- number held by another entry (walk-in after the queue started) → keep current / next free number
      update queue_entries set queue_number = coalesce(queue_number, _next_number(p_clinic, p_date)),
             sheet_applied = s.sheet_number, updated_at = now()
        where id = s.id;
      update queue_entries set sort_key = coalesce(sort_key, queue_number) where id = s.id;
    else
      update queue_entries set queue_number = s.sheet_number,
             sort_key = case when d.numbers_locked then coalesce(sort_key, s.sheet_number) else s.sheet_number end,
             sheet_applied = s.sheet_number, updated_at = now()
        where id = s.id;
    end if;
    v_fix := v_fix + 1;
  end loop;
  v_renum := v_renum + v_fix;

  -- (B) entries WITHOUT a sheet number (walk-ins, or sheets without the column) → original behaviour,
  --     numbered after the highest fixed number so they never collide with sheet numbers
  select coalesce(max(queue_number), 0) into v_base from queue_entries
    where clinic_id = p_clinic and service_date = p_date and sheet_number is not null and queue_number is not null;

  if v_pol = 'time' and not d.numbers_locked then
    with want as (
      select id, v_base + row_number() over (order by appt_minutes nulls last, booking_key) rn
      from queue_entries where clinic_id = p_clinic and service_date = p_date
        and status <> 'cancelled' and sheet_number is null
    )
    select count(*) into n from want w join queue_entries q on q.id = w.id
      where q.queue_number is distinct from w.rn::int;
    if n > 0 then
      update queue_entries set queue_number = null
        where clinic_id = p_clinic and service_date = p_date and sheet_number is null;
      with want as (
        select id, v_base + row_number() over (order by appt_minutes nulls last, booking_key) rn
        from queue_entries where clinic_id = p_clinic and service_date = p_date
          and status <> 'cancelled' and sheet_number is null
      )
      update queue_entries q set queue_number = w.rn, sort_key = w.rn from want w where q.id = w.id;
      v_renum := v_renum + n;
    end if;
  elsif v_pol = 'time' then
    -- after the queue started: never renumber; late bookings get appended numbers
    with add as (
      select id, row_number() over (order by appt_minutes nulls last, booking_key) rn
      from queue_entries where clinic_id = p_clinic and service_date = p_date
        and status = 'waiting' and queue_number is null and sheet_number is null
    ), base as (select _next_number(p_clinic, p_date) - 1 b)
    update queue_entries q set queue_number = base.b + add.rn, sort_key = base.b + add.rn
      from add, base where q.id = add.id;
    get diagnostics n = row_count; v_renum := v_renum + n;
  end if;

  update queue_days set last_sync_ok_at = now(), last_sync_error = null
    where clinic_id = p_clinic and service_date = p_date;
  if v_ins + v_upd + v_canc + v_gone + v_renum > 0
     or not exists (select 1 from display_state where clinic_id = p_clinic and service_date = p_date) then
    perform refresh_display(p_clinic, p_date);
  end if;
  return jsonb_build_object('ok', true, 'inserted', v_ins, 'updated', v_upd, 'cancelled', v_canc,
                            'removed', v_gone, 'renumbered', v_renum, 'empty_guard', v_guard,
                            'changed', (v_ins + v_upd + v_canc + v_gone + v_renum) > 0);
end $$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function queue_sync(text,date,jsonb,boolean) from public, anon, authenticated;
  end if;
end $$;
