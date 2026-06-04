'use client';

import { useState, useEffect } from 'react';
import { msUntilNextCron } from '@/lib/utils';

function formatMs(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${h}h ${m.toString().padStart(2, '0')}m ${s.toString().padStart(2, '0')}s`;
}

export default function CronCountdown() {
  const [ms, setMs] = useState<number | null>(null);

  useEffect(() => {
    setMs(msUntilNextCron());
    const id = setInterval(() => setMs(msUntilNextCron()), 1000);
    return () => clearInterval(id);
  }, []);

  if (ms === null) return null;

  return (
    <span className="text-xs text-muted-foreground tabular-nums">
      Next reset in {formatMs(ms)}
    </span>
  );
}
