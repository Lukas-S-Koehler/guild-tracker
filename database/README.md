# Database

Supabase Postgres. Migrations here are plain SQL, run by hand in the Supabase SQL editor.
Every file is meant to be safe to re-run (`IF NOT EXISTS`, `DROP ... IF EXISTS`).
`archive/` holds one-off fix and debug scripts from early development. Don't run them.

## Base schema
`schema.sql` → `multi-guild-phase1.sql` → `multi-guild-complete.sql` → `rename-guild-members-to-leaders.sql`,
then the `add-*.sql` feature migrations.

## Feature migrations (newest last)
- Members/guilds: `add-guild-id-to-members`, `add-character-id`, `add-member-class`, `add-guild-is-active`,
  `add-guild-is-assault`, `add-dream-engineers-guild`, `add-guild-activity-events`, `add-guild-buildings`,
  `add-armoury-building`, `add-deposits-tracking`, `add-overflow-bank`, `add-log-order-column`,
  `update-leaderboard-views-with-deposits`
- Users: `add-find-user-function`, `add-find-user-by-username-function`, `add-search-users-function`,
  `add-get-guild-members-function`, `add-member-keys-table`, `user-api-keys-migration`
- Challenges: `create-challenge-item-quantities`, `add-challenge-quantity-toggle`
- Discord/alts/warnings: `add-discord-alts-warnings`, `add-alt-source`, `add-bumps`, `raid-reminders`
- Assault: `assault-planner`, `assault-planner-seed`, `assault-potions*`, `assault-waves`, `assault-conquest`,
  `assault-standings`, `assault-stat-sync`, `assault-checklist-discord`, `assault-24h-notice`,
  `assault-rework-2026-11`, `world-locations`
- Combat: `add-combat-enemies`, `combat-tool`, `combat-tool-v2`
- Accounts: `account-claims` → `claims-one-per-user`
- Members: `add-member-combat-level` (lazy-filled on /me)
- Dream Hub: `discord-live-messages`, `discord-commands-roles`, `achievements`, `assault-personal` (pinned combat setup, season recap state), `kudos`, `dream-pass` (pass scores, frozen seasons, milestones, Discord chat messages + cursors)

## Scheduled jobs
| Job | Trigger | Schedule |
|-----|---------|----------|
| `/api/cron/raid-reminders` | Supabase pg_cron `raid-reminders-tick` (`raid-reminders.sql`) | every minute |
| `/api/cron/assault-scheduler` | pg_cron `assault-scheduler-tick` (`assault-planner.sql`) **and** GitHub `assault-scheduler.yml` | 1 min / 5 min — GitHub is an intentional backup, endpoint is idempotent |
| `/api/cron/assault-collector` | pg_cron `assault-collector-tick` (`assault-conquest.sql`) **and** GitHub `assault-collector.yml` | 5 min — overlap is harmless (upserts, quiet finalize, no posts) |
| `/api/cron/world-locations-sync` | GitHub `world-locations-sync.yml` | 11:02 UTC daily |
| `/api/cron/combat-enemies-sync` | GitHub | 11:08 UTC daily |
| `/api/cron/price-cache-sync` | GitHub | 11:18 UTC daily |
| `/api/cron/unmapped-report` | GitHub | 11:24 UTC daily |
| `daily-activity`, `members-sync-all`, `achievements`, `dream-pass`, `discord-roles`, `auto-warn`, `discord-live`, `backfill` | GitHub `daily-activity.yml` | 11:48 UTC daily |
| `/api/cron/dream-pass` `{chat_only}` | GitHub `discord-chat.yml` (reads Discord chat) | every 2 h at :17 |
| `/api/cron/guild-hall` | GitHub | 15:50 UTC daily |
| `/api/cron/monthly-bump-king` | GitHub | 00:05 UTC on the 1st |

Active pg_cron jobs (checked 2026-11-22): raid-reminders-tick, assault-scheduler-tick, assault-collector-tick. Check with `select jobname, schedule, active from cron.job;`
