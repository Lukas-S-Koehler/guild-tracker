'use client';

import { useMemo } from 'react';

type Day = { date: string; level: 0 | 1 | 2 | 3 };
const HEAT = ['bg-muted', 'bg-sky-900', 'bg-sky-600', 'bg-sky-400'];
const prettyDate = (d: string) =>
  new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/** Activity heatmap, last 53 weeks (used by /me and profiles). */
export default function Heatmap({ days }: { days: Day[] }) {
  // Columns = weeks (Mon..Sun), aligned so the last column holds today.
  const weeks = useMemo(() => {
    const first = new Date(days[0].date + 'T00:00:00Z').getUTCDay() || 7; // Mon=1
    const padded: (Day | null)[] = [...Array(first - 1).fill(null), ...days];
    const cols: (Day | null)[][] = [];
    for (let i = 0; i < padded.length; i += 7) cols.push(padded.slice(i, i + 7));
    return cols;
  }, [days]);
  const label = ['No activity', 'Some activity', 'Requirement met', 'Met 2× or more'];
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <div className="flex gap-[3px] w-max">
          {weeks.map((w, i) => (
            <div key={i} className="flex flex-col gap-[3px]">
              {w.map((d, j) =>
                d ? (
                  <div
                    key={j}
                    title={`${prettyDate(d.date)}: ${label[d.level]}`}
                    className={`h-[11px] w-[11px] rounded-[2px] ${HEAT[d.level]}`}
                  />
                ) : (
                  <div key={j} className="h-[11px] w-[11px]" />
                )
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        Less
        {HEAT.map((c, i) => (
          <div key={i} className={`h-[11px] w-[11px] rounded-[2px] ${c}`} title={label[i]} />
        ))}
        More
      </div>
    </div>
  );
}
