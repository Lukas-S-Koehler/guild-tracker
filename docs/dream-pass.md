# Dream Pass (Phase 2, D6) — Dream Hub step 15

Status: spec signed off and built 2026-11-24 (commit on `dream-hub`). Numbers calibrated on live data (Sep–Nov
2026: ~75 active accounts per month, alts pooled into accounts) and checked with a dry run of the real evaluator.

## Shape (user decisions 2026-11-24)

- **Seasonal + lifetime.** Season = calendar month (UTC). Season XP and pass level reset on the 1st.
  **Lifetime Dream XP** = all season XP ever earned, never resets, drives the rank roles (Dreamer … Dream Weaver).
- Earned per **account** (main + alts pooled, same as achievements). Rules below stop alts from multiplying XP.
- Sources: daily requirement, raids, assault (weighted heaviest), community (kudos, bumps, challenge items,
  stockpile), Discord chat, achievement unlocks.
- Shows: pass card on `/me` + profile, season leaderboard tab, Discord `/pass`, level-ups in the #hall-of-fame
  digest, season-end post, temporary season role. Reward track stays empty until Phase 3 (Dream Crystals).

## XP table (season XP)

| Source | XP | Rule / cap | Sim. month (p50 / p90 / max) |
|---|---|---|---|
| Daily requirement met | **10** per game day | once per account per day, however many guild groups; bank cover counts | 130 / 370 / 390 |
| Streak bonus | **+20** per 7 met days in a row | holidays pause, don't break | (incl. above) |
| Raids | **2** per raid | pooled across alts | 46 / 172 / 402 |
| **Contribution value** | per game day by market value of challenge items + stockpile deposits (`daily_logs.gold_donated + deposits_gold`, already quantity × market price): **≥5k → 2 · ≥15k → 4 · ≥30k → 6 · ≥75k → 8 · ≥150k → 10** | bands, not a straight conversion: one cheap item earns nothing, a whale day caps at 10. Account total per day | daily value p50 10.5k · p90 28.6k · p99 94k · max 908k |
| **Assault wave attended** | **40** per wave | account counts once per wave; needs ≥1,000 wave EXP | — |
| **Assault wave EXP** | **+1 per 2,000 EXP** | max +25 per wave | — |
| **Assault season finish** | **+75** top 10 of your guild · **+150** #1 of your guild | per zone, lands when the season recap runs | — |
| **Territory boost** | **+100** | your guild finished top 10 in the zone and you attended ≥ half its waves | — |
| Kudos received | **15** each | | — |
| Kudos given | **5** each | max 3/week already | — |
| Discord bump | **1** each | no cap (natural cap ≈ 12/day, one bump per 2 h) | max 46 in Nov |
| Discord chat | **5** per active chat day | from the Discord level system below (≥3 counted messages that day); Discord must be linked | 15 / 100 / 155 |
| Achievement unlock | Bronze 10 · Silver 25 · Gold 50 · Crystal 100 · Dream 200 | unchanged tier values | — |

Assault weighting check: 2 DE waves (Nov 19 + 22) gave attendees 55–130 XP. At ~9 waves a month a regular
assaulter earns ~450–550 assault XP **on top of** their daily XP, i.e. roughly double a top raider.

Simulated season totals (Oct, no assault/bumps/chat yet): **p50 ≈ 190 · p75 ≈ 400 · p90 ≈ 520 · max ≈ 1,030**.
With Nov assault rates: regular assaulter ≈ 900–1,100.

Not counted: plain gold (behind "requirement met" + gold achievements), energizing pool activations (depend on the
guild's challenges, not on the person; user 2026-11-24).

## Level curve (season)

20 levels. Level `L` costs `30 + 3·(L−1)` XP → cumulative:

| Level | 1 | 3 | 5 | 8 | 10 | 12 | 15 | 18 | 20 |
|---|---|---|---|---|---|---|---|---|---|
| XP | 30 | 99 | 180 | 324 | 435 | 558 | 765 | 999 | 1,170 |

Typical member → L5, top raider → L12, regular assaulter → L18–20. Past 20: a ⭐ per extra 100 XP (bragging only).
Phase 3 hangs crystal rewards on levels.

## Discord level system (parallel)

Own system in DreamBot, no third-party bot: MEE6 / Arcane have no official API, UnbelievaBoat's API is economy only,
so reading their levels would be fragile.

- **How it counts:** daily (with the daily workflow, can run hourly) DreamBot reads new messages of member channels
  through the REST API from a stored cursor per channel (message snowflake). Missed runs catch up on the next run,
  re-runs are idempotent (message id unique). Volume ≈ 2.5k human messages / 30 days.
- **Anti-spam:** a message counts if it is ≥ 5 characters (or has an attachment), not a bot, and ≥ 60 s after the
  author's previous counted message (MEE6-style cooldown). Staff channels, bot-command channels and #bump excluded.
- **Discord XP / levels:** 1 Discord XP per counted message (+1 bump), own level curve, shown on `/me`, profile,
  Discord `/pass` (or `/rank`). Lifetime, does not reset.
- **Feeds the pass:** a day with ≥ 3 counted messages = an *active chat day* → 5 season XP. Discord levels feed
  achievements (new "Chatter" ladder: e.g. Discord level 5 / 10 / 20 / 30 / 50).
- **Limits:** messages deleted before DreamBot reads them don't count (fine). Unlinked Discord users accrue Discord
  XP keyed by Discord id; it joins their account once they `/claim`.

## Lifetime Dream XP + ranks

Lifetime Dream XP = sum of all season XP, backfilled from history on the first run (daily_logs since May 2026,
assault data, bumps, kudos, achievements; Discord chat from the start of the server, Nov 2025).

**Assault seasons before per-wave tracking (≤ 12)** were all imported on 2026-11-21, so their real dates are unknown.
Their XP (estimated waves from season EXP, ~20k EXP per wave, max 9, plus finish bonuses) goes to a `history`
bucket: it counts for lifetime Dream XP and ranks, never for a monthly season. Seasons with wave data (13+) are dated
normally (waves by start time, finish bonuses by the season's last snapshot).

Dry run 2026-11-24 (220 accounts with XP, chat not yet read): lifetime p50 450 · p75 1,786 · p90 3,606 · max 12,086.
Monthly seasons May–Nov: p50 45–320 · p90 420–640 · max 1.0–1.4k.

The old ladder (100 / 300 / 600 / 1,000 / 1,500, achievements only) had 3 people at Dream Weaver. **New ladder:**

| Rank | Dream XP | Accounts at launch |
|---|---|---|
| Dreamer | 300 | 122 |
| Lucid | 1,250 | 68 |
| Visionary | 3,000 | 33 |
| Crystal Mind | 6,000 | 12 |
| Dream Weaver | 15,000 | 0 (top 12.1k; a regular assaulter earns ~1k/month) |

## Season end (1st of the month)

- A season is frozen 2 days after it ends (late logs / wave finalisation): `dream_pass_seasons` stores the top 10
  (ties at place 10 included) and the rows are never rewritten. Then a #hall-of-fame post: top 10, how many reached
  level 20, total XP earned.
- **Season Champion** role: the top 10 of the newest frozen season, until the next one is frozen. Created by
  DreamBot in Admin → Discord → Role sync (next to the rank roles), synced by the normal role sync.
- At launch every past month is frozen silently (no posts); October's top 10 become the first champions.

## Achievements added (silent backfill of their own on the first run after the pass launched)

| Key | Name | Rule | Tier |
|---|---|---|---|
| chat-1…5 | Say Hello · Regular · Chatterbox · Voice of the Dream · Lounge Legend | Discord level 3 / 10 / 20 / 30 / 50 | Bronze → Dream |
| pass-1, pass-2 | Pass Climber · Pass Master | Dream Pass level 10 / 20 in one season | Silver, Gold |
| season-top10 | Season Champion | top 10 of a season | Gold |
| season-top3 | Podium | top 3 of a season | Crystal |
| season-top1 | Dream of the Month | #1 of a season | Dream |

Discord level curve: total Discord XP for level L = 3L² + 7L (L3 = 48, L10 = 370, L20 = 1,340, L30 = 2,910,
L50 = 7,850). 1 Discord XP per counted message, +1 per bump.

## Build

- Migration `database/dream-pass.sql`: `dream_pass_scores` (one row per character per season + `lifetime`, same
  account total on each, `is_main` = the row boards use), `dream_pass_seasons`, `dream_pass_milestones`,
  `discord_chat_messages` (id, author, channel, time; no content), `discord_chat_cursors`.
- XP is **recomputed** daily from source data (robust to late logs, alt regrouping and fixes); frozen seasons are
  never rewritten. Phase 3 crystals will get their own spend ledger.
- Code: values/curves `src/lib/dream-pass.ts`, evaluator `src/lib/dream-pass-eval.ts`, reads
  `src/lib/dream-pass-read.ts`, account card data `src/lib/dream-pass-account.ts`, chat reader
  `src/lib/discord-chat.ts`, posts `src/lib/dream-pass-discord.ts`.
- Cron `POST /api/cron/dream-pass` (daily-activity workflow, after achievements, before the role sync):
  read chat → recompute → milestones → freeze → #hall-of-fame (launch post once, season results, level
  milestones 5/10/15/20, highest new level per person). `{ "dry_run": true }` previews with distribution stats,
  `{ "chat_only": true }` only reads chat (workflow `discord-chat.yml`, every 2 h).
- Surfaces: Dream Pass card on `/me` and `/p/[ign]` (level, XP per source, season place, lifetime Dream XP + rank,
  Discord level, champion seasons), `/leaderboard` tab **Dream Pass** (this month) + **Dream XP** (lifetime),
  Discord **`/pass [ign|user] [share]`**, `/leaderboard board: pass`.
- Order inside the daily workflow means pass-based achievements (level, champion) lag one day; achievement XP
  counts in the pass the same day.
