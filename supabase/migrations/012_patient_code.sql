-- 012: store the Oracle PATIENT_CODE with each patient (shown big in reception, searchable)
alter table queue_entries add column if not exists patient_code text;

-- p_codes = {"<booking_id>": "<patient_code>", ...}
create or replace function queue_set_codes(p_clinic text, p_date date, p_codes jsonb) returns void
language sql as $$
  with c as (select key as bid, value #>> '{}' as code from jsonb_each(p_codes))
  update queue_entries e set patient_code = nullif(c.code, '')
    from c
   where e.clinic_id = p_clinic and e.service_date = p_date and e.booking_id = c.bid
     and e.patient_code is distinct from nullif(c.code, '');
$$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function queue_set_codes(text,date,jsonb) from public, anon, authenticated;
  end if;
end $$;
