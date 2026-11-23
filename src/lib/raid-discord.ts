import { NextResponse } from 'next/server';
import { COLORS } from '@/lib/assault-embed';

// Times are given in server time (EST-based per guild); stored here as UTC.
export const REGULAR_UTC = [11, 19];
export const CL25_UTC = 15;
export const EVENT_THIRD_UTC = 20; // "around"
/** Cursed Dreamers (CL 25 guild) runs the extra raid. */
export const CURSED_DREAMERS_ID = '576';

/** Unix seconds for the next occurrence of HH:00 UTC (today if still ahead, else tomorrow). */
function nextUnix(hourUtc: number): number {
  const now = new Date();
  const t = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hourUtc, 0, 0);
  return Math.floor((t <= now.getTime() ? t + 86_400_000 : t) / 1000);
}

/**
 * Raid times embed: shared by /raid and the live #raid-pings schedule message.
 * `live` drops the relative "in 3 hours" part, which goes stale in a message edited once a day.
 */
export function buildRaidEmbed({ live = false, cursed = true }: { live?: boolean; cursed?: boolean } = {}) {
  const slot = (h: number, prefix = '') =>
    live ? `${prefix}<t:${nextUnix(h)}:t>` : `${prefix}<t:${nextUnix(h)}:t> · <t:${nextUnix(h)}:R>`;
  return {
    title: '⚔️ Raid Schedule',
    color: COLORS.purple,
    description: 'Daily raid times. Your local time is shown automatically.',
    fields: [
      {
        name: '🗓️ Regular raids',
        value: REGULAR_UTC.map(h => slot(h, '• ')).join('\n'),
        inline: false,
      },
      ...(cursed
        ? [{ name: '🔥 Cursed Dreamers only', value: `${slot(CL25_UTC, '• ')}\nExtra raid for **CL25**`, inline: false }]
        : []),
      {
        name: '🎉 During events',
        value: `Two raids at the regular times, third raid at around ${slot(EVENT_THIRD_UTC)}`,
        inline: false,
      },
    ],
  };
}

export function handleRaidCommand() {
  return NextResponse.json({ type: 4, data: { embeds: [buildRaidEmbed()] } });
}
