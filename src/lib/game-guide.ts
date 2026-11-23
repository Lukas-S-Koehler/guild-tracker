// IdleMMO general guide content.
// Single source of truth for the /guide web page AND the Discord copy output.
// Inline formatting: **bold**, *italic*, [label](url). Keep it Discord-compatible.

export type GuideBlock =
  | { type: 'p'; text: string }
  | { type: 'sub'; text: string }
  | { type: 'list'; items: string[]; ordered?: boolean }
  | { type: 'callout'; tone: 'tip' | 'warn' | 'info'; title?: string; text: string }
  | { type: 'table'; head: string[]; rows: string[][] }
  | { type: 'links'; links: { label: string; url: string; note?: string }[] };

export interface GuideSection {
  id: string;
  emoji: string;
  title: string;
  blurb: string;
  blocks: GuideBlock[];
}

export const PET_SHEET_URL =
  'https://docs.google.com/spreadsheets/d/1sceVGy4VlSJ1jVA2E5BOJGHkTJtRJSSjTZqtkkYBHRU/edit?gid=1508925425#gid=1508925425';
export const DUNGEON_TRACKER_URL = 'https://dungeon-tracker-seven.vercel.app/profile';
export const GUIDE_SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://guild-tracker-9ys7.vercel.app').replace(/\/$/, '');
export const ZENITH_URL = 'https://zenith-companion.vercel.app/';
export const POTIONS_URL = 'https://www.iddlemmotools.com/categories?category=consumables&label=Potions+%26+Food';
export const ESSENCES_URL = 'https://www.iddlemmotools.com/categories?category=essence_crystals&label=Essence+Crystals';
export const IDLEMMO_TOOLS_URL = 'https://www.iddlemmotools.com/';
export const COMBAT_CALC_PATH = '/tools/combat-calculator.html';

export const GUIDE_SECTIONS: GuideSection[] = [
  {
    id: 'start',
    emoji: '🧭',
    title: 'Start Here — Day 1 Priorities',
    blurb: 'What to set up on a fresh account before anything else.',
    blocks: [
      {
        type: 'list',
        ordered: true,
        items: [
          '**Membership Scroll** — top priority. Longer idle time (8h), tax savings, faster power-hunt cooldown and more. Perks are listed in the in-game menu.',
          '**3 active characters** — 1 main (combat) + 2 skilling alts. Every day without your 2nd alt costs you **~50k gold**.',
          '**Start levelling pets** — cheap white pets on day 1, pet mastery runs in the background while you skill.',
          '**Skill your main first** — mine coal for 24–48h. Sells instantly for starter gold and gives free **STR / DEF** exp.',
          '**Alts make gold** — most common route: **Fishing + Cooking**. Slow start, most consistent gold maker at max. Cooked food also feeds your combat later.',
          '**Tools for alts** — Premium grade (25% efficiency) is the best gold-per-% value.',
        ],
      },
      {
        type: 'callout',
        tone: 'warn',
        title: 'Banished & Cursed characters',
        text: 'A different way of playing — **no market and no trading**. Pick a normal character unless you want that challenge.',
      },
    ],
  },
  {
    id: 'roadmap',
    emoji: '🗺️',
    title: 'Roadmap & Goals',
    blurb: 'Typical milestones to aim for. Use them as a checklist, not a race.',
    blocks: [
      { type: 'sub', text: 'Day 1–2' },
      {
        type: 'list',
        items: [
          'Main + alt mining coal → sell for starter gold',
          'Buy 1 of each white (Standard) pet, start pet mastery',
          'Join **Dream Angels** (CL 1–40) and do every **guild raid**',
          'Save toward the **Membership Scroll**',
        ],
      },
      { type: 'sub', text: 'Week 1–2' },
      {
        type: 'list',
        items: [
          'Alts on Fishing + Cooking with **Premium tools**',
          'Unlock extra alts with **Museum tokens** (see Characters & Alts)',
          'Main: gear from market, food + pet ready → start combat',
          'Pet mastery climbing, 7–8 pets working at once',
        ],
      },
      { type: 'sub', text: 'Month 1' },
      {
        type: 'list',
        items: [
          'Extra alt slot unlocked at **Combat Lv 45**',
          'Membership Scroll bought (or close)',
          'First **World Bosses** tried',
          '**Refined pets** on your main once scroll + tools are sorted',
        ],
      },
      { type: 'sub', text: 'Months 2–3' },
      {
        type: 'list',
        items: [
          '**20 green (Premium) pets** for hunting/battling — Wrex & Zephyrix',
          'Main equipped pet upgraded to **Epic** (Pyroflare or Aerion)',
          'Combat Lv 95 → all World Bosses unlocked',
          'Find a **League** partner for Red Shards',
          'Optional: start a **dungeon** setup (long-term, highest profit)',
        ],
      },
    ],
  },
  {
    id: 'alts',
    emoji: '👥',
    title: 'Characters & Alts',
    blurb: 'More characters = more gold. Unlock them early.',
    blocks: [
      {
        type: 'p',
        text: '**Combat Lv 45** unlocks 1 extra alt. Every other slot comes from **Museum tokens** — aggressive players have all 5 alts in ~2 weeks. Fast token sources:',
      },
      {
        type: 'list',
        items: [
          '**Pet Collection** — buy 10 pet types from market → 300 tokens',
          '**Collectibles** milestone 1 → 100 tokens (trade collectibles from alts to your main)',
          '**Bestiary** milestone 1 → 100 tokens',
          'Complete **Campaign** missions',
          'Collect the **daily reward**',
        ],
      },
      { type: 'sub', text: 'What alts should do' },
      {
        type: 'list',
        items: [
          '**Skill for gold** — Fishing + Cooking is the standard route',
          '**Level pets** — each alt can run its own pet squad',
          '**Guild raids** — easiest way to get combat levels on alts',
          '**World Bosses** — send 3/5 alts for free shots at pets & drops',
        ],
      },
      {
        type: 'callout',
        tone: 'tip',
        title: 'Don\'t hunt on non-combat alts',
        text: 'Hunted mobs flee if nobody fights them, and pet hunts don\'t drop items. Wasted time.',
      },
    ],
  },
  {
    id: 'gold',
    emoji: '💰',
    title: 'Making Gold',
    blurb: 'Where your gold actually comes from.',
    blocks: [
      { type: 'sub', text: '🎣 Skilling (Fishing + Cooking)' },
      {
        type: 'p',
        text: 'Slow start, but the most consistent gold maker at max. Fish on one alt, cook on another — sell food or feed your main.',
      },
      {
        type: 'callout',
        tone: 'tip',
        title: 'Vendor during Shrine T3',
        text: 'Where possible, only sell to vendors while **Shrine Tier 3** is active — +15% Bartering exp for free.',
      },
      { type: 'sub', text: '⚒️ Other skills' },
      {
        type: 'list',
        items: [
          '**Smelting** — consistent, solid second choice',
          '**Construction** — decent',
          '**Alchemy** — more volatile, prices swing',
        ],
      },
      { type: 'sub', text: '🛠️ Tools' },
      {
        type: 'list',
        items: [
          '**Premium grade** — 25% efficiency, cheapest per %. Get these first.',
          'Higher grades — much pricier for a few extra %. Worth it for **Leagues** and long-term sustain, not early.',
        ],
      },
      { type: 'sub', text: '🏰 Dungeons' },
      {
        type: 'p',
        text: `Can be the **most profitable skill**, but takes ages to set up. Interested? **Ask Lukas** to help plan your account. Track progress: [Dungeon Tracker](${DUNGEON_TRACKER_URL})`,
      },
      { type: 'sub', text: '🏘️ Villages' },
      { type: 'p', text: '~3k gold/day per character at full setup. Passive, low priority — see Villages section.' },
      { type: 'sub', text: '🏆 Leagues' },
      {
        type: 'p',
        text: 'Long-term partners bring **Red Shards** → big gold checks (buy DSS) or potions/skins.',
      },
    ],
  },
  {
    id: 'pets',
    emoji: '🐾',
    title: 'Pets',
    blurb: 'Hands down the best upgrade for your characters and account.',
    blocks: [
      {
        type: 'list',
        items: [
          '**Equipped pet** → big flat stats on your main',
          '**Pet squads** → hunt mobs for you (70%+ of what you fight). Pet hunts give **no loot**, but they save you hours of hunting',
          '**Pet mastery** → more pets out at once',
        ],
      },
      {
        type: 'table',
        head: ['Pet Mastery', 'Battle', 'Hunt'],
        rows: [
          ['Lv 1', '2 pets', '—'],
          ['Lv 100', '10 pets', '10 pets'],
        ],
      },
      { type: 'sub', text: 'Pet grades & best picks' },
      {
        type: 'table',
        head: ['Grade', 'Power', 'Best hunter', 'Best fighter'],
        rows: [
          ['Standard', '30', 'Whiskers', 'any'],
          ['Refined', '70', 'Shadowscale', 'Aquarion'],
          ['Premium', '100', 'Wrex', 'Fangor'],
          ['Event', '110', '—', '—'],
          ['Epic', '130', 'Vulpina', 'Solarix'],
          ['Legendary', '150', 'Scalethorn', 'Scalethorn'],
          ['Mythic', '200', 'all ~equal', 'all ~equal'],
        ],
      },
      {
        type: 'p',
        text: 'Eggs mostly come from **World Bosses**. Two Mythics are also sold at the **Celestial Exchange** merchant.',
      },
      {
        type: 'callout',
        tone: 'tip',
        title: '2 Premium = 1 Mythic',
        text: 'For hunting/pet battles a full stack of 20 Premium pets beats a single Legendary.',
      },
      { type: 'sub', text: 'Getting started' },
      {
        type: 'list',
        ordered: true,
        items: [
          'Buy 1 of each **Standard (white)** pet (~1,200–1,300 gold each) and hatch them.',
          'Go to **Bluebell Hollow**, send them to battle.',
          'When back → send to **sleep**, wait ~30s, cancel sleep.',
          'Send them to hunt → sleep again on return. Repeat.',
          'At pet Lv 8 move to **Whispering Woods** and repeat.',
        ],
      },
      {
        type: 'list',
        items: [
          'Low on food? Pets regain health by **sleeping** — battle, then sleep.',
          'Use a non-working alt to teleport around and train pets for others.',
          'Each alt: **13–14 pets** for fast mastery, keep 1 slot free for trades. PM 50 in 2–3 days.',
          'Buy an extra **pet slot (250 tokens)** on your pet-trainer alt. Beastmaster class not required.',
        ],
      },
      { type: 'sub', text: 'Upgrade path' },
      {
        type: 'list',
        items: [
          '**Refined pets** on your main — great value once Membership + tools are done',
          '**Goal: 20 Premium pets** — Wrex & Zephyrix (best price/performance)',
          '**Main equipped pet → Epic:** Pyroflare (budget: Attack + Speed) or Aerion (same + more extra stats)',
        ],
      },
      { type: 'links', links: [{ label: 'The great big pet sheet', url: PET_SHEET_URL }] },
    ],
  },
  {
    id: 'raids',
    emoji: '🛡️',
    title: 'Guild Raids',
    blurb: 'Combat exp, guild mastery exp and gold — zero effort.',
    blocks: [
      {
        type: 'p',
        text: 'Most guilds run **2 raids a day**. Make both. Early levels fly by, later levels stay cheap. **CL 1 → 25 in 6 raids (3 days)**, CL 60 in about a month of only raids.',
      },
      {
        type: 'table',
        head: ['Raid Lv', 'Exp', 'Raids to next'],
        rows: [
          ['1', '2,000', '6'],
          ['25', '5,000', '9'],
          ['40', '9,000', '34'],
          ['60', '15,000', '38'],
          ['70', '23,000', '65'],
          ['80', '30,000', '173'],
          ['92', '35,000', '—'],
        ],
      },
      {
        type: 'callout',
        tone: 'tip',
        title: 'Best way to level alts',
        text: '**Dream has a guild for every raid category** (see Dream Guilds) — put alts in raid guilds to get combat levels without spending food. Raid times: `/raid` in Discord.',
      },
    ],
  },
  {
    id: 'world-bosses',
    emoji: '👾',
    title: 'World Bosses',
    blurb: 'Group fights for combat exp, upgrade stones and pet eggs — all game long.',
    blocks: [
      {
        type: 'list',
        items: [
          'The **main source of pet eggs**. Every boss also drops Chests of Upgrade Stones (~50–70%).',
          'Join the queue up to **2h before** the fight. Queue closes when it starts.',
          'Respawn after a win: 8h (Lv 1) up to 18h (Lv 90+).',
          'Heavy RNG — bad streaks happen. Stay consistent and the drops come (collection pieces or market gold).',
          'Send **3/5 alts** too for extra egg rolls.',
        ],
      },
      {
        type: 'table',
        head: ['Boss', 'Lv', 'EXP', 'Egg tiers'],
        rows: [
          ['Isadora', '1', '800', 'Standard, Refined'],
          ['Malgazar', '10', '1,080', 'Standard, Refined'],
          ['Obsidianus', '20', '1,200', 'Standard, Refined'],
          ['Shadowmire', '30', '1,500', 'Standard, Refined'],
          ['Rogoth', '40', '2,043', 'Refined'],
          ['Petrok', '50', '2,889', 'Premium (Wrex), Epic'],
          ['Lurka', '60', '3,360', 'Refined → Epic'],
          ['Nethrax', '70', '3,818', 'Premium → Legendary'],
          ['Skarn', '80', '4,267', 'Premium (Zephyrix) → Legendary'],
          ['Voragor', '90', '6,923', 'Epic (Aerion) → Mythic'],
          ["Thal'guth", '95', '12,000', 'Epic → Mythic + Dragon Soulstone'],
        ],
      },
      {
        type: 'callout',
        tone: 'tip',
        title: 'Where to farm',
        text: '**Skarn (Lv 80)** is the go-to for Premium Zephyrix & Vexalia (6.5% each). **Petrok (Lv 50)** for Wrex. All bosses unlocked at **Combat Lv 95**.',
      },
    ],
  },
  {
    id: 'combat',
    emoji: '⚔️',
    title: 'Combat',
    blurb: 'Don\'t dive in right away — build a foundation first.',
    blocks: [
      { type: 'sub', text: 'Before you fight' },
      {
        type: 'list',
        items: [
          '🥊 **Core stats** — STR, DEF, DEX, SPEED (mining gives STR/DEF)',
          '🐾 **Equipped pet** — extra flat stats',
          '🏹 **Pet squad** — tracks mobs for you',
          '🧪 **Consumables** — cooked food + battle potions',
        ],
      },
      { type: 'sub', text: 'Stat balance' },
      {
        type: 'p',
        text: 'Keep **STR** a bit ahead, **DEX/DEF** in the middle, **SPEED** behind. Example: STR 40 · DEX 30 · DEF 30 · SPEED 20.',
      },
      { type: 'sub', text: 'Gear' },
      {
        type: 'list',
        items: [
          'Don\'t craft — market gear is super cheap up to **Lv 70**',
          'Upgrade roughly every **10 levels** until 70, then ask guildies',
          'From **Lv 90**, mythic gear & upgrade stones get very expensive',
        ],
      },
      { type: 'sub', text: 'Hunting → Battling' },
      {
        type: 'list',
        items: [
          'You can only fight mobs that were **hunted** first — by you or your pet squad (pet hunts find mobs but drop no loot).',
          'Hunted mobs **flee every 4h**: 10% at Hunting Mastery 1 → 2.5% at 100. Don\'t sit on them.',
          'Hunt speed = Hunting Mastery + Movement Speed (+ weather).',
          '**Power Hunting** (Hunting Mastery 15+): 2–5 min clicking bonus mobs. Cooldown 12h (10h members). Great early for first mobs.',
        ],
      },
      { type: 'sub', text: 'Battle basics' },
      {
        type: 'list',
        items: [
          'Stack up to **6 enemies** per battle; it runs until you die, clear the stack or hit max idle time.',
          '**Food** = extra effective HP. 100 HP + 20 × 10 HP food = 300 HP. Unused food is returned.',
          '**Stance** picks which stat gets exp: Balanced (split), Offensive (STR), Defensive (DEF), Agile (SPD), Dexterous (DEX). Combat level always gets full exp.',
        ],
      },
      {
        type: 'callout',
        tone: 'tip',
        title: 'The 2–3 hit rule',
        text: 'Farm maps where you kill every mob in 2–3 hits. Rushing new maps = food costs eat your profit. Watch exp/s, profit and consumables spent.',
      },
      {
        type: 'callout',
        tone: 'info',
        title: 'Enemy scaling (Lv 80+, members, experimental)',
        text: 'Scale mobs to your level (Lv 100+: up to 150) for more exp and up to **+40% Magic Find**. Boosts loot rates, not drop chance.',
      },
      {
        type: 'links',
        links: [{ label: 'Combat Calculator', url: COMBAT_CALC_PATH, note: 'check hits-to-kill before moving maps' }],
      },
    ],
  },
  {
    id: 'boosts',
    emoji: '🌠',
    title: 'Shrine & Shooting Stars',
    blurb: 'Free community boosts. Grab them whenever they\'re up.',
    blocks: [
      { type: 'sub', text: '⛩️ Shrine' },
      {
        type: 'list',
        items: [
          'Community donates gold to unlock tiers. Activate at any Shrine location via **Nearby**.',
          'Boosts last **2h**, all 3 tiers **stack**. Resets daily **12:00 UTC** — activating at 11:55 gives you 5 min.',
          '**Daily Blessing:** donate 100+ gold → +5% Primary Skill exp for 1h.',
          'Tokens can be donated at 700 gold each (Total Lv 600+).',
        ],
      },
      {
        type: 'table',
        head: ['Boost', 'T1', 'T2', 'T3'],
        rows: [
          ['Skill exp', '10%', '15%', '20%'],
          ['Pet Mastery exp', '10%', '15%', '20%'],
          ['Combat exp', '5%', '10%', '15%'],
          ['Combat MF', '—', '5%', '10%'],
          ['Dungeon MF', '—', '5%', '10%'],
          ['Hunt speed/exp', '—', '5/5%', '10/15%'],
          ['Bartering exp', '—', '10%', '15%'],
        ],
      },
      { type: 'sub', text: '🌠 Shooting Star' },
      {
        type: 'list',
        items: [
          'Random, 0–2× a day, lasts **~30 min**. Activate it **at its location** via Nearby — the boost then works everywhere.',
          '**Get pinged:** follow the **Shooting Star Alert** in the in-game **Tavern → LFG** section. Stars are also posted in the main & Dream Discord.',
        ],
      },
      {
        type: 'table',
        head: ['Day', 'Boost'],
        rows: [
          ['Mon', 'Skill exp 20% · Skill eff 15%'],
          ['Tue', 'Combat exp 15% · Dungeon exp 15% · Hunt eff 20%'],
          ['Wed', 'Skill exp 20% · Dungeon/WB MF 10% · Hunt eff 15%'],
          ['Thu', 'Skill exp/eff 10% · Hunt mastery/eff 10%'],
          ['Fri', 'Combat/Dungeon/WB MF 15%'],
          ['Sat', 'Hunt mastery exp 30% · Hunt eff 25%'],
          ['Sun', 'Dungeon exp 25% · Skill exp 30%'],
        ],
      },
      {
        type: 'links',
        links: [{ label: 'Potions & food overview', url: POTIONS_URL, note: 'stack these on top' }],
      },
    ],
  },
  {
    id: 'buffs',
    emoji: '✨',
    title: 'Buffs & Tricks',
    blurb: 'Small mechanics that add up.',
    blocks: [
      {
        type: 'list',
        items: [
          'Shrine, Shooting Star and potions **stack**. Exception: same potion effect at a higher tier — only one active.',
          `**Essences** — not recommended if you're trying to make gold. The cheapest ones can be OK, especially in Leagues. [Essence prices](${ESSENCES_URL})`,
          '**Housing** — later-game. Not worth it until you\'re fighting in Leagues.',
        ],
      },
      {
        type: 'callout',
        tone: 'tip',
        title: 'Buff extension',
        text: 'Buffs stay active for an uninterrupted action. Activate shrines (2h), start e.g. 1h55m of mining, refresh right before they expire → buffs last the **whole 8h**. Works for a 30 min Shooting Star too.',
      },
      {
        type: 'callout',
        tone: 'warn',
        title: 'Teleport costs scale with Total Level',
        text: 'Rushing many skills early makes TP expensive. **Seasonal skills and Meditation don\'t count.**',
      },
    ],
  },
  {
    id: 'villages',
    emoji: '🏘️',
    title: 'Villages',
    blurb: 'Passive ~3k gold/day per character at full setup. Work toward it slowly.',
    blocks: [
      {
        type: 'callout',
        tone: 'info',
        text: 'Repair costs and exchange rates have changed since release — it\'s a small bonus, not a main income. Don\'t burn resources rushing it.',
      },
      {
        type: 'list',
        items: [
          'Build/upgrade **in order** — wrong order = unhappy citizens (no food) or not enough VR storage.',
          'Trade resources for **VR daily** in the Trade tab; waiting passively is very slow.',
          'Sell VR daily from one storehouse.',
        ],
      },
      {
        type: 'table',
        head: ['Stage', 'Levels', 'Focus'],
        rows: [
          ['1', '1–25', '2 Farmhouse, 2 Basic Dwelling, 2 Weak Gathering'],
          ['2', '25–50', 'Comfortable Dwellings, Small Storehouses, Simple Gathering'],
          ['3', '50–75', 'Sturdy Gathering/Dwellings, Granaries, Reinforced Storehouses'],
          ['4', '75–99', 'Advanced Gathering, Irrigated Farms, Spacious Dwellings'],
          ['5', '99', 'Rebuild into final setup'],
        ],
      },
      { type: 'sub', text: 'Final setup (Lv 99, 30 slots)' },
      {
        type: 'list',
        items: [
          '19× Supreme Gathering House',
          '1× Grand Storehouse',
          '5× Grand Dwelling',
          '5× Great Granary',
        ],
      },
      { type: 'p', text: '*Based on AdArtes\' Village Mastery guide.*' },
    ],
  },
  {
    id: 'dream-guilds',
    emoji: '💤',
    title: 'Dream Guilds',
    blurb: 'A guild for every level and raid bracket. Move up as you grow.',
    blocks: [
      { type: 'sub', text: '⚔️ Assault & Pool guilds' },
      {
        type: 'list',
        items: [
          '**Dream Invaders** — CL 80+, assault-only. 35,000 gold stockpile weekly, Legendary BIS5 gear or better.',
          '**Dream Engineers** — mainly an **Energizing Pools** guild, casual assaults second. No real CL requirement. 5,000/day.',
        ],
      },
      { type: 'sub', text: '🛡️ Raid guilds' },
      {
        type: 'table',
        head: ['Guild', 'CL', 'Daily', 'Leader'],
        rows: [
          ['Team', '92+', '5,000', 'Defias'],
          ['Raiders', '92+', '2,500', 'Ulvurul'],
          ['Guardians', '80+', '5,000', 'Defias'],
          ['Warriors', '80+', '5,000', 'papanca'],
          ['Bandits', '70+', '5,000', 'Lukas'],
          ['Chasers', '40–70', '2,500', 'Sarcasper'],
          ['Angels', '1–40', '—', 'Lukas'],
          ['Cursed Dreamers', 'any', '—', 'Spark89'],
        ],
      },
      {
        type: 'list',
        items: [
          '**2,500 or less daily** → usually 2 raids/day (more during events).',
          '**5,000+ daily** → 2–3 raids/day. Times: `/raid` in Discord.',
          '**Cursed Dreamers** — for trade-locked (Cursed/Banished) characters, no requirements.',
        ],
      },
      { type: 'p', text: '-# Closed guilds: Undead, Paladins, Knights.' },
      { type: 'sub', text: '💧 Energizing Pools (Guild Lv 70)' },
      {
        type: 'p',
        text: 'Pool boosts scale with your **Guild Mastery**: up to **12% Magic Find** (battle, dungeon, WB) and **15% exp** (skill, combat, hunt, GM). Worth it from around **GM 83–89** (~8%). GM 100 takes ~467 CL 92 raids.',
      },
    ],
  },
  {
    id: 'guild',
    emoji: '🤝',
    title: 'Guild & Community',
    blurb: 'The MMO part matters.',
    blocks: [
      {
        type: 'list',
        items: [
          'Join early — older players help with advice, gear and pet eggs.',
          '**Share your goals** with guildies — they\'ll help you get there faster and skip rookie mistakes.',
          'Leagues: find long-term partners for Red Shards.',
          'Being kind and active is a skill too. 🌟',
        ],
      },
      { type: 'sub', text: '🏅 Dream MVPs' },
      {
        type: 'list',
        items: [
          '`/lb` — current Dream activity leaderboard',
          '`/assault lb` — top assaulters',
          'Web: [Guild Tracker](https://guild-tracker-9ys7.vercel.app/) · [Leaderboard](/leaderboard) · [Assault leaderboard](/assault/leaderboard)',
        ],
      },
    ],
  },
  {
    id: 'links',
    emoji: '🔗',
    title: 'Tools & Links',
    blurb: 'Bookmark these.',
    blocks: [
      {
        type: 'links',
        links: [
          { label: 'Combat Calculator', url: COMBAT_CALC_PATH, note: 'hits-to-kill & damage estimates' },
          { label: 'Dungeon Tracker', url: DUNGEON_TRACKER_URL, note: 'dungeon profile & planning' },
          { label: 'Pet sheet', url: PET_SHEET_URL, note: 'every pet number' },
          { label: 'Assault Guide', url: '/assault/guide', note: 'conquest planning' },
          { label: 'Zenith Companion', url: ZENITH_URL, note: 'all-round companion app' },
          { label: 'IdleMMO Tools', url: IDLEMMO_TOOLS_URL, note: 'item & price browser' },
          { label: 'Potions & food', url: POTIONS_URL, note: 'consumables overview' },
          { label: 'Essence crystals', url: ESSENCES_URL },
        ],
      },
      {
        type: 'p',
        text: '-# Sources: FeitasMax (Black Bulls), Doc Rusty, AdArtes (END), IdleMMO wiki. Compiled for Dream.',
      },
    ],
  },
];

// ---------- Discord serialization ----------

const DISCORD_LIMIT = 2000;

const absolutize = (url: string, siteUrl: string) => (url.startsWith('/') ? `${siteUrl}${url}` : url);

// Relative links in inline text → absolute, and wrap in <> to suppress embeds.
function inlineToDiscord(text: string, siteUrl: string) {
  return text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => `[${label}](<${absolutize(url, siteUrl)}>)`);
}

const TONE_EMOJI = { tip: '💡', warn: '⚠️', info: 'ℹ️' } as const;

function tableToDiscord(head: string[], rows: string[][]) {
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i])).join('  ').trimEnd();
  return ['```', line(head), widths.map((w) => '-'.repeat(w)).join('  '), ...rows.map(line), '```'].join('\n');
}

function blockToDiscord(b: GuideBlock, siteUrl: string): string {
  const f = (t: string) => inlineToDiscord(t, siteUrl);
  switch (b.type) {
    case 'p':
      return f(b.text);
    case 'sub':
      return `### ${b.text}`;
    case 'list':
      return b.items.map((it, i) => `${b.ordered ? `${i + 1}.` : '-'} ${f(it)}`).join('\n');
    case 'callout': {
      const head = `> ${TONE_EMOJI[b.tone]} ${b.title ? `**${b.title}**` : ''}`.trimEnd();
      return b.title ? `${head}\n> ${f(b.text)}` : `> ${TONE_EMOJI[b.tone]} ${f(b.text)}`;
    }
    case 'table':
      return tableToDiscord(b.head, b.rows);
    case 'links':
      return b.links
        .map((l) => `- 🔗 [${l.label}](<${absolutize(l.url, siteUrl)}>)${l.note ? ` — ${l.note}` : ''}`)
        .join('\n');
  }
}

/**
 * Returns one or more Discord messages (each within the 2000 char limit).
 * `footer` (optional) is appended to the last message, with room reserved for it.
 */
export function sectionToDiscord(s: GuideSection, siteUrl: string, footer?: string): string[] {
  const parts = [`## ${s.emoji} ${s.title}\n-# ${s.blurb}`, ...s.blocks.map((b) => blockToDiscord(b, siteUrl))];
  const limit = DISCORD_LIMIT - (footer ? footer.length + 2 : 0);
  const messages: string[] = [];
  let cur = '';
  for (const p of parts) {
    if (cur && cur.length + p.length + 2 > limit) {
      messages.push(cur);
      cur = p;
    } else {
      cur = cur ? `${cur}\n\n${p}` : p;
    }
  }
  if (cur) messages.push(cur);
  if (footer) messages[messages.length - 1] += `\n\n${footer}`;
  return messages;
}

/** Short label for nav/index, e.g. "Start Here" from "Start Here — Day 1 Priorities". */
export const shortTitle = (s: GuideSection) => s.title.split(' — ')[0];
