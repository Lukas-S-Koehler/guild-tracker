# Assault Roster: spec (draft v3, 2026-11-25)

Goal: make DE and DI feel like one unit. One place shows what every assaulter is running for **battle** and **hunting**, where each person stands on shared goals, and the cheapest next upgrade that gets them to the next goal.

Status: **spec agreed 2026-11-25.** Step 1 (static data + hunting formulas) built: `src/lib/combat/pet-hunting.ts`, `src/lib/combat/hunting-gear.ts`, check `npx tsx scripts/check-pet-hunting.ts`. Step 2 (snapshots) built: `database/assault-roster.sql`, `src/lib/assault-roster-sync.ts`, `/api/cron/assault-roster` (+ `.github/workflows/assault-roster.yml`, 03:30 UTC, loops while `remaining` > 0), `/api/assault/roster/refresh` (owner or officer+ for one character, officer+ for a guild). Uses the owner key when the account is claimed, else super admin key; keys allow ~20 req/min (3 per character). Also fills `members.combat_level`. Step 3 built: `/assault/roster` (Lineup + drawer, in the Assault menu), `/api/assault/roster` (GET roster, PATCH bow/non-assaulter), `src/lib/assault-roster.ts`; hunting bow stored on `assault_roster.hunting_bow` (not combat_profiles); staff-only `non_assaulter` flag (user rule); Admin → System → Pets (`custom_pets`, paste parser in `src/lib/combat/custom-pets.ts`). Step 3b (user feedback 2026-11-25): rarity colours Standard grey, Refined blue, Premium green, Epic red, Event pink (own tier, `EVENT_PETS`), Legendary yellow, Mythic orange (same as /combat gear); battle pet = strongest OWNED pet for the selected location (fewest hits, then 2-hit scaling headroom, then damage), not the equipped one; hunt power = best **20** pets (a squad hunts then sleeps, sleep is longer, so two groups rotate); location picker on the roster (default = guild's tracked assault zone, ids 1–10); hits column = chips per hit count ("3× 2 hits · 1× 3 hits") plus "2 hits to Lv X" for scalers (CL 80+ up to own CL, CL 100+ up to 150); drawer battle card with stats, potions, per-mob hits. Step 3c (2026-11-25): "Pet hunt power" label; best-hunter column removed; hits = one coloured square per mob + "all 2 hits" / "2 hits to Lv X" (scaling only at CL 100+, up to 150, user rule for the roster); potions shown as icons (loadout pill, drawer slot cards, guild "Potions in use" card incl. XP potions); **participation tiers** `assault_roster.participation` = auto (always in) / opt_in (chooses per assault) / none (not assaulting). Owner switches auto ↔ opt_in, only staff set/clear none. Opt-in members get assessed separately in later steps (RSVP); future general assault requirements will be configured through the roster goals. Step 3d: pets below the location's lowest enemy level can't hunt there (excluded from pet hunt power, shown "below L70" in the drawer); loadout shows the matching /assault/potions preset (★ = recommended) or "Custom" instead of the loadout name. Step 4 built: `src/lib/roster-goals.ts` (tracks hits / bow / pet_hunt / pet_mastery / prep, defaults, evaluate), table `assault_roster_goals` (JSONB per guild), `/api/assault/roster/goals` (GET/PUT, LEADER+), Admin → Assault → Roster goals editor (thresholds + optional "required" tier = future assault requirement, shown not enforced), roster Lineup | Goals switch (goals always at the guild's assault zone): team progress bars per track, everyone's tier chips + closest next step, Goals card in the drawer.

---

## 1. Placement and visibility

- `/assault/roster`, in the Assault ▾ menu. One tab per `is_assault` guild (DE, DI). Each row is one character currently in that guild.
- Everyone in that guild sees the full roster. Staff of that guild and the super admin also see it.
- Discord: `/roster [ign]` and a live roster board per guild (section 7).

## 2. Views

| View | Shows |
|---|---|
| **Lineup** | One row per assaulter, showing what they run. **Battle:** CL + ascension, class, battle pet (species/level/evo), gear set or not, default potion loadout, hits-to-kill on current zone mobs, slayer. **Hunting:** hunting level, hunting bow (+eff %), best hunting pet, pet squad (count and quality mix), **Citadel est. encounters per hunt**. **Wave RSVP** for the next wave. |
| **Goals** | Per member, a tier on each goal track (section 5) plus their **Next best moves** (section 6). The header shows team progress, e.g. "14/22 at ≤3 hits", "9/22 have a Gold bow". |
| **Drawer** (row click) | Read-only mini combat sheet, the full pet stable with hunting numbers per pet, goal tiers, and the upgrade list with prices. Links to their `/combat`. |

Tone: goals are long-term targets ("next tier: …"), never red failure flags.

## 3. Data

### 3.1 Snapshots
- New table `assault_roster` (one row per DE/DI character). Columns: `member_id`, `hashed_id`, `guild_id`, info, skills, `equipped_pet`, `pets`, effects, `last_sync`, `pets_hidden`.
- Filled by a daily cron (after the member sync) and a staff "refresh" button. It reuses `fetchCharacterSnapshot`: the owner's key first, the super admin key as fallback. Hidden pets keep the last stored list and get flagged.
- Gear and the potion loadout come from `combat_profiles` (matched by hashed_id) and `assault_potion_loadouts`. No API data exists for these, so anything not entered shows "not set yet", which is itself a goal.
- **Hunting bow:** a new field on `combat_profiles.settings.hunting_bow`. It is separate from the combat bow slot. Members set it on `/combat` or in their own roster drawer.

### 3.2 Static data to add
- **`hunting_bows`** seed table: name, quality, hunt eff %, required combat level (the higher number, e.g. 63), required dexterity (e.g. 50), `hashed_item_id` for prices. There are 25 bows, from Shadow Shot +5% to Divinity +20%. Eff % doesn't change with upgrades, so tier is ignored.
- Equip rules for all upgrade suggestions: combat level plus a stat requirement. Swords and daggers need strength, bows need dexterity, everything else needs defence. A suggestion is only shown if the character meets both, or it is marked "needs DEX 80" as a longer goal.
- **`pet_eggs`** seed table: species, quality, `hashed_item_id`. Prices come from market history. Mythic eggs never trade, so they get a fixed estimate (≈20M, labelled "no market"). Eggs with no listing (Nova, Nutmeg, Ollo, Rattles, Ravenwing, Splash, Wingsley) show "not on market" and are never suggested.
- **Pet hunting stats** in `pet-data.ts`: movement speed (base, perLevel) and max stamina (base, perLevel) for every species, including event pets and Shardback.
  - Shardback: MS 2 + 0.225/L, stamina 200 + 1.5/L, agility 9 + 0.81/L.

### 3.3 Pet hunting formulas (checked against the Citadel table)
- **Agility** = round(floor(base + (L−1)·perLevel) × mult). This is the existing combat formula. The table uses mult = 1.2 at Lv 100.
- **Movement speed** = round1(base + (L−1)·perLevel) × msMult. Checks: Fluffy 3.97 → 4.0 × 1.2 = 4.80 ✓, Shelly 1.485 → 1.5 × 1.2 = 1.80 ✓, Wrex 14.1 × 1.2 = 16.92 ✓. mult = 1 + (pet mastery bonus + evolution 5%/stage) / 100 for both agility and MS. Pet mastery DOES boost MS (user confirmed; the table's ×1.2 = mastery 100). Pat does **not** apply to hunting. Evolution works like combat (user confirmed).
- **Hunting squad size** = 2 + floor(petMastery / 12.5), so 2 at Lv 1, 3 at 13, 4 at 25 … 10 at 100. The same count applies to battling and hunting at the same time.
- **Max stamina** = floor(base + (L−1)·perLevel), no multiplier (Leovar 268.8 → 268 ✓).
- **Hunt length** = max stamina / drain, with drain by quality: Standard 0.025, Refined 0.022, Premium 0.019, Epic/Event 0.016, Legendary 0.013, Mythic 0.010 (99 / 0.025 = 3960 s = 1:06:00 ✓).
- **Time per enemy (Citadel, enemy Lv ~100)** = 199.91 − 0.7237·min(agility, 120) − 0.3978·MS seconds. Max error 0.61 s and encounters within ±1 on all 45 rows. Agility above 120 does nothing in Citadel (fitted cap; it may scale with enemy level elsewhere).
- **Squad hunt power** = the sum of Citadel est. encounters per hunt over the best N pets, where N = squad size. Pets do most of the hunting for high-level battlers (user), so this is the headline hunting number.
- **Encounters per hunt** = hunt length / time per enemy.
- **Labelling rule:** every encounter number says **"Citadel est."**, with a tooltip saying Citadel is the hardest zone, so every other zone gives more encounters. It is an estimate, not a calculator.

### 3.4 Prices
- Extend the existing price cache (`price-cache-sync`, market lowest listing) to `gear_items`, `hunting_bows` and pet eggs (**open question 4**).
- Show the price with an "as of" time. Untradeable items, and characters without market access (Banished/Cursed), show "unpriced", the same way the potion advisor does.

## 4. Character hunting
- Hunting level, bow eff %, and active hunting-eff effects (potions, territory). These are shown, not combined into a formula.

## 5. Goals v2 (agreed with the user 2026-11-25)

Tiers: **Bronze** = minimum requirement · **Silver** = cost-effective, almost a must-have · **Gold** = very good, upper half · **Crystal** = the top · **Dream** = absolutely perfect in that element. Measured at the guild's assault zone. Leaders edit numeric thresholds (and the Battle Dream scale level) per guild in Admin → Assault → Roster goals (`assault_roster_goals.goals` = GoalSet JSON). Code: `src/lib/roster-goals.ts`.

**Prerequisites** (not tiers; without them a member isn't measured, and they're always the first next step): gear set on /combat, default potion loadout, pets visible.

| Element | Importance | Bronze | Silver | Gold | Crystal | Dream |
|---|---|---|---|---|---|---|
| Battle (hits on every zone mob) | Core | all ≤4 | all ≤3 | all 2 unscaled | all 2 scaled to Lv 120 (CL 100) | all 2 scaled to Lv 150 (CL 100) |
| Pet hunt power (best 20 eligible pets) | Core | 600 | 1,200 | 1,800 | 2,500 (≈20 Epic Vulpinas L100) | 4,000 (≈20 Legendary L100) |
| Pet mastery | High | 50 (6 pets) | 63 (7) | 75 (8) | 88 (9) | 100 (10) |
| Battle pet (best owned) | High | Epic L80+ | Epic L100 | Legendary L100 | Mythic L80+ | Mythic L100 evo 5 |
| Hunting mastery (flee mechanic) | High | 70 | 80 | 85 | 90 | 100 |
| Potions (loadout vs presets) | Medium | Budget | Silver preset | Gold preset | Mid | Whale |
| Hunting bow | Medium (×0.5 once pet hunt power is Gold+) | 5% | 10% | 15% | 18% | 20% |
| Slayer | Bonus | slayer level ≥ highest zone mob (task eligible) | avg 2% | avg 4% | avg 7% | 10% on every mob |

Event pets rank between Premium and Epic, so they don't count as Epic for the battle pet ladder. Potion tier = best preset (with `assault_potion_presets.assault_tier`) the loadout matches or beats on AP %, Prot %, Battle XP %, Combat XP %. Silver = Thunderfury + Dragonblood + Wraithbane, Gold = Phoenix Ashes + Dragonblood + Wraithbane (proposed, user may change). Weights for next best moves: Core 3, High 2, Medium 1, Bonus 0.5. Next step = missing prerequisite → missing Bronze on a non-bonus element → best weight × progress. "Meets the minimum" = prerequisites + every non-bonus element at Bronze.

## 6. Next best moves (built 2026-11-25, `src/lib/roster-moves.ts`)

Per member, computed in `buildRoster` at the guild's assault zone, top 6 kept on `RosterRow.moves`:
1. **Setup** (missing prerequisites, with a Fix link) always first.
2. **Free / training**: level owned pets to L100 (pet hunt power), level/evolve an owned pet of the right quality (battle pet), train pet mastery / hunting mastery / slayer, "reach CL 100 to pick your scaling".
3. **Buy** (only with market access; Banished/Cursed skip): cheapest bow reaching the next bow tier (CL/DEX checked), one egg species that fits the tier (each pet ≥ target / 20 encounters at L100, so Bronze = Refined … Dream = Legendary), cheapest egg of the next battle pet quality, next tiered potion preset (cost per assault), cheapest single gear swap bought at tier 1 that lifts the battle tier.
Ranking: missing minimum (+100) first, then importance weight × cost factor (log scale) × progress. Prices = `market_cache` (weighted median of recent sales); the daily price cron now also tracks hunting bows, pet eggs and every gear item. Mythic eggs use the fixed ≈20M estimate. Prices are only trusted when they come from real sales or market history (`market_cache.price_source` = sales/history); a vendor fallback (e.g. Divinity 3M vendor vs 60M+ real) is never suggested. Egg buys are only suggested when the member's own pets, levelled to L100, can't reach the tier (levelling is free). "Switch class to Ranger" is always suggested for non-Rangers (best assault class), right after the top goal move.

UI: red **Setup & eligibility** block (prerequisites + below-minimum elements, with Fix links) at the top of the roster for your own characters and in the drawer; "Next best moves" list in the drawer; Goals table shows each member's top move with cost.

Battle pet buys: never more than one rarity above the best pet owned (floor Epic). Epic/Legendary suggestions name the best species for battling at the zone for that character at L100 (fewest hits, then most damage, then least damage taken; user rule 2026-11-25). Mythic is always just "a Mythic egg" (≈20M est., all equal).

### 6b. Pet egg choice + weigh options (2026-11-25, user rule)

- **Pet hunt eggs:** candidates must *fit* the target, meaning at least target ÷ 20 encounters each at L100, so they stay useful once the stable is full. The rarity is the lowest one with a fitting species that reaches the target. Within that rarity the suggestion is the **strongest** species, not the cheapest: pets hunt for months, so a little gold doesn't outweigh that (e.g. 4× Wrex, not Raptora). Mythic eggs hatch a random Mythic, so they are one generic row using the weakest Mythic.
- **Battle pet eggs:** the strongest species of the proposed rarity for battling at the location (L100 simulation with their gear, loadout and mastery: fewest hits, then highest 2-hit scaling level for CL 100+, then most damage, then least damage taken; hits shown as one coloured square per mob like the Lineup). The free "level your pet" path prefers the pet shown as best battle pet, then the species that battles best here at L100. The `/roster` card has a 🐾 Pet plan field (battle pet + pet hunt moves).. The main move stays at most one rarity above the best owned pet.
- **Weigh options** (drawer: on pet moves and on the Pet hunt / Battle pet goal rows): tabs for every tier above the current one, so members can plan a jump (e.g. Crystal instead of Silver). Hunt: every egg with encounters per pet, eggs needed, gold, resulting power and tier, gold per encounter. Only eggs that reach the target and fit it are listed (user: weaker ones are useless). Battle: every species of that tier's rarity with hits (worst mob), damage taken, damage and egg price, plus a free "level your <pet>" path when one is owned. ★ = the suggestion.
- **Hunting bows:** the lowest rarity that reaches the target, then the strongest bow the character can equip now (CL + DEX), ties cheaper. If none is equippable yet, the closest one with its requirement; unpriced (no recent sales) bows are named without a cost. The weigh view lists only bows that reach the target: hunt eff, CL/DEX ✓/✗, price, tier.
- Code: `huntEggOptions` / `huntPlans` / `recommendHunt` and `BATTLE_PET_LADDER` / `recommendBattle` in `roster-moves.ts` (shared by server moves and the client view). Rows carry `hunting.stableL100`, `hunting.eggOptions` and `battle.speciesOptions`.

## 7a. RSVP (built 2026-11-25)

`assault_rsvps` (guild, wave launch unix, member, in/maybe/out, source web/discord). Effective answer: auto = in unless they answered otherwise, opt-in = no reply until they answer, none = out unless they answer for that wave (2026-11-25 v2, see §7c). Next wave = `nextAssaultLaunchUnix` of the guild's assault config. Web: "Next wave" column + tile (in · maybe · out · no reply), drawer buttons (owner or staff), "No reply" filter. Discord: RSVP opens on the **final summary after a wave** (next wave field + buttons, so opt-in members decide early and can hunt for it); pre-launch notices (negative offset steps) repeat the buttons. Buttons (`rsvp:<guild>:<wave>:<status>`); the clicker's characters in that guild (members.discord_id + site account link) are all set (since v2 also not-assaulting ones: a one-off answer), reply is ephemeral.

## 7. Cohesion extras (v1)

- **Wave RSVP:** new table `assault_rsvps` (`guild_id`, wave start, `member_id`, status in/out/maybe). Set on the web, with buttons on the existing wave announcement in Discord. The Lineup shows it, and staff see who hasn't answered.
- **Discord live roster board** (live key `assault-roster:<guild>`, edit in place): ready count, RSVPs for the next wave, team goal progress, last 7 days of tier-ups. It links the channel, not the site, unless needed.
- **Discord `/roster [ign]`:** no argument = guild summary. With an IGN = setup card (battle line, hunting line, goal tiers, next best move).

## 7b. Discord board + /roster (built 2026-11-25, `src/lib/roster-discord.ts`)

Live key `assault-roster:<guild>` (Admin → Discord → Live messages, default channel = the guild's assault announcement channel, edit in place, pinned): next wave RSVP counts with maybe / opt-in no-reply names, team goals (Bronze+ per element, x/N meet the minimum), setup needed, top pet hunt power, all-2-hits list, RSVP buttons. Refreshed with the daily live job and right after every RSVP (web or Discord). `/roster [ign] [guild]` (hub command, deferred, ephemeral): no IGN = the caller's assault guild summary; IGN = member card (setup status, battle with hit squares, hunting, goal tiers, next best move, next wave answer).

## 7c. Roster v2 (built 2026-11-25, migration `database/assault-roster-v2.sql`)

User decisions:
- **Participation is the owner's default** and they set it themselves: auto (in unless they say out) · opt-in (in when they say so) · not assaulting (out unless they say in for a wave). Staff can still set it. The per-wave RSVP always wins, from the web or the pinned board buttons, so a not-assaulting member saying "in" counts for that wave only.
- **Not-assaulting members are measured on the same goals.** The section is its own table (assault minimum, core tiers, next wave, own-row "In for next wave" / "Join (opt-in)"). An owner whose not-assaulting character meets the minimum gets a "Want to join?" prompt (opt-in / auto / just the next wave / not now). The `/roster` card says the same in Discord.
- **Potion fallback:** own default loadout → a leader's provisional preset (`assault_roster.provisional_preset`, preset picker in the drawer, LEADER+ with the hierarchy rule) → the Mid preset. The fallback only feeds the hits: the Potions goal stays "Not yet" until they save their own (user rule), and the fallback potions are shown greyed out. A missing own loadout is an amber reminder and doesn't block the minimum. "Potions in use" only counts own loadouts.
- **Leader gear edits** (drawer → Gear, confirm step listing every change): writes the character's /combat profile. If there's no profile, one is created for the owner. If the character is unclaimed, the gear goes to `assault_roster.staff_gear` and seeds /combat when the character is claimed and opened.
- **`/roster` defaults to your own setup** (user rule): no options = your highest-CL roster character's card with its default buttons (others listed, reach them with `ign:`); `ign:` = one member; `guild:` = the guild summary. No character of yours on a roster → your guild's summary as before.
- **Discord default:** `/roster-default default:<auto|opt_in|none> [ign]` (no IGN = all your roster characters; autocomplete = your own) and Auto / Opt-in / Not assaulting buttons on your own `/roster ign:` card (`rdef:<member>:<value>`, owner only). Single waves stay on the RSVP buttons. New hub command: run `?action=register-hub` once after deploy.
- Roster row extras: `E<n>` evolution pill on the battle pet, a broken-link icon when no Discord is known (members.discord_id or the owner's linked Discord).

## 8. Build order

1. Static data: `hunting_bows` seed, pet MS/stamina, hunting formulas plus a test against all 45 Citadel rows.
2. `assault_roster` snapshots, cron and refresh.
3. `/assault/roster` Lineup plus the drawer, and the hunting bow field.
4. Goals, with the default thresholds and the admin editor.
5. Price cache extension and Next best moves.
6. RSVP (web + Discord buttons).
7. Discord live board and `/roster`.

## 9. Open questions

None.

Resolved 2026-11-25: evolution boosts hunting agility/MS like combat (+5%/stage, user); squad hunt power tiers 250 / 600 / 1,200 / 2,000 approved for 10 pets, re-set to 600 / 1,200 / 1,800 / 2,500 for 20 pets (user: top ambition = 20 Epic Vulpinas ≈ 2,520); bow requirements = combat level + dexterity; pat doesn't boost MS; pet mastery does; squad size = 2 + floor(mastery / 12.5); eggs are priced from market history and Mythic eggs ≈20M (no market); agility cap 120 in Citadel (fitted); hunting level is not a goal track. Splash and Lumo were added to `PET_STATS`.

## 10. Assault eligibility page (built 2026-11-25, migration `database/assault-eligibility.sql`)

**Goal:** players who aren't in an assault guild can see how their characters measure up against each assault guild's rubric and what to do to qualify. It's the same goal language as the roster (Bronze = minimum … Dream).

**Who / where**
- `/assault/eligibility`, logged in. Phase 1: your own claimed characters that aren't on an assault roster (Dream guilds that don't assault, plus alts outside Dream that are claimed on the account).
- Phase 2 (staff): an IGN lookup for recruits, linked from Admin → Recruiting (prospect row → "Check eligibility"). It uses the shared API key and the same cooldowns as the recruit rechecks.

**Data**
- Snapshot on demand with the same code as `assault-roster-sync` (pets, skills, stats, effects, equipped pet). The snapshot goes into a new table `assault_eligibility_snapshots` (hashed_id PK, member_id, snapshot fields, last_sync, last_error), so the rosters stay clean. It refreshes when older than 6 h, with a manual refresh (2 min cooldown, like /combat).
- Gear from their own /combat profile, potions = own default loadout or Mid (same fallback as the roster), hunting bow from members.hunting_bow.
- Rows are built with the roster's row builder (refactor: pull the per-row part of `buildRoster` into `buildRosterRow(snapshot, ctx)` so both pages use exactly the same maths).

**Rubric**
- Per assault guild (DE, DI): that guild's `assault_roster_goals` at that guild's tracked assault zone. The page shows one column per guild: meets the minimum ✓/✗, tier per element, the elements below Bronze, and the next best moves (`computeMoves` with that guild's goals and prices).
- Prerequisites as on the roster (gear on /combat, pets visible). The potions reminder is soft.
- Explain the tiers once at the top (the same TIER_MEANING copy) and label Citadel estimates as such.

**Join path**
- Meeting a guild's minimum shows "Interested in joining <guild>?" → creates or updates a Recruiting prospect (shared list) with the character, guild and a snapshot of their tiers, and posts a short note to that guild's staff/recruiting channel in Discord. The guild move itself happens in game. Characters below the minimum see "Closest guild" + the top 3 moves.

**Discord**
- `/eligibility [ign]` (hub command, ephemeral): the same per-guild verdict + next move for the caller's characters (or an IGN for staff).

**Build steps**
1. Refactor `buildRosterRow` out of `buildRoster` (no behaviour change, smoke-check DE/DI rows are identical).
2. `assault_eligibility_snapshots` migration + snapshot service + `/api/assault/eligibility` (GET own characters, POST refresh).
3. `/assault/eligibility` page (per-guild columns, drawer reusing GoalsSection / MovesList).
4. Join interest → Recruiting prospect + Discord staff note.
5. `/eligibility` Discord command; Phase 2 staff IGN lookup.

**User decisions (2026-11-25)**
1. Characters already in an assault guild (incl. not assaulting) stay on their roster only. The roster's not-assaulting section gets the same principles as this page: meets the minimum ✓/✗, the elements below Bronze, top 3 moves, then the join prompt.
2. Phase 1 audience = every claimed character that isn't on an assault roster, inside or outside Dream.
3. "Interested in joining" posts to leadership-chat (one shared channel, guild named in the note), no ping. It also creates/updates the Recruiting prospect.
4. Staff get a full scouting list: every measured character outside the assault guilds that meets a guild's minimum, interested ones first.

Step 1 built 2026-11-25: `loadRowCatalog` (catalogs, presets, trusted prices, zones) + `loadRowMembers` (members, /combat profiles, owners, loadouts, Discord) + `zoneSlice` (goals at a zone) + `buildRosterRow(snapshot, ctx)` (row + moves) in `src/lib/assault-roster.ts`. Check: `npx tsx --env-file=.env.local scripts/dump-roster.ts` before/after, DE 22 + DI 18 rows byte-identical.

Steps 2–5 built 2026-11-25:
- `src/lib/assault-eligibility.ts`: targets (own claimed characters not on a roster; all approved claims for the cron), `syncEligibility` (same fetch as the roster sync → `assault_eligibility_snapshots`), `loadRubrics` (each assault guild's goals at its tracked zone), `measureSnapshots` (rows via `buildRosterRow`, verdicts stored on the snapshot), `closestGuild`, `expressInterest`, `scoutingList`, `syncAllEligibility`, `staffLookup`.
- API `/api/assault/eligibility`: GET (own characters; stale > 6 h refresh inside a 45 s budget, client re-asks while `sync.remaining` > 0), POST `{hashed_id}` refresh (2 min cooldown), `{action:'bow'}` hunting bow (members.hunting_bow), `{action:'interest', guild_id}` (must meet that guild's minimum).
- Page `/assault/eligibility` (Assault menu → Live): tier legend + Citadel note, one card per character, one column per guild (tier chips, `EligibilityVerdict`: ✓/✗, setup, goals to Bronze, top 3 moves), "Closest guild" when none meet, "Interested in joining <guild>?" when one does, drawer with guild tabs, hunting bow and `GoalsSection` (weigh views).
- Roster's not-assaulting section (decision 1): your own characters below the minimum get the same `EligibilityVerdict` block; the table has a Next move column.
- Join interest: `recruit_prospects.status = 'interested'` + `interest_*` columns; join detection for interested players = showing up in the guild they asked for (they may already be in a Dream guild). Note to leadership-chat, no ping (`allowed_mentions` empty), once per player and guild, no site link.
- Scouting (decision 4): Admin → Recruiting → "Scouting" card, `/api/admin/recruit/scout` (deputy+), from stored verdicts. The daily `assault-roster` cron spends leftover budget on eligibility snapshots (20 h) and re-measures changed ones.
- Discord `/eligibility [ign]` (`src/lib/eligibility-discord.ts`, deferred, ephemeral): your characters (up to 3, highest CL first) with "Interested in joining" buttons (`elig:<hashed>:<guild>`, owner only); `ign:` = yours, or for deputy+ a staff lookup. Run `?action=register-hub` once after deploy.
- Phase 2 gap: the IdleMMO API has no name search, so the staff lookup only works for characters in our `members` table (Dream members, alts, former members). Recruits seen only via Nearby can't be read yet.
- Checks: `scripts/dump-roster.ts` (roster output before/after) and `scripts/check-eligibility-rows.ts` (eligibility path = roster rows, 40/40 identical on 2026-11-25).

**Checklist redesign (2026-11-25, user feedback):** one clear page with the minimum, not per-guild columns.
- Only guilds that are assaulting count: `loadRubrics` keeps guilds with `assault_configs.active` (now DE; DI paused). A paused guild drops out of the page, Discord, interest and scouting, and comes back when switched on. If none is active, all are used. The per-guild architecture (rubrics, stored verdicts per guild) is unchanged; guild tabs show only when 2+ are active.
- Page = character pills (✓ when at the minimum) → `MinimumChecklist` (`RosterGoals.tsx`): progress "x of y done", Set up (gear saved, pets visible), At the minimum (each non-bonus element with its Bronze requirement, current value, best next move, weigh options), Doesn't block (potion loadout reminder, slayer bonus) → "I'm interested in joining" once reached → collapsed "Beyond the minimum" (`GoalsSection`).
- Gear: characters outside Dream can't open /combat (combat profile needs a Dream guild), so the gear row has the owner's own editor (`GearSection` with `onSave`) → POST `{action:'gear'}` → same `combat_profiles` row the roster reads. Validation/write shared with the leader editor in `src/lib/combat/gear-save.ts`.
- Discord `/eligibility` embed uses the same checklist lines (✅ / ⬜ / ⏳).
- Nav: Eligibility sits under Assault → Prep. Gear can be saved with nothing equipped: `writeProfileGear` sets `combat_profiles.settings.noGear`, and `buildRosterRow` counts that as gear set (battle measured bare). Empty gear without the flag still means "not picked yet". Works from the leader editor too (when a profile exists).
- Access (2026-11-25): Assault menu shows to every signed-in user. Rankings + Eligibility for all; Live (hub, conquest, stats, roster) + Locations for Dream members; My assault, Guide, Checklist, Potions only with a character in an assault guild (nav only, pages themselves unchanged). Account menu gets "Assault eligibility" for users with no character in a Dream guild. Signed-out landing page: "Could you join the assaults?" + assault leaderboard + hall of fame in the Pools & assaults card.
- Signed-out eligibility: `/assault/eligibility` asks for a character id (or profile link; `?id=` shareable, last id remembered in the browser) → `POST /api/assault/eligibility/public` → `publicEligibility`: shared key, reused 30 min, max 4 fresh game reads/minute across all snapshots, `measureSnapshots(..., override)` ignores everything stored about the character (gear, bow, owner loadout) and uses the visitor's browser picks; verdicts not stored, so public lookups never reach scouting. Join prompt = create account / sign in. Gear catalog GET is public now.
- Later (smaller): the same id lookup in "Find your guild" on the landing page; staff `/eligibility` could accept an id too (closes the Phase 2 gap for recruits not in `members`).
- Page gates (2026-11-25): `src/lib/use-access.ts` (`useAccess`: signedIn / member = a Dream guild, not the awaiting-assignment guest view / assaulter = DE or DI; `assaultPageLevel`) drives both the nav and `AccessGate` (`src/app/assault/layout.tsx`, `src/app/me/assault/layout.tsx`). Public: leaderboard, hall of fame, eligibility. Assaulter: guide, checklist, potions, My assault. Everything else under /assault: Dream members. Blocked visitors get a prompt (`ClaimPrompt`: create account / sign in / claim, `/claim` in Discord = instant) plus the eligibility link. Client-side only: the APIs behind these pages keep their own (mostly open) checks.
- Hub: Roster replaced Locations in the guild card buttons; Roster added to the tools grid; prep tools only for assaulters, Eligibility for everyone else.
- Potions are not part of eligibility (they come after joining): `measureSnapshots` always uses the default preset, potion moves are left out of verdicts, the checklist and "Beyond the minimum".
- Bow moves everywhere (roster, eligibility, Discord): "Equip a hunting bow (+N% or more)", detail "Have one? Pick it… Don't have one? Buy X", cost marked "if you buy one".
- Signed-out lookup asks for the **hashed ID** (shown in game once "Show hashed ID" is on in the settings), with a big claim prompt above it.
- Server-side gates (2026-11-25): `src/lib/access-server.ts` `requireAccess(req, 'member' | 'assaulter')` on `/api/assault/{public, standings, stats, waves, conquest, locations}` (member) and `{plan, plan/zones, potions/catalog}` (assaulter); the server-rendered `/assault/potions` page checks too. Leaderboard, hall of fame and the public eligibility lookup stay open. Landing page: only assault leaderboard + hall of fame (no eligibility link); signed-out visitors aren't offered eligibility in the access prompt either.
- Recruiter quick check (Admin → Recruiting, deputy+): `POST /api/admin/recruit/check {hashed_id, bow?}` → `recruiterCheck`: plans the cheapest tier-1 gear set that gets Battle to Bronze (`ctx.planMinGear` → `battle.minGear` in `buildRosterRow`: greedy on "hits over 4" removed per gold, then prune; roster output unchanged), then measures the checklist with that set on. Bow pickable. Same read limits as the public lookup. Unreachable = tier-1 gear isn't enough (needs tiers, levels or a pet).
