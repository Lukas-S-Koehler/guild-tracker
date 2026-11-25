# Assault Roster: spec (draft v3, 2026-11-25)

Goal: make DE and DI feel like one unit. One place shows what every assaulter is running for **battle** and **hunting**, where each person stands on shared goals, and the cheapest next upgrade that gets them to the next goal.

Status: **spec agreed 2026-11-25.** Step 1 (static data + hunting formulas) built: `src/lib/combat/pet-hunting.ts`, `src/lib/combat/hunting-gear.ts`, check `npx tsx scripts/check-pet-hunting.ts`. Step 2 (snapshots) built: `database/assault-roster.sql`, `src/lib/assault-roster-sync.ts`, `/api/cron/assault-roster` (+ `.github/workflows/assault-roster.yml`, 03:30 UTC, loops while `remaining` > 0), `/api/assault/roster/refresh` (owner or officer+ for one character, officer+ for a guild). Uses the owner key when the account is claimed, else super admin key; keys allow ~20 req/min (3 per character). Also fills `members.combat_level`.

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

## 5. Goal tracks (same defaults for DE and DI; leaders can edit per guild)

Tiers: **Bronze → Silver → Gold → Crystal**. Thresholds live in a new `assault_roster_goals` table (`guild_id`, track, tier, threshold). They are editable in Admin → Assault, and editing is limited to guild leaders and the super admin.

| Track | Bronze | Silver | Gold | Crystal |
|---|---|---|---|---|
| Battle: hits-to-kill on zone mobs | 5 | 4 | 3 | 2 |
| Hunting bow eff % | any bow (5%) | 10% (Nightshade) | 15% (Grimwood) | 18%+ (Mythic) |
| Squad hunt power (Citadel est. encounters/hunt, whole squad) | 250 | 600 | 1,200 | 2,000 |
| Pet mastery (squad size) | 25 (4 pets) | 50 (6) | 75 (8) | 100 (10) |

Hunting level is shown on the Lineup but is not a goal track. Higher is better, but pets carry most of the hunting for high-level battlers (user).
| Prep (potion loadout set, gear set, RSVP'd ≥75% of last 8 waves) | 1/3 | 2/3 | 3/3 | 3/3 + 8-wave streak |

Unlocking a tier can feed the Dream Pass and achievements later (not in v1). The roster board shows recent tier-ups.

## 6. Upgrade priority ("Next best moves")

For each member, the top 3 moves that reach their **next tier** on any track, cheapest first:

1. **Free moves first:** set gear or loadout, level an owned hunting pet past a threshold, equip a better bow they already listed, RSVP.
2. **Bow:** the cheapest bow with required level ≤ theirs that reaches the next bow tier. Shown as price and +eff %.
3. **Hunting squad:** the cheapest egg that replaces the weakest squad pet and lifts squad hunt power to the next tier. The estimate assumes the new pet at Lv 100 and is labelled so. Also shows "levelling your X to L gets there for free" when that applies.
4. **Battle gear:** search single swaps from `gear_items` (CL ≤ theirs), then pairs, using the `/combat` formulas. Picks the cheapest set that drops hits-to-kill by one on the zone mob.
5. Ranking = cheapest move that crosses a tier. Ties go to the track furthest behind.

Each move shows the cost, what it unlocks ("→ Gold bow") and a link (market item or `/combat` sandbox prefilled).

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

Resolved 2026-11-25: evolution boosts hunting agility/MS like combat (+5%/stage, user); squad hunt power tiers 250 / 600 / 1,200 / 2,000 approved; bow requirements = combat level + dexterity; pat doesn't boost MS; pet mastery does; squad size = 2 + floor(mastery / 12.5); eggs are priced from market history and Mythic eggs ≈20M (no market); agility cap 120 in Citadel (fitted); hunting level is not a goal track. Splash and Lumo were added to `PET_STATS`.
