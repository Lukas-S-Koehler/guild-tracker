import { NextResponse } from 'next/server';
import { COLORS } from '@/lib/assault-embed';

// Times are given in server time (EST-based per guild); stored here as UTC.
const REGULAR_UTC = [11, 19];
const CL25_UTC = 15;
const EVENT_THIRD_UTC = 20; // "around"

/** Unix seconds for the next occurrence of HH:00 UTC (today if still ahead, else tomorrow). */
function nextUnix(hourUtc: number): number {
  const now = new Date();
  const t = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hourUtc, 0, 0);
  return Math.floor((t <= now.getTime() ? t + 86_400_000 : t) / 1000);
}

const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;
const slot = (h: number, prefix = '') =>
  `${prefix}**${hh(h)} UTC** · <t:${nextUnix(h)}:t> your time · <t:${nextUnix(h)}:R>`;

export function handleRaidCommand() {
  const embed = {
    title: '⚔️ Raid Schedule',
    color: COLORS.purple,
    description: 'Daily raid times. Your local time is shown automatically.',
    fields: [
      {
        name: '🗓️ Regular raids',
        value: REGULAR_UTC.map(h => slot(h, '• ')).join('\n'),
        inline: false,
      },
      {
        name: '🔥 Cursed Dreamers only',
        value: `${slot(CL25_UTC, '• ')}\nExtra raid for **CL25**`,
        inline: false,
      },
      {
        name: '🎉 During events',
        value: `Two raids at the regular times, third raid at around ${slot(EVENT_THIRD_UTC)}`,
        inline: false,
      },
    ],
    footer: { text: 'Times in UTC (server time EST + 1h earlier in UTC)' },
  };
  return NextResponse.json({ type: 4, data: { embeds: [embed] } });
}
