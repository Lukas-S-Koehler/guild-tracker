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
Ranking: missing minimum (+100) first, then importance weight × cost factor (log scale) × progress. Prices = `market_cache` (weighted median of recent sales); the daily price cron now also tracks hunting bows, pet eggs and every gear item. Mythic eggs use the fixed ≈20M estimate.

UI: red **Setup & eligibility** block (prerequisites + below-minimum elements, with Fix links) at the top of the roster for your own characters and in the drawer; "Next best moves" list in the drawer; Goals table shows each member's top move with cost.

## 7. Cohesion extras (v1)

- **Wave RSVP:** new table `assault_rsvps` (`guild_id`, wave start, `member_id`, status in/out/maybe). Set on the web, with buttons on the existing wave announcement in Discord. The Lineup shows it, and staff see who hasn't answered.
- **Discord live roster board** (live key `assault-roster:<guild>`, edit in place): ready count, RSVPs for the next wave, team goal progress, last 7 days of tier-ups. It links the channel, not the site, unless needed.
- **Discord `/roster [ign]`:** no argument = guild summary. With an IGN = setup card (battle line, hunting line, goal tiers, next best move).

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
