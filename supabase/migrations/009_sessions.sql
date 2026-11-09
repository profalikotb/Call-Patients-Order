-- 009: PERSISTENT CLINIC SESSIONS – the list belongs to a session, not to the calendar date.
--   • One open session at a time (you are in one clinic at a time): clinic + clinic date.
--   • Midnight never changes it: Saturday 7 PM → Sunday 2:30 AM stays «Saturday's» list.
--   • Ends only by «إنهاء الجلسة» – or, if forgotten, automatically on a LATER day after 4 h without any
--     call/action (e.g. next morning), so a new clinic day is never stuck on yesterday's list.
--   • Nothing is deleted: every session's patients stay in queue_entries (archive).
create table if not exists clinic_sessions (
  id           uuid primary key default gen_random_uuid(),
  clinic_id    text not null references clinics(id),
  service_date date not null,
  status       text not null default 'open' check (status in ('open', 'closed')),
  started_at   timestamptz not null default now(),
  started_by   text,
  ended_at     timestamptz,
  ended_by     text,
  auto         boolean not null default false
);
create unique index if not exists clinic_sessions_one_open on clinic_sessions ((true)) where status = 'open';
create index if not exists clinic_sessions_day on clinic_sessions (clinic_id, service_date);
alter table clinic_sessions enable row level security;

create or replace function session_json(s clinic_sessions) returns jsonb language sql stable as $$
  select case when s.id is null then null else jsonb_build_object(
    'id', s.id, 'clinic', s.clinic_id, 'date', s.service_date, 'status', s.status,
    'started_at', s.started_at, 'started_by', s.started_by, 'ended_at', s.ended_at, 'ended_by', s.ended_by, 'auto', s.auto,
    'clinic_name', (select name_ar from clinics where id = s.clinic_id)) end;
$$;

-- the open session; opens one for today (p_default_clinic) when none is open;
-- closes a forgotten session from an earlier day after p_idle_hours without activity
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
    if v_last < now() - make_interval(hours => p_idle_hours) then
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

create or replace function session_start(p_clinic text, p_date date, p_by text) returns jsonb
language plpgsql as $$
declare s clinic_sessions;
begin
  if not exists (select 1 from clinics where id = p_clinic) then raise exception 'unknown clinic %', p_clinic; end if;
  update clinic_sessions set status = 'closed', ended_at = now(), ended_by = coalesce(p_by, 'staff') || ' (new session)'
   where status = 'open';
  insert into clinic_sessions (clinic_id, service_date, started_by)
  values (p_clinic, coalesce(p_date, (now() at time zone 'Africa/Cairo')::date), p_by) returning * into s;
  perform refresh_display(p_clinic, s.service_date);
  return session_json(s);
end $$;

create or replace function session_end(p_by text) returns jsonb language plpgsql as $$
declare s clinic_sessions;
begin
  update clinic_sessions set status = 'closed', ended_at = now(), ended_by = p_by where status = 'open' returning * into s;
  return session_json(s);
end $$;

create or replace function session_list(p_limit int default 30) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(x order by (x->>'started_at') desc), '[]'::jsonb) from (
    select session_json(s) || jsonb_build_object(
      'patients', (select count(*) from queue_entries e where e.clinic_id = s.clinic_id and e.service_date = s.service_date and e.status <> 'cancelled'),
      'done', (select count(*) from queue_entries e where e.clinic_id = s.clinic_id and e.service_date = s.service_date and e.status = 'done')) x
    from clinic_sessions s order by s.started_at desc limit p_limit) t;
$$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on table clinic_sessions from anon, authenticated;
    revoke execute on function session_json(clinic_sessions) from public, anon, authenticated;
    revoke execute on function session_current(text,int) from public, anon, authenticated;
    revoke execute on function session_start(text,date,text) from public, anon, authenticated;
    revoke execute on function session_end(text) from public, anon, authenticated;
    revoke execute on function session_list(int) from public, anon, authenticated;
  end if;
end $$;
