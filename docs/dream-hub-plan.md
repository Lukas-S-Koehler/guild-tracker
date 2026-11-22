# Dream Hub plan

Roadmap for turning guild-tracker into the Dream Guilds hub: personal pages, gamification,
a rewards economy, and a Discord server that stays in sync with the site.
Agreed 2026-11-22. Update the status column as steps land.

## Decisions

- **Claims:** one website user claims ONE IdleMMO account. The claim covers the whole alt bundle
  (`member_alts` closure, up to 5 characters). A pending claim already locks the bundle for others.
  IdleMMO is strictly one account per person, so the account page locks once a claim exists: the claim search
  is hidden and release is only offered as "claimed the wrong account by mistake?". Admins can force-release (revoke).
- **Identity:** the claimed main is shown top right (avatar, IGN, level, guild, position); alts in the dropdown.
- **Profiles:** members-only for now.
- **Currency:** Dream Crystals. Staff hand out reward items in game and mark them fulfilled.
- **Branding:** full visual refresh in Phase 1 (dark navy, crystal-blue accent from the logo).
- **Discord:** DreamBot may post achievements, DM digests, and add AND remove guild member roles.
  Achievement feed goes to a new `#hall-of-fame` channel. Staff will delete the manual `#guild-info`
  message once the live directory is up. `#daily-check` per-member kick notices are replaced by one daily board.
- **Giveaways (open):** currently AutoMod so staff can't rig them. If DreamBot takes over, the draw must be
  provably fair: freeze the entrant list at close, pick with a drand beacon round announced at creation
  (`sha256(beacon + giveaway_id) mod entrants`), publish a verify page. Decide with the giveaway staff.

## Phase 1: identity, cleanup, foundation

| # | Step | Status |
|---|------|--------|
| 1 | Claim rules (A1–A4): one claim per user, bundle locks, release, main in nav. Migration `database/claims-one-per-user.sql` | done |
| 2 | Cleanup audit (H1, H4). Part 1 done: dead APIs removed, old docs/SQL archived, `database/README.md`, world-locations daily workflow. Page merges happen in steps 3 (admin hub) and 4 (guild hub `/guild` with tabs Overview, Members, Activity, Inactivity (officer+), Leaderboard; role matrix member/officer/deputy/leader/super admin, enforced in the API too; old URLs redirect). `/setup` → `/account`, `/guilds` picker killed. `refresh-meta` gets a button in Admin → Assault. pg_cron/GitHub overlap for assault scheduler/collector checked: intentional and safe | part 1 done |
| 3 | Admin hub (H3): `/admin` as tabs: Claims & Access, Guilds, Members & Alts, Warnings, Assault, Discord, System (Rewards added in Phase 3). Panels live in `src/components/admin/`; old URLs (`/admin/claims`, `/admin/alts`, `/admin/bumps`, `/admin/raid-reminders`, `/assault/admin`, `/discord-mapping`, `/data-management`, `/price-cache`) redirect via `next.config.js`. Tab visibility uses the highest role across all guilds; APIs still enforce their own checks. `refresh-meta` button in Assault → Potions. `/warnings` stays as a member-facing page | done |
| 4 | `/me` dashboard (B1–B10): hero, stat tiles, today's requirement, streak, activity feed, heatmap, guild journey, move-up nudge, alts, warnings. One API `/api/me/summary` built on `daily_logs` (raids, gold_donated, met_requirement), `member_guild_history`, `warnings`, assault tables. Logic in `src/lib/me-summary.ts`; `?member_id=` switches to any character in the bundle. Guild journey comes from `daily_logs.guild_id` because `member_guild_history` is empty (not maintained). Inactivity mirrors `/api/reports/inactivity`. Nav: "Me" link + "My dashboard" in user menu | done |
| 4b | `/me` rework after first review: defaults to the whole account (all characters pooled; click a character to drill in). "Today's requirement" replaced by a **Daily check** card (activity is only checked once a day at 11:48 UTC, so it shows the last checked game day per character + countdown to the next check, never live progress). Move-up nudge uses **combat level** (new `members.combat_level`, migration `database/add-member-combat-level.sql`, filled lazily from the character info API, max once a day) because guild `min_level` is a CL, not total level. Ladder = active non-assault guilds; Dream Engineers shows "want hardcore assaults? ask to move to Dream Invaders" instead; DI shows nothing. Raids card from `src/lib/raids.ts`. Visual polish deferred to step 6 | done (run migration) |
| 4c | `/me` alt logic: the unit is a **guild group** (all of a user's characters in the same active Dream guild), same as the officer report: any character meeting the requirement covers the group, streak and days-inactive are pooled, weekly = any one character's own week total. Scopes: whole account (one daily-check row + streak per group), guild group (`?guild_id=`, logs limited to that guild), single character (only for characters outside an active Dream guild). Inactive guilds have no requirement. Known gap: the officer report links alts only by direct `member_alts` pairs, `/me` uses the full account bundle, so exemption can differ (e.g. leader's alt) — fix the report to use `getAccountMemberIds` | done |
| 5 | Guild pages `/guilds/[tag]` (F3), logged-out landing page (G1), "which guild fits me" picker (G2) | |
| 6 | Nav regroup Me / Community / Staff (H2) + full branding refresh (H5) | |
| 7 | Discord sync layer: `discord_live_messages` (key, channel_id, message_ids[], content_hash), edit in place, admin tab to bind/republish. First live messages: guild directory (#guild-info), raid schedule (#raid-pings), daily kick board (#daily-check), per-guild inactivity report edited in place, DI waitlist, links hub | |
| 8 | Discord commands: `/claim` (links Discord ID, auto-approves when `members.discord_id` matches, A5), `/me`, `/guild <tag>`, `/away <days>` (holiday system, uses #holiday-log, skips inactivity), welcome "Claim your character" button in #introductions. Role sync: in-game guild/position → Discord roles, add + remove | |

A6 (verify via profile bio code) only if the IdleMMO API exposes the bio.

## Raid tiers

Static game data in `src/lib/raids.ts` (name, location, minutes, marks, min CL): Barnyard Abyss 1, Whisperwood Seige 12,
Crystal Echoes 25, Frostbite Summit 40, Dunekeeper's Last Stand 60, Skybound Eden 70, Orbit of the Forgotten 80,
The Silent Watchers 92. Guild `min_level` uses the same CL scale. Each guild runs one raid, some lower guilds several:
set per guild in Admin → Guilds (`guild_config.settings.raids`); unset = the raid whose CL equals the guild's min level.
Assault guilds (`guilds.is_assault`: DE, DI) run no raids and are nominally CL 100+; DE → DI is a "hardcore assaults" move, not a level move, and the top raid tier (DT/DR) points to DE for assaults. Used by /me now; reuse in step 5 (guild pages, "which guild fits me" picker matches on CL + raid), step 7 (live raid
schedule message) and F5 (calendar). `raid_reminders` could get a `raid_key` column later to tie pings to a raid.

## Phase 2: gamification and community

- **D1/D2 Achievements + badges:** `achievements` (key, category, name, desc, tier, threshold, metric, xp) + `user_achievements` (member_id, achievement_key, unlocked_at). Daily evaluator cron. ~60–80 tiered achievements: contribution, streak, assault, challenges, loyalty, level, community (bumps), journey.
- **D3** unlock posts to #hall-of-fame. **D4** achievement/rank Discord roles. **D5** selectable title.
- **D6 Dream Pass:** `dream_xp_events` ledger, level curve, rank names.
- **C1–C4 Assault personal:** `/me/assault` with waves, marks, season contribution, rank, checklist progress, pinned combat loadout; season recap card (also to Discord).
- **F1** profiles `/p/[ign]` (members-only). **F2** network leaderboards (cross-guild, per class, most improved, longest streak). **F5** calendar from `raid_reminders`.
- **F4** league party finder: `party_posts`, bot creates threads in the #league-party-find forum.
- **F6** mentors, **F7** kudos (`kudos` table, weekly shoutout).
- **F8** weekly DM digest (opt-in). **F9** + `/profile`, `/achievements`, `/leaderboard network`, `/party`, `/kudos`.

## Phase 3: Dream Crystals economy

- **E1** `shard_ledger`-style ledger for crystals (member_id, delta, reason, ref, at); balance = sum.
- **E2** `reward_tiers` + `reward_claims` (claimed → fulfilled/rejected), staff fulfilment queue in admin, bot pings staff.
- **E3** giveaways (`giveaways`, `giveaway_entries`), auto eligibility, provably fair draw (see decisions).
- **E4** roulette, sandbox mode first, every spin in the ledger.
- **E5** forge request queue (#defias-forgery / #spark-forging-hammer), "Pick up" button for forgers.

## Discord reference

Server and channel IDs are in Claude's memory (`reference-discord-channels`). DreamBot can read every
channel (message content works), so a read-only inventory via the bot token in `.env.local` is enough to see
what is posted where. Patterns worth reusing: `#bump` leaderboard (one message edited in place with a button)
and the `/guide` publisher (tracked multi-message post).
