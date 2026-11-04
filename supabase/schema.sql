-- ============================================================
-- Water Monitor — Supabase schema
-- Paste into: Supabase Dashboard → SQL Editor → New query → Run
-- Idempotent-ish: safe to re-run only on a fresh project.
-- ============================================================

-- ------------------------------------------------------------
-- 1. users — mirrors auth.users (created by a trigger)
-- ------------------------------------------------------------
create table public.users (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text,
  full_name  text,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.users (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------------
-- 2. devices — one user may own several ESP32s
-- ------------------------------------------------------------

-- Columns the ingest API fills / the Settings page configures live on devices:
--   interval_seconds, thresholds (LEDs 25/50/75, buzzer, and shared computed level using container reference/empty distance),
--   calibration_pending, last_wifi_rssi, is_online, last_seen, etc.

create table public.devices (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.users (id) on delete cascade,
  device_code         text not null unique,
  device_name         text not null default 'ESP32 Device',
  api_key_hash        text not null,
  api_key_prefix      text not null default '',
  firmware_version    text,
  interval_seconds    integer not null default 30
                      check (interval_seconds between 5 and 3600),
  threshold_led25     numeric not null default 25 check (threshold_led25 between 0 and 100),
  threshold_led50     numeric not null default 50 check (threshold_led50 between 0 and 100),
  threshold_led75     numeric not null default 75 check (threshold_led75 between 0 and 100),
  threshold_buzzer    numeric not null default 90 check (threshold_buzzer between 0 and 100),
  calibration_pending boolean not null default false,
  last_wifi_rssi      integer,
  is_online           boolean not null default false,
  last_seen           timestamptz,
  created_at          timestamptz not null default now()
);

create index devices_user_idx on public.devices (user_id);

-- ------------------------------------------------------------
-- 3. containers — calibration data per container
--    container_number/name auto-assigned by trigger (Container 1, 2, …)
-- ------------------------------------------------------------
create table public.containers (
  id                uuid primary key default gen_random_uuid(),
  device_id         uuid not null references public.devices (id) on delete cascade,
  container_number  integer,
  container_name    text,
  empty_distance_cm numeric not null check (empty_distance_cm > 0),
  is_active         boolean not null default true,
  calibrated_at     timestamptz not null default now(),
  created_at        timestamptz not null default now()
);

create unique index containers_device_number_idx
  on public.containers (device_id, container_number);
create index containers_device_idx on public.containers (device_id);

create or replace function public.fn_assign_container_number()
returns trigger
language plpgsql
as $$
declare
  next_num integer;
begin
  select coalesce(max(container_number), 0) + 1 into next_num
  from public.containers where device_id = new.device_id;

  if new.container_number is null then
    new.container_number := next_num;
  end if;
  if new.container_name is null or new.container_name = '' then
    new.container_name := 'Container ' || new.container_number;
  end if;
  return new;
end;
$$;

create trigger trg_assign_container_number
  before insert on public.containers
  for each row execute function public.fn_assign_container_number();

-- ------------------------------------------------------------
-- 4. readings — every measurement the ESP32 sends (kept forever)
-- ------------------------------------------------------------
create table public.readings (
  id                   bigint generated always as identity primary key,
  device_id            uuid not null references public.devices (id) on delete cascade,
  container_id         uuid not null references public.containers (id) on delete cascade,
  distance_cm          numeric not null,
  water_height_cm      numeric not null,
  water_level_percent  numeric not null,
  free_space_cm        numeric not null,
  sensor_valid         boolean not null default true,
  recorded_at          timestamptz not null default now()
);

create index readings_container_recorded_idx
  on public.readings (container_id, recorded_at desc);
create index readings_device_recorded_idx
  on public.readings (device_id, recorded_at desc);

-- ------------------------------------------------------------
-- 5. device_events — connectivity / calibration / warnings
-- ------------------------------------------------------------
create table public.device_events (
  id           bigint generated always as identity primary key,
  device_id    uuid not null references public.devices (id) on delete cascade,
  container_id uuid references public.containers (id) on delete set null,
  event_type   text not null check (event_type in (
    'device_connected', 'device_disconnected', 'calibration_completed',
    'container_changed', 'sensor_error', 'water_level_90'
  )),
  message      text,
  created_at   timestamptz not null default now()
);

create index device_events_device_created_idx
  on public.device_events (device_id, created_at desc);

-- ------------------------------------------------------------
-- 6. Row Level Security — a user only ever sees their own data
-- ------------------------------------------------------------
alter table public.users         enable row level security;
alter table public.devices       enable row level security;
alter table public.containers    enable row level security;
alter table public.readings      enable row level security;
alter table public.device_events enable row level security;

-- Receiver for policy checks: devices belong to the caller.
create or replace function public.user_owns_device(p_device_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.devices d
    where d.id = p_device_id and d.user_id = auth.uid()
  )
$$;

-- users -----------------------------------------------------
create policy users_select_own on public.users
  for select using (auth.uid() = id);
create policy users_update_own on public.users
  for update using (auth.uid() = id) with check (auth.uid() = id);
-- inserts happen via the auth trigger; deletions via auth cascade.

-- devices ---------------------------------------------------
create policy devices_select_own on public.devices
  for select using (auth.uid() = user_id);
create policy devices_update_own on public.devices
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
-- device rows are inserted exclusively by the API (service role),
-- so there is deliberately no insert policy for regular users.

-- containers ------------------------------------------------
create policy containers_select_own on public.containers
  for select using (public.user_owns_device(device_id));
create policy containers_update_own on public.containers
  for update using (public.user_owns_device(device_id))
  with check (public.user_owns_device(device_id));
-- container creation (calibration) and deletion happen through server
-- actions with the service role; users may only rename / toggle active.

-- readings --------------------------------------------------
create policy readings_select_own on public.readings
  for select using (public.user_owns_device(device_id));
-- readings are only ever written by /api/readings (service role).

-- device_events ----------------------------------------------
create policy events_select_own on public.device_events
  for select using (public.user_owns_device(device_id));
-- events are only ever written by the API (service role).

-- ------------------------------------------------------------
-- 7. Realtime — publish the tables the dashboard listens to
--    (with RLS enabled, Realtime only streams rows the caller
--     can SELECT, so no per-user filtering is needed client-side)
-- ------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.readings;
    exception when duplicate_object then null; -- already added
    end;
    begin
      alter publication supabase_realtime add table public.devices;
    exception when duplicate_object then null;
    end;
  end if;
end $$;

