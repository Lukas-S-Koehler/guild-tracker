// Dream Guilds brand mark: a faceted crystal. Colours come from the --crystal tokens in globals.css.
export function DreamMark({ className = 'h-7 w-7' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="dm-a" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="hsl(var(--crystal-light))" />
          <stop offset="1" stopColor="hsl(var(--crystal))" />
        </linearGradient>
        <linearGradient id="dm-b" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="hsl(var(--crystal))" />
          <stop offset="1" stopColor="hsl(var(--crystal-deep))" />
        </linearGradient>
      </defs>
      <path d="M16 2 26 11 16 30 6 11Z" fill="url(#dm-b)" />
      <path d="M16 2 26 11H6Z" fill="url(#dm-a)" />
      <path d="M11 11 16 2 21 11 16 30Z" fill="hsl(var(--crystal-light))" opacity=".35" />
      <path d="M6 11h20" stroke="hsl(var(--background))" strokeOpacity=".5" strokeWidth=".8" />
    </svg>
  );
}

export function DreamWordmark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2 whitespace-nowrap">
      <DreamMark className="h-7 w-7 drop-shadow-[0_0_8px_hsl(var(--crystal)/0.45)]" />
      <span className="leading-none">
        <span className="block font-bold tracking-tight text-lg">
          Dream<span className="text-crystal"> Guilds</span>
        </span>
        {!compact && <span className="hidden sm:block text-[10px] uppercase tracking-[0.2em] text-muted-foreground">IdleMMO hub</span>}
      </span>
    </span>
  );
}
