-- 006: several clinic PCs with PRIORITY + one-click switching from reception
--   1 = Heliopolis clinic desktop (Vodafone)   2 = Home desktop (WE)   3 = Toukh clinic   4 = Laptop
-- Automatic: the highest-priority PC that is ON sends today's list; if it stops for 3 min the next one takes over.
-- Manual:    choosing a PC in reception («مصدر القائمة») pins it for today until another is chosen
--            or it goes silent for 3 min.
create table if not exists push_sources (
  name          text primary key,
  label         text,
  priority      int not null default 9,
  last_seen_at  timestamptz
);
alter table push_sources enable row level security;

create table if not exists push_state (
  service_date date primary key, owner text, owner_seen_at timestamptz, wanted_at timestamptz
);
alter table push_state add column if not exists pinned boolean not null default false;
alter table push_state add column if not exists wanted_source text;
alter table push_state enable row level security;

drop function if exists push_claim(date, text, int);
drop function if exists push_request(date);
drop function if exists push_poll(date, text);

create or replace function _push_seen(p_source text, p_label text, p_priority int) returns void
language sql as $$
  insert into push_sources (name, label, priority, last_seen_at)
  values (p_source, nullif(p_label, ''), coalesce(p_priority, 9), now())
  on conflict (name) do update set last_seen_at = now(),
    label = coalesce(nullif(excluded.label, ''), push_sources.label),
    priority = coalesce(p_priority, push_sources.priority);
$$;

create or replace function push_claim(p_date date, p_source text, p_priority int default 9,
                                      p_label text default null, p_idle_seconds int default 180)
returns jsonb language plpgsql as $$
declare s push_state; owner_prio int; why text;
begin
  perform _push_seen(p_source, p_label, p_priority);
  insert into push_state (service_date) values (p_date) on conflict do nothing;
  select * into s from push_state where service_date = p_date for update;
  select priority into owner_prio from push_sources where name = s.owner;

  if s.owner = p_source then why := 'owner';
  elsif s.owner is null then why := 'first';
  elsif s.owner_seen_at is null or s.owner_seen_at < now() - make_interval(secs => p_idle_seconds) then why := 'owner_silent';
  elsif not s.pinned and coalesce(p_priority, 9) < coalesce(owner_prio, 9) then why := 'higher_priority';
  end if;

  if why is null then
    return jsonb_build_object('ok', false, 'owner', s.owner, 'pinned', s.pinned,
      'seen_seconds_ago', extract(epoch from now() - s.owner_seen_at)::int);
  end if;
  update push_state set owner = p_source, owner_seen_at = now(),
         pinned = case when why = 'owner' then s.pinned else false end,
         wanted_source = case when wanted_source = p_source then null else wanted_source end
   where service_date = p_date;
  return jsonb_build_object('ok', true, 'owner', p_source, 'why', why,
    'took_over', why in ('owner_silent', 'higher_priority'), 'previous', s.owner);
end $$;

-- reception: «تحديث القائمة» (p_source null = ask the current PC) or switch to a chosen PC (pinned)
create or replace function push_request(p_date date, p_source text default null) returns jsonb
language plpgsql as $$
declare s push_state; src push_sources;
begin
  insert into push_state (service_date) values (p_date) on conflict do nothing;
  if p_source is not null then
    select * into src from push_sources where name = p_source;
    if src.name is null then return jsonb_build_object('ok', false, 'error', 'unknown_pc'); end if;
    if src.last_seen_at is null or src.last_seen_at < now() - interval '2 minutes' then
      return jsonb_build_object('ok', false, 'error', 'pc_offline', 'label', src.label,
        'seen_seconds_ago', case when src.last_seen_at is null then null else extract(epoch from now() - src.last_seen_at)::int end);
    end if;
    update push_state set owner = p_source, owner_seen_at = src.last_seen_at, pinned = true,
           wanted_source = p_source, wanted_at = now()
     where service_date = p_date returning * into s;
  else
    update push_state set wanted_at = now() where service_date = p_date returning * into s;
  end if;
  return jsonb_build_object('ok', true, 'owner', s.owner, 'pinned', s.pinned,
    'label', (select label from push_sources where name = s.owner),
    'seen_seconds_ago', case when s.owner_seen_at is null then null else extract(epoch from now() - s.owner_seen_at)::int end);
end $$;

-- each PC every ~10 s: heartbeat + "should I push now?"
create or replace function push_poll(p_date date, p_source text, p_priority int default 9, p_label text default null)
returns jsonb language plpgsql as $$
declare s push_state;
begin
  perform _push_seen(p_source, p_label, p_priority);
  select * into s from push_state where service_date = p_date;
  return jsonb_build_object(
    'want', coalesce(s.wanted_at > coalesce(s.owner_seen_at, '-infinity'::timestamptz)
                     and (s.wanted_source is null or s.wanted_source = p_source)
                     and (s.owner is null or s.owner = p_source or s.wanted_source = p_source), false),
    'owner', s.owner);
end $$;

-- reception: list of PCs with online state
create or replace function push_status(p_date date) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'owner', (select owner from push_state where service_date = p_date),
    'pinned', coalesce((select pinned from push_state where service_date = p_date), false),
    'sources', coalesce((select jsonb_agg(jsonb_build_object(
        'name', name, 'label', coalesce(label, name), 'priority', priority,
        'online', last_seen_at > now() - interval '2 minutes',
        'seen_seconds_ago', extract(epoch from now() - last_seen_at)::int) order by priority, name)
      from push_sources where last_seen_at > now() - interval '14 days'), '[]'::jsonb));
$$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on table push_sources, push_state from anon, authenticated;
    revoke execute on function _push_seen(text,text,int) from public, anon, authenticated;
    revoke execute on function push_claim(date,text,int,text,int) from public, anon, authenticated;
    revoke execute on function push_request(date,text) from public, anon, authenticated;
    revoke execute on function push_poll(date,text,int,text) from public, anon, authenticated;
    revoke execute on function push_status(date) from public, anon, authenticated;
  end if;
end $$;
