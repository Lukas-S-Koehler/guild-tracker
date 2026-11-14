export interface HitsRow {
  hits: number;
  time: string;
  kills: string;
}

export const HITS_TO_KILL: HitsRow[] = [
  { hits: 2, time: '3.00s', kills: '10,800' },
  { hits: 3, time: '4.53s', kills: '7,152' },
  { hits: 4, time: '6.18s', kills: '5,243' },
  { hits: 5, time: '7.23s', kills: '4,481' },
];

export interface PrepStep {
  when: string;
  text: string;
}

export const FIVE_PS: PrepStep[] = [
  { when: '-120m', text: 'Pool live, hunt final mobs (4k–10k+)' },
  { when: '-30m', text: 'Wrap hunting, clear inventory, pack food, check stance' },
  { when: '-10m', text: 'Combat gear, battle pet patted, perks active, shrine active, XP pots staged. Do NOT drink POTG yet.' },
  { when: '-5m', text: 'Wraithbane / Strike Essence + combat stat pot (Thunderfury / Bladeburst). POTG in hand.' },
  { when: '0m', text: 'Chug POTG, select up to 6 mobs (lowest hits-to-kill), click Battle.' },
  { when: '+30m', text: 'Restack stat pots if not already active.' },
  { when: '+50m', text: "Final 8h restack while POTG + Pool still up. Don't lose the snapshot." },
];

export const GEAR_LINK = 'https://dungeon-tracker-seven.vercel.app/gear';

export const POTION_SLOTS: { slot: string; examples: string }[] = [
  { slot: 'Battle XP', examples: 'POTG, Dragonblood Tonic, Vortex Brew, Battle Potion, Strike Essence' },
  { slot: 'Combat XP', examples: "Wraithbane Essence, Dungeon Master's Tonic, Dungeon Potion, Sun's Light" },
  { slot: 'Attack', examples: "Frenzy, Bladeburst, Dragon's Essence (pair w/ Bulwark)" },
  { slot: 'Protection', examples: "Shieldbearer's Infusion, Bulwark Brew, Guardian's Soul" },
  { slot: 'Combo (fills ATK + PROT)', examples: 'Thunderfury Brew, Cosmic Tear, Phoenix Ashes' },
];

export interface TerritoryBoost {
  place: string;
  expMf: number;
  eff: number;
}

export const TERRITORY_BOOSTS: TerritoryBoost[] = [
  { place: '1st', expMf: 25, eff: 5 },
  { place: '2nd', expMf: 17, eff: 5 },
  { place: '3rd', expMf: 13, eff: 5 },
  { place: '4th', expMf: 10, eff: 3 },
  { place: '5th', expMf: 7, eff: 3 },
  { place: '6th', expMf: 7, eff: 3 },
  { place: '7th', expMf: 7, eff: 3 },
  { place: '8th', expMf: 3, eff: 2 },
  { place: '9th', expMf: 3, eff: 2 },
  { place: '10th', expMf: 3, eff: 2 },
];

export interface ShardReward {
  place: string;
  shards: number;
}

export const EXP_REWARDS: ShardReward[] = [
  { place: '1st', shards: 20000 },
  { place: '2nd', shards: 15000 },
  { place: '3rd', shards: 10000 },
  { place: '4th', shards: 5000 },
  { place: '5th', shards: 4800 },
  { place: '6th', shards: 4500 },
  { place: '7th', shards: 4000 },
  { place: '8th', shards: 3500 },
  { place: '9th', shards: 3000 },
  { place: '10th', shards: 2000 },
  { place: '11th–25th', shards: 1000 },
];

export const KILL_REWARDS: ShardReward[] = [
  { place: '1st', shards: 5000 },
  { place: '2nd', shards: 3750 },
  { place: '3rd', shards: 2500 },
  { place: '4th', shards: 1250 },
  { place: '5th', shards: 1200 },
  { place: '6th', shards: 1125 },
  { place: '7th', shards: 1000 },
  { place: '8th', shards: 875 },
  { place: '9th', shards: 750 },
  { place: '10th', shards: 500 },
  { place: '11th–25th', shards: 250 },
];

export const EXP_SPLIT = [
  { label: 'Guild EXP', pct: '5%' },
  { label: 'Conquest EXP', pct: '5%' },
  { label: 'Guild Mastery EXP', pct: '5%' },
];
