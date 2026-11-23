# Achievements catalogue (Phase 2, step 9)

Covers D1/D2 (achievements + badges), D3 (#hall-of-fame feed), D5 (titles). Dream Pass XP (D6) reuses the
`xp` column. Everything below is computed from data we already have; no new game API calls.

## Tiers

| Tier | Badge colour | Dream Pass XP |
|------|--------------|---------------|
| Bronze | copper | 10 |
| Silver | silver | 25 |
| Gold | gold | 50 |
| Crystal | crystal blue (Dream accent) | 100 |
| Dream | animated crystal, title unlock | 200 |

Thresholds are calibrated on live data (2026-11-23, ~200 days of `daily_logs`, 314 characters):
bronze ≈ half of active members, silver ≈ top 25 %, gold ≈ top 10 %, crystal ≈ top 1–2 %, Dream = beyond today's max
(something to chase). Percentiles in brackets.

## Catalogue (68)

### Contribution — gold donated + deposited, lifetime
| Key | Name | Threshold | Tier |
|---|---|---|---|
| gold-1 | Coin Purse | 100k | Bronze (≈p45) |
| gold-2 | Treasury Friend | 500k | Silver (≈p73) |
| gold-3 | Vault Keeper | 1.25M | Gold (p90) |
| gold-4 | Golden Pillar | 3.5M | Crystal (p99) |
| gold-5 | Dream Benefactor | 7.5M | Dream |

### Raids — raid participations, lifetime
| raids-1 | First Raid | 1 | Bronze |
| raids-2 | Raider | 50 | Bronze |
| raids-3 | Raid Regular | 150 | Silver (p90) |
| raids-4 | Raid Veteran | 300 | Gold (p98) |
| raids-5 | Raid Legend | 500 | Dream |

### Reliability — days the requirement was met (bank cover counts)
| met-1 | Showing Up | 7 | Bronze |
| met-2 | Dependable | 30 | Bronze |
| met-3 | Reliable | 90 | Silver |
| met-4 | Rock Solid | 180 | Gold |
| met-5 | Unshakeable | 365 | Dream |

### Streak — best run of consecutive met days (holidays via `/away` pause, don't break)
| streak-1 | On a Roll | 7 | Bronze (p60) |
| streak-2 | Two Weeks Strong | 14 | Silver (p77) |
| streak-3 | Monthly Machine | 30 | Gold (p92) |
| streak-4 | Unbroken | 60 | Crystal (p98) |
| streak-5 | Eternal Flame | 100 | Dream |

### Guild challenges — items contributed
Counted **per item**: each item a person contributes to a guild challenge counts once per challenge day
(guild + game day + item), however many separate donations it took. Many small donations never beat one big one.
| chal-1 | Helping Hand | 10 | Bronze |
| chal-2 | Gatherer | 50 | Bronze |
| chal-3 | Supplier | 150 | Silver (p85) |
| chal-4 | Quartermaster | 300 | Gold (p97) |
| chal-5 | Challenge Crusher | 500 | Dream |

### Stockpile + Energizing Pools
| stock-1 | Stockpiler | 1 stockpile deposit | Bronze |
| stock-2 | Hoarder | 25 | Silver |
| stock-3 | Warehouse | 100 | Gold |
| pool-1 | Spark | 1 Energizing Pool activation | Bronze |
| pool-2 | Pool Keeper | 10 | Silver |
| pool-3 | Power Plant | 50 | Gold |

### Assault
| asl-1 | Into the Fray | any EXP in an assault season | Bronze |
| asl-2 | Assault Trooper | 25k season EXP | Silver (≈p55) |
| asl-3 | Shock Trooper | 100k season EXP | Gold (≈p80) |
| asl-4 | Siege Breaker | 250k season EXP | Crystal (p99) |
| asl-5 | Conqueror | 400k season EXP | Dream |
| asl-seasons-1 | Campaigner | 3 seasons played | Silver |
| asl-seasons-2 | War Veteran | 10 seasons played | Gold |
| asl-top10 | Spearhead | top 10 of your guild in a season | Gold |
| asl-top1 | Warlord | #1 of your guild in a season | Crystal |

### Loyalty — days in the Dream network (first seen in any Dream guild)
| loyal-1 | New Dreamer | 7 | Bronze |
| loyal-2 | Settled In | 30 | Bronze |
| loyal-3 | Old Hand | 90 | Silver |
| loyal-4 | Pillar of Dream | 180 | Gold |
| loyal-5 | Dream Elder | 365 | Dream |

### Level
| cl-1 | Combat Ready | CL 40 | Bronze |
| cl-2 | Seasoned Fighter | CL 60 | Bronze |
| cl-3 | Elite | CL 80 | Silver |
| cl-4 | Summit | CL 92 | Gold |
| cl-5 | Max Combat | CL 100 | Crystal |
| tl-1 | Well Rounded | total 500 | Bronze |
| tl-2 | Jack of All Trades | total 1,000 | Silver |
| tl-3 | Master of Many | total 1,500 | Gold |
| tl-4 | Grandmaster | total 2,000 | Crystal |

### Community
| bump-1 | Bumper | 1 bump | Bronze |
| bump-2 | Hype Crew | 10 | Silver |
| bump-3 | Megaphone | 25 | Gold |
| bump-4 | Town Crier | 50 | Crystal |
| linked | Connected | linked Discord via `/claim` | Bronze |
| claimed | That's Me | approved account claim | Bronze |

### Journey
| move-up | Climbing | moved to a higher CL tier guild | Silver |
| top-tier | Summit Guild | member of a CL 92 guild | Gold |
| assaulter | Enlisted | joined DE or DI | Bronze |
| invader | Hardcore | joined DI | Gold |
| tourist | Network Tour | been in 3 different Dream guilds | Silver |

### Hidden (shown as ??? until unlocked)
| founder | Founding Dreamer | in the data before 2026-06-01 | Gold |
| top-donor-week | Carry | top donor of your guild in a week | Silver |
| lb-week-1 | Number One | #1 on the weekly network leaderboard | Crystal |
| comeback | Back in Action | met the requirement again after a finished `/away` | Bronze |

## Titles (D5)
Every Gold, Crystal and Dream achievement unlocks its name as a title (e.g. "Vault Keeper", "Warlord").
Pick one in `/me`; it shows in the nav identity, `/me` hero, `/me` Discord command and hall-of-fame posts.

## Implementation (built 2026-11-23)
- Catalogue: `src/lib/achievements.ts` (code is the source of truth, no catalogue table).
- Migration `database/achievements.sql`: `achievement_unlocks` (member_id, achievement_key, unlocked_at,
  recorded_at, backfilled, announced_at), written for **every character of the account** so regrouping alts never
  loses an unlock (new alts get copies, never re-announced); `user_titles` (user_id → achievement_key).
- Evaluator `src/lib/achievement-eval.ts`: bulk metrics per account with crossing dates (backfill keeps the real
  unlock date). Cron `POST /api/cron/achievements` (`{ "dry_run": true }` previews), step in the daily-activity
  workflow after the live messages. First run = silent backfill (`app_settings.achievements_backfilled_at`).
- Feed `src/lib/achievement-discord.ts`: live key `hall-of-fame` (new mode **append**: new post each day, old ones
  kept). Bind it in Admin → Discord → Live messages. The launch post goes out on the first run after binding
  (`achievements_launch_posted_at`); unbound/paused = pending unlocks are marked announced, no backlog.
- `/me`: Achievements card (count, Dream XP, title picker, next up, full catalogue). API `/api/me/achievements`
  (GET, PUT title). Discord `/me`: achievements field + title in the embed title.
- Weekly winners (Carry, Number One) only count completed ISO weeks; assault Spearhead/Warlord only finished
  seasons (the newest season number is treated as running).
- Known gap: CL achievements need `members.combat_level`, which is only filled when someone opens /me (11 of
  314 characters on 2026-11-23). Fill it in the member sync to unlock them for everyone.

## Decisions (user, 2026-11-23)
- **Unit = account** (main + alts via the full `member_alts` closure, no claim needed). Sums are pooled across
  characters (gold, raids, challenge items, bumps); levels use the best character; streaks/met days are counted on
  the pooled account day (any character met = day met), same as `/me`.
- **Launch:** backfill silently, then one "Achievements are live" post with the rarest unlocks.
- **Feed:** one #hall-of-fame digest per day after the 11:48 UTC check, Silver and up, grouped by person.
  Bronze stays on the site.
- Catalogue approved; challenges counted per item (above).
