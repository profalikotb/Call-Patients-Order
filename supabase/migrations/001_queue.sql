-- ============================================================================
-- Prof. Ali Kotb – Smart Patient Queue System
-- Queue-state database (Supabase / PostgreSQL 15+)
-- Google Sheet = appointment source of truth. This DB = live clinic state only.
-- All queue transitions go through queue_apply() which locks the clinic-day row,
-- so concurrent devices can never produce two "call next" for the same state.
-- ============================================================================
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- reference --
create table if not exists clinics (
  id            text primary key,                 -- slug used in URLs
  name_ar       text not null,
  name_en       text not null,
  sheet_aliases text[] not null default '{}',     -- values in the sheet's العيادة column
  active        boolean not null default true,
  sort          int not null default 0
);

create table if not exists clinic_settings (
  clinic_id  text primary key references clinics(id) on delete cascade,
  policy     text not null default 'time' check (policy in ('time','checkin','manual')),
  room_label text not null default 'غرفة الكشف',
  default_consult_minutes int not null default 10,
  voice      jsonb not null default '{}'::jsonb,  -- merged over code defaults
  templates  jsonb not null default '{}'::jsonb,
  display    jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists app_config (
  key        text primary key,                    -- 'sheet' : mapping, cancel keywords …
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists staff (
  id            uuid primary key default gen_random_uuid(),
  username      text not null unique,
  display_name  text not null,
  password_hash text not null,
  role          text not null check (role in ('admin','reception')),
  clinics       text[],                           -- null = all clinics
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

-- ------------------------------------------------------------- live state --
create table if not exists queue_days (
  clinic_id        text not null references clinics(id),
  service_date     date not null,
  version          bigint not null default 0,     -- optimistic-concurrency token
  current_entry_id uuid,
  paused           boolean not null default false,
  numbers_locked   boolean not null default false,-- frozen after first call / manual edit
  announce_seq     bigint not null default 0,
  last_announce_at timestamptz,
  last_sync_at     timestamptz,
  last_sync_ok_at  timestamptz,
  last_sync_error  text,
  primary key (clinic_id, service_date)
);

create table if not exists queue_entries (
  id            uuid primary key default gen_random_uuid(),
  clinic_id     text not null references clinics(id),
  service_date  date not null,
  source        text not null default 'sheet' check (source in ('sheet','walkin')),
  booking_key   text not null,                    -- stable identity (booking ID or content hash)
  booking_id    text,
  patient_name  text not null default '',
  phone         text,
  appt_time     text,                             -- HH:MM 24h
  appt_minutes  int,
  procedure     text,
  queue_number  int,
  sort_key      numeric,
  priority      boolean not null default false,
  status        text not null default 'waiting'
                check (status in ('booked','waiting','called','in_room','done','absent','postponed','cancelled')),
  cancel_source text,                             -- 'sheet' | 'staff'
  called_count  int not null default 0,
  checked_in_at timestamptz,
  called_at     timestamptz,
  in_room_at    timestamptz,
  done_at       timestamptz,
  skipped_at    timestamptz,
  sheet_present boolean not null default true,
  dup_hint      text,                             -- same phone/name booked twice today
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (clinic_id, service_date, booking_key)
);
create unique index if not exists queue_entries_number_uq
  on queue_entries (clinic_id, service_date, queue_number) where queue_number is not null;
create index if not exists queue_entries_day_status
  on queue_entries (clinic_id, service_date, status, sort_key);

create table if not exists announcements (
  id           bigserial primary key,
  clinic_id    text not null,
  service_date date not null,
  seq          bigint not null,
  entry_id     uuid,
  queue_number int,
  kind         text not null,                     -- call | recall | repeat
  silent       boolean not null default false,
  created_by   text,
  created_at   timestamptz not null default now(),
  played_at    timestamptz,
  played_device text,
  unique (clinic_id, service_date, seq)
);

create table if not exists audit_log (
  id            bigserial primary key,
  clinic_id     text not null,
  service_date  date not null,
  action        text not null,
  entry_id      uuid,
  actor         text,
  args          jsonb,
  before        jsonb,                            -- {day:{…}, entries:[…]} for undo
  created_ids   uuid[] not null default '{}',
  version_after bigint,
  undone        boolean not null default false,
  idem_key      text,
  result        jsonb,
  created_at    timestamptz not null default now()
);
create unique index if not exists audit_idem_uq on audit_log (idem_key) where idem_key is not null;
create index if not exists audit_day on audit_log (clinic_id, service_date, id desc);

-- PUBLIC projection (numbers only – no names, phones, IDs). Realtime source.
create table if not exists display_state (
  clinic_id          text primary key references clinics(id),
  service_date       date,
  rev                bigint not null default 0,
  version            bigint not null default 0,
  current_number     int,
  current_status     text,
  next_numbers       int[] not null default '{}',
  waiting_count      int not null default 0,
  paused             boolean not null default false,
  announce           jsonb,                       -- {seq, kind, number, at, silent}
  audio_device_id    text,
  audio_device_label text,
  audio_lease_until  timestamptz,
  room_label         text,
  updated_at         timestamptz not null default now()
);

-- ---------------------------------------------------------------- helpers --
create or replace function _lock_day(p_clinic text, p_date date) returns queue_days
language plpgsql as $$
declare d queue_days;
begin
  insert into queue_days (clinic_id, service_date) values (p_clinic, p_date) on conflict do nothing;
  select * into d from queue_days where clinic_id = p_clinic and service_date = p_date for update;
  return d;
end $$;

create or replace function _next_number(p_clinic text, p_date date) returns int
language sql as $$
  select coalesce(max(queue_number), 0) + 1 from queue_entries
  where clinic_id = p_clinic and service_date = p_date;
$$;

create or replace function _min_waiting_key(p_clinic text, p_date date, p_exclude uuid) returns numeric
language sql as $$
  select coalesce(min(sort_key), 1) from queue_entries
  where clinic_id = p_clinic and service_date = p_date and status = 'waiting'
    and queue_number is not null and id is distinct from p_exclude;
$$;

-- Rebuild the public projection. Keeps announce unless the day rolled over.
create or replace function refresh_display(p_clinic text, p_date date) returns void
language plpgsql as $$
declare d queue_days; cur queue_entries; nxt int[]; wc int; room text;
begin
  select * into d from queue_days where clinic_id = p_clinic and service_date = p_date;
  if d.current_entry_id is not null then
    select * into cur from queue_entries where id = d.current_entry_id;
  end if;
  select coalesce(array_agg(queue_number order by rn), '{}') into nxt from (
    select queue_number, row_number() over (order by sort_key nulls last, queue_number) rn
    from queue_entries
    where clinic_id = p_clinic and service_date = p_date and status = 'waiting' and queue_number is not null
  ) x where rn <= 3;
  select count(*) into wc from queue_entries
    where clinic_id = p_clinic and service_date = p_date and status = 'waiting';
  select room_label into room from clinic_settings where clinic_id = p_clinic;

  insert into display_state as s (clinic_id, service_date, rev, version, current_number, current_status,
                                  next_numbers, waiting_count, paused, room_label, announce, updated_at)
  values (p_clinic, p_date, 1, coalesce(d.version,0), cur.queue_number, cur.status, nxt, wc,
          coalesce(d.paused,false), room, null, now())
  on conflict (clinic_id) do update set
    rev            = s.rev + 1,
    version        = excluded.version,
    current_number = excluded.current_number,
    current_status = excluded.current_status,
    next_numbers   = excluded.next_numbers,
    waiting_count  = excluded.waiting_count,
    paused         = excluded.paused,
    room_label     = excluded.room_label,
    announce       = case when s.service_date = excluded.service_date then s.announce else null end,
    service_date   = excluded.service_date,
    updated_at     = now();
end $$;

-- ------------------------------------------------------- the state machine --
create or replace function queue_apply(
  p_clinic text, p_date date, p_action text,
  p_entry uuid default null, p_expected_version bigint default null,
  p_actor text default null, p_idem text default null, p_args jsonb default '{}'::jsonb
) returns jsonb
language plpgsql as $$
declare
  d queue_days; e queue_entries; nb queue_entries; lg audit_log;
  v_now timestamptz := now();
  v_before jsonb; v_entries jsonb := '[]'::jsonb; v_created uuid[] := '{}';
  v_ann text; v_ann_entry uuid; v_ann_number int; v_silent boolean;
  v_tgt uuid; v_num int; v_key numeric; v_pol text; v_res jsonb; v_aid bigint; v_dir text;
begin
  d := _lock_day(p_clinic, p_date);                      -- serialises all writers for this clinic-day

  if p_idem is not null then                             -- duplicate submit (double tap, retry)
    select result into v_res from audit_log where idem_key = p_idem;
    if found then return v_res || '{"idempotent":true}'::jsonb; end if;
  end if;

  if p_expected_version is not null and p_expected_version <> d.version then
    return jsonb_build_object('ok', false, 'error', 'stale', 'version', d.version);
  end if;

  select policy into v_pol from clinic_settings where clinic_id = p_clinic;
  v_pol := coalesce(v_pol, 'time');
  v_before := jsonb_build_object('current_entry_id', d.current_entry_id, 'paused', d.paused,
                                 'numbers_locked', d.numbers_locked);

  -- resolve target entry (explicit or implied)
  v_tgt := p_entry;
  if v_tgt is null and p_action in ('skip','in_room','repeat','postpone') then
    v_tgt := d.current_entry_id;
  end if;
  if v_tgt is null and p_action = 'done' then
    select id into v_tgt from queue_entries
      where clinic_id = p_clinic and service_date = p_date and status = 'in_room'
      order by in_room_at desc limit 1;
    v_tgt := coalesce(v_tgt, d.current_entry_id);
  end if;
  if v_tgt is not null then
    select * into e from queue_entries
      where id = v_tgt and clinic_id = p_clinic and service_date = p_date for update;
    if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
    v_entries := jsonb_build_array(to_jsonb(e));
  elsif p_action in ('call','skip','in_room','done','return_waiting','postpone','cancel','move',
                     'emergency','set_number','checkin','repeat') then
    return jsonb_build_object('ok', false, 'error', 'no_target');
  end if;

  case p_action
  -- ------------------------------------------------------------------ call --
  when 'call_next' then
    select * into e from queue_entries
      where clinic_id = p_clinic and service_date = p_date and status = 'waiting' and queue_number is not null
      order by sort_key nulls last, queue_number limit 1 for update;
    if not found then return jsonb_build_object('ok', false, 'error', 'empty'); end if;
    v_entries := jsonb_build_array(to_jsonb(e));
    update queue_entries set status = 'called', called_at = v_now, called_count = called_count + 1,
           updated_at = v_now where id = e.id;
    d.current_entry_id := e.id; d.numbers_locked := true;
    v_ann := 'call'; v_ann_entry := e.id; v_ann_number := e.queue_number;

  when 'call' then                                        -- recall / override a specific patient
    if e.status not in ('waiting','called','absent','postponed') then
      return jsonb_build_object('ok', false, 'error', 'invalid_state', 'status', e.status);
    end if;
    if e.queue_number is null then return jsonb_build_object('ok', false, 'error', 'no_number'); end if;
    update queue_entries set status = 'called', called_at = v_now, called_count = called_count + 1,
           updated_at = v_now where id = e.id;
    d.current_entry_id := e.id; d.numbers_locked := true;
    v_ann := case when e.called_count > 0 then 'recall' else 'call' end;
    v_ann_entry := e.id; v_ann_number := e.queue_number;

  when 'repeat' then
    if e.status not in ('called','in_room') then
      return jsonb_build_object('ok', false, 'error', 'invalid_state', 'status', e.status);
    end if;
    if d.last_announce_at is not null and d.last_announce_at > v_now - interval '3 seconds' then
      return jsonb_build_object('ok', false, 'error', 'too_soon');
    end if;
    v_ann := 'repeat'; v_ann_entry := e.id; v_ann_number := e.queue_number;

  -- ------------------------------------------------------------- statuses --
  when 'skip' then
    if e.status not in ('waiting','called') then
      return jsonb_build_object('ok', false, 'error', 'invalid_state', 'status', e.status);
    end if;
    update queue_entries set status = 'absent', skipped_at = v_now, updated_at = v_now where id = e.id;
    if d.current_entry_id = e.id then d.current_entry_id := null; end if;

  when 'return_waiting' then
    if e.status not in ('absent','postponed','called','cancelled','booked') then
      return jsonb_build_object('ok', false, 'error', 'invalid_state', 'status', e.status);
    end if;
    v_num := coalesce(e.queue_number, case when v_pol <> 'manual' then _next_number(p_clinic, p_date) end);
    v_key := case when coalesce(p_args->>'position','original') = 'next'
                  then _min_waiting_key(p_clinic, p_date, e.id) - 1
                  else coalesce(e.sort_key, v_num) end;
    update queue_entries set status = 'waiting', cancel_source = null, queue_number = v_num, sort_key = v_key,
           updated_at = v_now where id = e.id;
    if d.current_entry_id = e.id then d.current_entry_id := null; end if;

  when 'in_room' then
    if e.status not in ('called','waiting') then
      return jsonb_build_object('ok', false, 'error', 'invalid_state', 'status', e.status);
    end if;
    update queue_entries set status = 'in_room', in_room_at = v_now, updated_at = v_now where id = e.id;

  when 'done' then
    if e.status not in ('in_room','called') then
      return jsonb_build_object('ok', false, 'error', 'invalid_state', 'status', e.status);
    end if;
    update queue_entries set status = 'done', done_at = v_now,
           in_room_at = coalesce(in_room_at, called_at), updated_at = v_now where id = e.id;

  when 'postpone' then
    if e.status not in ('waiting','called','absent','booked') then
      return jsonb_build_object('ok', false, 'error', 'invalid_state', 'status', e.status);
    end if;
    update queue_entries set status = 'postponed', updated_at = v_now where id = e.id;
    if d.current_entry_id = e.id then d.current_entry_id := null; end if;

  when 'cancel' then
    if e.status in ('done','cancelled') then
      return jsonb_build_object('ok', false, 'error', 'invalid_state', 'status', e.status);
    end if;
    update queue_entries set status = 'cancelled', cancel_source = 'staff', updated_at = v_now where id = e.id;
    if d.current_entry_id = e.id then d.current_entry_id := null; end if;

  -- -------------------------------------------------------------- ordering --
  when 'move' then
    if e.status <> 'waiting' then return jsonb_build_object('ok', false, 'error', 'invalid_state', 'status', e.status); end if;
    v_dir := coalesce(p_args->>'dir', 'up');
    if v_dir = 'up' then
      select * into nb from queue_entries
        where clinic_id = p_clinic and service_date = p_date and status = 'waiting' and queue_number is not null
          and id <> e.id and (sort_key, queue_number) < (e.sort_key, e.queue_number)
        order by sort_key desc, queue_number desc limit 1 for update;
    else
      select * into nb from queue_entries
        where clinic_id = p_clinic and service_date = p_date and status = 'waiting' and queue_number is not null
          and id <> e.id and (sort_key, queue_number) > (e.sort_key, e.queue_number)
        order by sort_key, queue_number limit 1 for update;
    end if;
    if not found then return jsonb_build_object('ok', false, 'error', 'edge'); end if;
    v_entries := v_entries || jsonb_build_array(to_jsonb(nb));
    if nb.sort_key = e.sort_key then                       -- tie: nudge past neighbour
      update queue_entries set sort_key = nb.sort_key + case when v_dir = 'up' then -0.001 else 0.001 end,
             updated_at = v_now where id = e.id;
    else
      update queue_entries set sort_key = nb.sort_key, updated_at = v_now where id = e.id;
      update queue_entries set sort_key = e.sort_key,  updated_at = v_now where id = nb.id;
    end if;
    d.numbers_locked := true;

  when 'emergency' then
    if e.status in ('done','in_room') then
      return jsonb_build_object('ok', false, 'error', 'invalid_state', 'status', e.status);
    end if;
    v_num := coalesce(e.queue_number, _next_number(p_clinic, p_date));
    update queue_entries set status = 'waiting', priority = true, queue_number = v_num, cancel_source = null,
           sort_key = _min_waiting_key(p_clinic, p_date, e.id) - 1, updated_at = v_now where id = e.id;
    if d.current_entry_id = e.id then d.current_entry_id := null; end if;
    d.numbers_locked := true;

  when 'set_number' then
    v_num := (p_args->>'number')::int;
    if v_num is null or v_num < 1 or v_num > 9999 then return jsonb_build_object('ok', false, 'error', 'bad_number'); end if;
    if exists (select 1 from queue_entries where clinic_id = p_clinic and service_date = p_date
               and queue_number = v_num and id <> e.id) then
      return jsonb_build_object('ok', false, 'error', 'number_taken');
    end if;
    update queue_entries set queue_number = v_num, sort_key = v_num,
           status = case when status = 'booked' then 'waiting' else status end,
           checked_in_at = coalesce(checked_in_at, case when status = 'booked' then v_now end),
           updated_at = v_now where id = e.id;
    d.numbers_locked := true;

  when 'checkin' then
    if e.status not in ('booked','waiting') then
      return jsonb_build_object('ok', false, 'error', 'invalid_state', 'status', e.status);
    end if;
    v_num := coalesce(e.queue_number, case when v_pol <> 'manual' then _next_number(p_clinic, p_date) end);
    update queue_entries set status = 'waiting', checked_in_at = coalesce(checked_in_at, v_now),
           queue_number = v_num, sort_key = coalesce(sort_key, v_num), updated_at = v_now where id = e.id;

  when 'add_walkin' then
    v_num := case when v_pol = 'manual' then nullif(p_args->>'number','')::int else _next_number(p_clinic, p_date) end;
    if v_num is not null and exists (select 1 from queue_entries where clinic_id = p_clinic
        and service_date = p_date and queue_number = v_num) then
      return jsonb_build_object('ok', false, 'error', 'number_taken');
    end if;
    insert into queue_entries (clinic_id, service_date, source, booking_key, patient_name, phone, procedure,
                               appt_time, appt_minutes, queue_number, sort_key, status, checked_in_at)
    values (p_clinic, p_date, 'walkin', 'walkin:' || gen_random_uuid(), coalesce(p_args->>'name',''),
            nullif(p_args->>'phone',''), nullif(p_args->>'procedure',''),
            to_char(v_now at time zone 'Africa/Cairo', 'HH24:MI'),
            extract(hour from v_now at time zone 'Africa/Cairo')::int * 60 + extract(minute from v_now at time zone 'Africa/Cairo')::int,
            v_num, v_num, 'waiting', v_now)
    returning * into e;
    v_created := array[e.id];

  when 'pause'  then d.paused := true;
  when 'resume' then d.paused := false;

  -- ------------------------------------------------------------------ undo --
  when 'undo' then
    select * into lg from audit_log
      where clinic_id = p_clinic and service_date = p_date and not undone and action <> 'undo'
      order by id desc limit 1 for update;
    if not found then return jsonb_build_object('ok', false, 'error', 'nothing_to_undo'); end if;
    -- free any numbers first, so restoring an old number cannot collide
    update queue_entries q set queue_number = null
      from jsonb_populate_recordset(null::queue_entries, lg.before->'entries') r where q.id = r.id;
    update queue_entries q set
        status = r.status,
        queue_number = case when r.queue_number is null then null
                            when exists (select 1 from queue_entries o where o.clinic_id = p_clinic
                                         and o.service_date = p_date and o.queue_number = r.queue_number)
                            then _next_number(p_clinic, p_date) else r.queue_number end,
        sort_key = r.sort_key, priority = r.priority,
        cancel_source = r.cancel_source, called_count = r.called_count, checked_in_at = r.checked_in_at,
        called_at = r.called_at, in_room_at = r.in_room_at, done_at = r.done_at, skipped_at = r.skipped_at,
        updated_at = v_now
      from jsonb_populate_recordset(null::queue_entries, lg.before->'entries') r where q.id = r.id;
    delete from queue_entries where id = any(lg.created_ids);
    d.current_entry_id := nullif(lg.before->'day'->>'current_entry_id','')::uuid;
    d.paused           := coalesce((lg.before->'day'->>'paused')::boolean, d.paused);
    d.numbers_locked   := d.numbers_locked or coalesce((lg.before->'day'->>'numbers_locked')::boolean, false);
    update audit_log set undone = true where id = lg.id;
    v_tgt := lg.entry_id;

  else
    return jsonb_build_object('ok', false, 'error', 'unknown_action');
  end case;

  -- ------------------------------------------------------------- commit --
  if v_ann is not null then
    d.announce_seq := d.announce_seq + 1;
    v_silent := d.paused;
    insert into announcements (clinic_id, service_date, seq, entry_id, queue_number, kind, silent, created_by)
    values (p_clinic, p_date, d.announce_seq, v_ann_entry, v_ann_number, v_ann, v_silent, p_actor);
  end if;

  update queue_days set
    version = d.version + 1, current_entry_id = d.current_entry_id, paused = d.paused,
    numbers_locked = d.numbers_locked, announce_seq = d.announce_seq,
    last_announce_at = case when v_ann is not null then v_now else last_announce_at end
  where clinic_id = p_clinic and service_date = p_date;

  v_res := jsonb_build_object('ok', true, 'version', d.version + 1, 'action', p_action,
             'entry_id', coalesce(v_ann_entry, e.id, v_tgt),
             'number', coalesce(v_ann_number, e.queue_number),
             'announce_seq', case when v_ann is not null then d.announce_seq end,
             'undone_action', case when p_action = 'undo' then lg.action end);

  insert into audit_log (clinic_id, service_date, action, entry_id, actor, args, before, created_ids,
                         version_after, idem_key, result)
  values (p_clinic, p_date, p_action, coalesce(v_ann_entry, e.id, v_tgt), p_actor, p_args,
          jsonb_build_object('day', v_before, 'entries', v_entries), v_created, d.version + 1, p_idem, v_res)
  returning id into v_aid;

  perform refresh_display(p_clinic, p_date);
  if v_ann is not null then
    update display_state set announce = jsonb_build_object(
        'seq', d.announce_seq, 'kind', v_ann, 'number', v_ann_number,
        'at', (extract(epoch from v_now) * 1000)::bigint, 'silent', v_silent)
    where clinic_id = p_clinic;
  end if;
  return v_res;
end $$;

-- --------------------------------------------------------- sheet → queue --
-- p_rows: [{booking_key, booking_id, name, phone, appt_time, appt_minutes, procedure, cancelled, dup_hint}]
create or replace function queue_sync(p_clinic text, p_date date, p_rows jsonb, p_complete boolean default true)
returns jsonb
language plpgsql as $$
declare
  d queue_days; v_pol text; r jsonb; n int; v_new boolean; v_ins int := 0; v_upd int := 0; v_canc int := 0;
  v_gone int := 0; v_renum int := 0; v_init text; v_guard boolean := false; v_active_keys text[];
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
                                    phone, appt_time, appt_minutes, procedure, status, dup_hint)
    values (p_clinic, p_date, 'sheet', r->>'booking_key', r->>'booking_id', coalesce(r->>'name',''),
            r->>'phone', r->>'appt_time', (r->>'appt_minutes')::int, r->>'procedure', v_init, r->>'dup_hint')
    on conflict (clinic_id, service_date, booking_key) do update set
      booking_id = excluded.booking_id, patient_name = excluded.patient_name, phone = excluded.phone,
      appt_time = excluded.appt_time, appt_minutes = excluded.appt_minutes, procedure = excluded.procedure,
      dup_hint = excluded.dup_hint, sheet_present = true,
      status = case when q.status = 'cancelled' and q.cancel_source = 'sheet' then v_init else q.status end,
      cancel_source = case when q.status = 'cancelled' and q.cancel_source = 'sheet' then null else q.cancel_source end,
      updated_at = now()
    where (q.booking_id, q.patient_name, q.phone, q.appt_time, q.appt_minutes, q.procedure, q.dup_hint, q.sheet_present)
          is distinct from
          (excluded.booking_id, excluded.patient_name, excluded.phone, excluded.appt_time,
           excluded.appt_minutes, excluded.procedure, excluded.dup_hint, true)
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

  -- numbering
  if v_pol = 'time' and not d.numbers_locked then
    -- before the first call, numbers follow appointment time exactly (re-sort safe)
    with want as (
      select id, row_number() over (order by appt_minutes nulls last, booking_key) rn
      from queue_entries where clinic_id = p_clinic and service_date = p_date and status <> 'cancelled'
    )
    select count(*) into v_renum from want w join queue_entries q on q.id = w.id
      where q.queue_number is distinct from w.rn::int;
    if v_renum > 0 then
      update queue_entries set queue_number = null
        where clinic_id = p_clinic and service_date = p_date;
      with want as (
        select id, row_number() over (order by appt_minutes nulls last, booking_key) rn
        from queue_entries where clinic_id = p_clinic and service_date = p_date and status <> 'cancelled'
      )
      update queue_entries q set queue_number = w.rn, sort_key = w.rn from want w where q.id = w.id;
    end if;
  elsif v_pol = 'time' then
    -- after the queue started: never renumber; late bookings get appended numbers
    with add as (
      select id, row_number() over (order by appt_minutes nulls last, booking_key) rn
      from queue_entries where clinic_id = p_clinic and service_date = p_date
        and status = 'waiting' and queue_number is null
    ), base as (select _next_number(p_clinic, p_date) - 1 b)
    update queue_entries q set queue_number = base.b + add.rn, sort_key = base.b + add.rn
      from add, base where q.id = add.id;
    get diagnostics v_renum = row_count;
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

create or replace function sync_claim(p_clinic text, p_date date, p_min_seconds int) returns boolean
language plpgsql as $$
declare n int;
begin
  insert into queue_days (clinic_id, service_date) values (p_clinic, p_date) on conflict do nothing;
  update queue_days set last_sync_at = now()
    where clinic_id = p_clinic and service_date = p_date
      and (last_sync_at is null or last_sync_at < now() - make_interval(secs => p_min_seconds));
  get diagnostics n = row_count;
  return n > 0;
end $$;

create or replace function sync_fail(p_clinic text, p_date date, p_error text) returns void
language sql as $$
  update queue_days set last_sync_error = left(p_error, 500) where clinic_id = p_clinic and service_date = p_date;
$$;

-- ---------------------------------------------- single audio device lease --
create or replace function display_claim(p_clinic text, p_device text, p_label text,
                                         p_force boolean default false, p_lease_seconds int default 60)
returns jsonb
language plpgsql as $$
declare s display_state;
begin
  insert into display_state (clinic_id) values (p_clinic) on conflict do nothing;
  update display_state set
      rev = rev + case when audio_device_id is distinct from p_device then 1 else 0 end,
      audio_device_id = p_device, audio_device_label = p_label,
      audio_lease_until = now() + make_interval(secs => p_lease_seconds), updated_at = now()
    where clinic_id = p_clinic
      and (audio_device_id is null or audio_device_id = p_device or audio_lease_until < now() or p_force)
    returning * into s;
  if not found then
    select * into s from display_state where clinic_id = p_clinic;
    return jsonb_build_object('ok', false, 'holder', s.audio_device_label, 'until', s.audio_lease_until);
  end if;
  return jsonb_build_object('ok', true, 'until', s.audio_lease_until);
end $$;

create or replace function display_release(p_clinic text, p_device text) returns void
language sql as $$
  update display_state set audio_device_id = null, audio_device_label = null, audio_lease_until = null,
         rev = rev + 1 where clinic_id = p_clinic and audio_device_id = p_device;
$$;

-- --------------------------------------------------------------- security --
alter table clinics          enable row level security;
alter table clinic_settings  enable row level security;
alter table app_config       enable row level security;
alter table staff            enable row level security;
alter table queue_days       enable row level security;
alter table queue_entries    enable row level security;
alter table announcements    enable row level security;
alter table audit_log        enable row level security;
alter table display_state    enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    -- only the numbers-only projection is readable by browsers (needed for Realtime)
    drop policy if exists display_public_read on display_state;
    create policy display_public_read on display_state for select to anon, authenticated using (true);
    revoke all on clinics, clinic_settings, app_config, staff, queue_days, queue_entries,
                  announcements, audit_log from anon, authenticated;
    grant select on display_state to anon, authenticated;
    -- functions are executable by PUBLIC by default → PostgREST would expose them. Lock down.
    revoke execute on function queue_apply(text,date,text,uuid,bigint,text,text,jsonb) from public, anon, authenticated;
    revoke execute on function queue_sync(text,date,jsonb,boolean) from public, anon, authenticated;
    revoke execute on function sync_claim(text,date,int) from public, anon, authenticated;
    revoke execute on function sync_fail(text,date,text) from public, anon, authenticated;
    revoke execute on function display_claim(text,text,text,boolean,int) from public, anon, authenticated;
    revoke execute on function display_release(text,text) from public, anon, authenticated;
    revoke execute on function refresh_display(text,date) from public, anon, authenticated;
    revoke execute on function _lock_day(text,date) from public, anon, authenticated;
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table display_state;
    exception when duplicate_object then null;
    end;
  end if;
end $$;

-- ------------------------------------------------------------------- seed --
insert into clinics (id, name_ar, name_en, sheet_aliases, sort) values
  ('heliopolis', 'عيادة مصر الجديدة', 'Heliopolis Clinic',
     array['مصر الجديدة','مصر الجديده','هليوبوليس','الحجاز','Heliopolis','Masr El Gedida'], 1),
  ('toukh', 'عيادة طوخ', 'Toukh Clinic', array['طوخ','Toukh','Tukh'], 2)
on conflict (id) do nothing;

insert into clinic_settings (clinic_id) select id from clinics on conflict do nothing;
