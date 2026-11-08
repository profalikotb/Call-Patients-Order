-- 007: the PC you CHOOSE in reception stays the source for the rest of the day
--      (no automatic hand-back), until you choose another PC or «تلقائي» (automatic by priority).
--      Each PC also reports its last error (e.g. "Cannot connect to Oracle") so reception can show it.
alter table push_sources add column if not exists last_error text;

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
  elsif s.pinned then why := null;                         -- chosen PC: nobody else, ever (until changed)
  elsif s.owner is null then why := 'first';
  elsif s.owner_seen_at is null or s.owner_seen_at < now() - make_interval(secs => p_idle_seconds) then why := 'owner_silent';
  elsif coalesce(p_priority, 9) < coalesce(owner_prio, 9) then why := 'higher_priority';
  end if;

  if why is null then
    return jsonb_build_object('ok', false, 'owner', s.owner, 'pinned', s.pinned,
      'seen_seconds_ago', extract(epoch from now() - s.owner_seen_at)::int);
  end if;
  update push_state set owner = p_source, owner_seen_at = now(),
         wanted_source = case when wanted_source = p_source then null else wanted_source end
   where service_date = p_date;
  update push_sources set last_error = null where name = p_source;
  return jsonb_build_object('ok', true, 'owner', p_source, 'why', why,
    'took_over', why in ('owner_silent', 'higher_priority'), 'previous', s.owner);
end $$;

-- p_source: null = refresh from the current PC · 'auto' = automatic by priority · a PC name = choose it (sticky)
create or replace function push_request(p_date date, p_source text default null) returns jsonb
language plpgsql as $$
declare s push_state; src push_sources;
begin
  insert into push_state (service_date) values (p_date) on conflict do nothing;
  if p_source = 'auto' then
    -- highest-priority PC that is on becomes the owner right away
    select * into src from push_sources where last_seen_at > now() - interval '2 minutes' order by priority, name limit 1;
    update push_state set pinned = false, wanted_source = src.name, wanted_at = now(),
           owner = coalesce(src.name, owner), owner_seen_at = coalesce(src.last_seen_at, owner_seen_at)
     where service_date = p_date returning * into s;
  elsif p_source is not null then
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
    update push_state set wanted_at = now(), wanted_source = owner where service_date = p_date returning * into s;
  end if;
  return jsonb_build_object('ok', true, 'owner', s.owner, 'pinned', s.pinned,
    'label', (select label from push_sources where name = s.owner),
    'error', (select last_error from push_sources where name = s.owner),
    'seen_seconds_ago', case when s.owner_seen_at is null then null else extract(epoch from now() - s.owner_seen_at)::int end);
end $$;

drop function if exists push_poll(date, text, int, text);
create or replace function push_poll(p_date date, p_source text, p_priority int default 9,
                                     p_label text default null, p_error text default null)
returns jsonb language plpgsql as $$
declare s push_state;
begin
  perform _push_seen(p_source, p_label, p_priority);
  update push_sources set last_error = nullif(left(p_error, 300), '') where name = p_source;
  select * into s from push_state where service_date = p_date;
  return jsonb_build_object(
    'want', coalesce(s.wanted_at > coalesce(s.owner_seen_at, '-infinity'::timestamptz)
                     and coalesce(s.wanted_source, s.owner, p_source) = p_source, false),
    'owner', s.owner);
end $$;

create or replace function push_status(p_date date) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'owner', (select owner from push_state where service_date = p_date),
    'pinned', coalesce((select pinned from push_state where service_date = p_date), false),
    'owner_seen_seconds_ago', (select extract(epoch from now() - owner_seen_at)::int from push_state where service_date = p_date),
    'sources', coalesce((select jsonb_agg(jsonb_build_object(
        'name', name, 'label', coalesce(label, name), 'priority', priority,
        'online', last_seen_at > now() - interval '2 minutes', 'error', last_error,
        'seen_seconds_ago', extract(epoch from now() - last_seen_at)::int) order by priority, name)
      from push_sources where last_seen_at > now() - interval '14 days'), '[]'::jsonb));
$$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function push_poll(date,text,int,text,text) from public, anon, authenticated;
  end if;
end $$;
