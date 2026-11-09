-- 010: a session left open from an earlier clinic day closes automatically ONLY after 08:00 Cairo time
--      (and 4 h without calls). Saturday 5:00 PM → Sunday 4:00 AM stays one session even if the
--      last calls were at midnight; Sunday's list opens from 8 AM on (or with «جلسة جديدة» any time).
create or replace function session_current(p_default_clinic text, p_idle_hours int default 4)
returns jsonb language plpgsql as $$
declare s clinic_sessions; v_today date := (now() at time zone 'Africa/Cairo')::date; v_last timestamptz;
begin
  select * into s from clinic_sessions where status = 'open' for update;
  if s.id is not null and s.service_date < v_today then
    select greatest(s.started_at,
                    (select max(created_at) from audit_log where clinic_id = s.clinic_id and service_date = s.service_date),
                    (select last_announce_at from queue_days where clinic_id = s.clinic_id and service_date = s.service_date))
      into v_last;
    -- never before 08:00 Cairo: an evening clinic may run until ~4 AM with long gaps between calls
    if v_last < now() - make_interval(hours => p_idle_hours)
       and extract(hour from now() at time zone 'Africa/Cairo') >= 8 then
      update clinic_sessions set status = 'closed', ended_at = now(), ended_by = 'auto (new day, idle)' where id = s.id;
      s := null;
    end if;
  end if;
  if s.id is null then
    if p_default_clinic is null or not exists (select 1 from clinics where id = p_default_clinic) then return null; end if;
    insert into clinic_sessions (clinic_id, service_date, started_by, auto)
    values (p_default_clinic, v_today, 'auto', true) returning * into s;
  end if;
  return session_json(s);
end $$;

