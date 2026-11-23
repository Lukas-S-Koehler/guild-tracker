'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Check, Copy, Loader2, AlertTriangle } from 'lucide-react';
import { copyToClipboard } from '@/lib/utils';
import type { GuildDirectory } from '@/lib/guild-directory';
import { buildPosts, DISCORD_LIMIT } from '@/lib/discord-posts';

/**
 * Copy-ready Discord posts for recruiting and advertising. Built on every load from the live
 * guild directory and src/lib/hub-perks.ts, so numbers, guilds and perks are always current.
 * Text builders live in src/lib/discord-posts.ts (shared with the live #guild-info message).
 */
function PostCard({ title, desc, text }: { title: string; desc: string; text: string }) {
  const [copied, setCopied] = useState(false);
  const over = text.length > DISCORD_LIMIT;
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">{title}</CardTitle>
            <CardDescription>{desc}</CardDescription>
          </div>
          <Button
            size="sm"
            variant={copied ? 'outline' : 'default'}
            onClick={async () => {
              if (await copyToClipboard(text)) {
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }
            }}
          >
            {copied ? <Check className="h-4 w-4 mr-1" /> : <Copy className="h-4 w-4 mr-1" />}
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/40 p-3 text-xs font-mono">{text}</pre>
        <p className={`text-xs flex items-center gap-1 ${over ? 'text-amber-400' : 'text-muted-foreground'}`}>
          {over && <AlertTriangle className="h-3 w-3" />}
          {text.length.toLocaleString()} / {DISCORD_LIMIT.toLocaleString()} characters{over ? ' (too long for one Discord message)' : ''}
        </p>
      </CardContent>
    </Card>
  );
}

export default function AdvertisingPanel() {
  const [dir, setDir] = useState<GuildDirectory | null>(null);
  const [failed, setFailed] = useState(false);
  const [guildId, setGuildId] = useState('');

  useEffect(() => {
    fetch('/api/guilds/directory', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: GuildDirectory) => {
        setDir(d);
        setGuildId(d.guilds.find((g) => g.is_active)?.id ?? '');
      })
      .catch(() => setFailed(true));
  }, []);

  const active = useMemo(() => (dir?.guilds ?? []).filter((g) => g.is_active), [dir]);
  const posts = useMemo(() => {
    if (!dir) return null;
    const site = typeof window !== 'undefined' ? window.location.origin : '';
    return buildPosts(dir, site, active.find((g) => g.id === guildId) ?? null);
  }, [dir, active, guildId]);

  if (failed) return <p className="text-sm text-destructive">Couldn&apos;t load the guild directory.</p>;
  if (!posts) return <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Ready-to-paste Discord posts, rebuilt from live guild data every time you open this tab. Perks come from{' '}
        <code className="text-xs">src/lib/hub-perks.ts</code>, the same list the public home page shows.
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        <PostCard title="Full recruitment post" desc="For #guild-info, partner servers and recruitment channels." text={posts.full} />
        <div className="space-y-4">
          <PostCard title="Short ad" desc="For advertising channels with tight limits." text={posts.short} />
          <PostCard title="Ladder only" desc="Which guild for which CL, with requirements." text={posts.ladder} />
        </div>
      </div>
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">Single guild post:</span>
          {active.map((g) => (
            <Button key={g.id} size="sm" variant={g.id === guildId ? 'default' : 'outline'} onClick={() => setGuildId(g.id)}>{g.tag}</Button>
          ))}
        </div>
        {posts.single && <PostCard title="Guild recruitment post" desc="One guild, for its own recruitment pushes." text={posts.single} />}
      </div>
    </div>
  );
}
