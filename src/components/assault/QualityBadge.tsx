import { QUALITY_CLASSES } from '@/lib/potion-rules';
import { cn } from '@/lib/utils';

export function QualityBadge({ quality, className }: { quality: string | null; className?: string }) {
  if (!quality) return null;
  return (
    <span
      className={cn(
        'inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
        QUALITY_CLASSES[quality] ?? 'bg-slate-500/20 text-slate-300 border-slate-500/40',
        className,
      )}
    >
      {quality}
    </span>
  );
}
