-- 005: desktop push ownership + "refresh now" requests
-- One PC "owns" today's list. Another PC (e.g. the laptop) is refused until the owner has been silent
-- for p_idle_seconds (PC shut down) → automatic hand-over, never two lists fighting.
-- The reception button «تحديث القائمة» sets wanted_at; the owner PC polls and pushes immediately.
create table if not exists push_state (
  service_date   date primary key,
  owner          text,
  owner_seen_at  timestamptz,
  wanted_at      timestamptz
);
alter table push_state enable row level security;

create or replace function push_claim(p_date date, p_source text, p_idle_seconds int default 180)
returns jsonb language plpgsql as $$
declare s push_state;
begin
  insert into push_state (service_date) values (p_date) on conflict do nothing;
  select * into s from push_state where service_date = p_date for update;
  if s.owner is null or s.owner = p_source
     or s.owner_seen_at < now() - make_interval(secs => p_idle_seconds) then
    update push_state set owner = p_source, owner_seen_at = now() where service_date = p_date;
    return jsonb_build_object('ok', true, 'owner', p_source, 'took_over', s.owner is not null and s.owner <> p_source);
  end if;
  return jsonb_build_object('ok', false, 'owner', s.owner,
    'seen_seconds_ago', extract(epoch from now() - s.owner_seen_at)::int);
end $$;

create or replace function push_request(p_date date) returns jsonb language plpgsql as $$
declare s push_state;
begin
  insert into push_state (service_date) values (p_date) on conflict do nothing;
  update push_state set wanted_at = now() where service_date = p_date returning * into s;
  return jsonb_build_object('owner', s.owner,
    'seen_seconds_ago', case when s.owner_seen_at is null then null else extract(epoch from now() - s.owner_seen_at)::int end);
end $$;

-- the PC asks: "should I push now?" → yes when a refresh was requested after the last accepted push
create or replace function push_poll(p_date date, p_source text) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'want', coalesce((select wanted_at > coalesce(owner_seen_at, '-infinity'::timestamptz)
                      from push_state where service_date = p_date), false),
    'owner', (select owner from push_state where service_date = p_date));
$$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on table push_state from anon, authenticated;
    revoke execute on function push_claim(date,text,int) from public, anon, authenticated;
    revoke execute on function push_request(date) from public, anon, authenticated;
    revoke execute on function push_poll(date,text) from public, anon, authenticated;
  end if;
end $$;
