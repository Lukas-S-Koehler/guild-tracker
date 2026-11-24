-- Activity fetch hardening: one row per guild per activity fetch (daily cron, backfill, manual).
-- covered_from..covered_to = the time window of the IdleMMO activity feed this run fully read.
-- Game days not covered by any ok run are "gap days": streaks pause on them instead of breaking,
-- and the watchdog (assault-scheduler tick) alerts staff on Discord.

create table if not exists activity_fetch_runs (
  id bigserial primary key,
  guild_id text not null,
  source text not null,              -- 'cron' | 'backfill' | 'manual'
  run_at timestamptz not null default now(),
  ok boolean not null,
  events integer not null default 0,
  covered_from timestamptz,          -- null = read the whole feed
  covered_to timestamptz,
  error text
);
create index if not exists activity_fetch_runs_guild_run on activity_fetch_runs (guild_id, run_at desc);

-- One Discord alert per (day, key): key = 'daily-missing' or 'guild:<id>'.
create table if not exists activity_fetch_alerts (
  day date not null,
  key text not null,
  sent_at timestamptz not null default now(),
  primary key (day, key)
);

alter table activity_fetch_runs enable row level security;
alter table activity_fetch_alerts enable row level security;
