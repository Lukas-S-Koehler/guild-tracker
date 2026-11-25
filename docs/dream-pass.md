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
| Achievement unlock | Bronze 10 · Silver 25 · Gold 50 · Crystal 100 · Dream 200 | **lifetime Dream XP only** (since 2026-11-26), never season XP | — |

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
normally (waves by start time, finish bonuses by the season's last snapshot). Same for **achievement unlocks from a
silent backfill** (the step 9 launch and later batches): many were stamped "now", so they count for lifetime only;
unlocks earned live count for their month.

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
  `{ "chat_only": true }` only reads chat (workflow `discord-chat.yml`, every 2 h), `{ "skip_feed": true }` posts
  nothing.
- Launch 2026-11-24: chat backfilled (41 member channels, 62.7k messages, 43.2k counted after the cooldown, 291
  people), pass computed and every month before November frozen silently from the dev server (`skip_feed`); the launch
  post goes out on the first daily run on production. Discord levels at launch: 78 people L3+, 23 L10+, 10 L20+, 2
  L30+, top L38.
- Which channels count is public: the **ℹ️ How it works** button on `/pass` and `/level` lists the rules and every
  counted channel (live from Discord); the launch post and every "Discord chat" hint say "member channels, not staff
  or bot channels".

## Follow-up (user, 2026-11-24)
- Name stays **Dream Pass** (`/pass`).
- `/leaderboard` page: Dream Pass is the first tab and the default, with a month picker (finished months come from the
  frozen rows, `GET /api/leaderboard/pass?season=`); new **Discord level** tab. Pass card on `/me` / profiles has a
  month picker too (`?season=` on `/api/me/pass` and `/api/profile/[ign]/pass`).
- Discord: `/leaderboard` defaults to the Dream Pass board (activity options without `board:` still mean activity),
  `board: discord`; **`/pass month:`** (autocomplete) for past months; new **`/level [ign|user]`** (level, XP, place,
  messages, bumps, chat days this month).
- `share:` options removed from `/me`, `/profile`, `/pass`, `/assault me`: personal cards reply privately with a
  **📢 Share** button that posts the same card publicly (custom_id `hubshare:<card>:<arg>`). Discord has no flag-only
  option type, a boolean always asks True/False. Same for `how:` → ℹ️ button (`hubhow`).
- Surfaces: Dream Pass card on `/me` and `/p/[ign]` (level, XP per source, season place, lifetime Dream XP + rank,
  Discord level, champion seasons), `/leaderboard` tab **Dream Pass** (this month) + **Dream XP** (lifetime),
  Discord **`/pass [ign|user] [share]`**, `/leaderboard board: pass`.
- Order inside the daily workflow means pass-based achievements (level, champion) lag one day; achievement XP
  counts in the pass the same day.

## Leaderboard speed (2026-11-26)
- Building every `/leaderboard` network board takes ~12 s (all `daily_logs` + ~63k Discord chat rows), which every
  cold 30-min cache paid. Now the dream-pass cron stores the result as a snapshot (`app_settings` key
  `network_boards_snapshot`, ~90 KB JSON) after the daily recompute and after each 2-hourly chat-only run, and
  revalidates the cache tag. `/api/leaderboard/network` reads that one row; it rebuilds live only when the snapshot
  is missing, older than 30 h, or from last month. The Activity board only loads when its tab is open.

## Achievements → lifetime only (user, 2026-11-26)
- Achievement XP no longer counts for any season, only for lifetime Dream XP (ranks unchanged). Reason: unlocks are
  one-time and lumpy, and the pass's own achievements (level 10/20, champion) fed back into the season.
- Impact on live November (before → after): achievements were 30% of season XP; p50 153 → 130, p90 489 → 430,
  max 1,225 → 741 (#1 had 715 achievement XP); 3 of the top 10 change; level 20 reached 1 → 0. Finished seasons
  (frozen) had 0% achievement XP already (backfilled unlocks went to history), so nothing frozen changes.
- Level curve unchanged: it was calibrated on simulated seasons without achievement XP.
