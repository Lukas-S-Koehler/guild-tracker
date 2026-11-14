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
