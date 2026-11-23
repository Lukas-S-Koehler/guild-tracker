'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { AlertCircle, Check, ExternalLink, Eye, Loader2, Pause, Play, RefreshCw, Unlink } from 'lucide-react';

/**
 * Admin → Discord → Live messages. Bind each DreamBot live post to a channel, update or
 * repost it, pause it, or preview what would be posted. Backed by /api/admin/discord-live.
 */
interface Item {
  key: string;
  label: string;
  description: string;
  channel: string | null;
  mode: 'edit' | 'repost' | 'append';
  source: 'build' | 'auto-warn' | 'guild-hall' | 'achievements' | 'assault-recap';
  guild_active?: boolean;
  pings?: boolean;
  buildable: boolean;
  bound: boolean;
  channel_id: string | null;
  enabled: boolean;
  message_count: number;
  link: string | null;
  last_published_at: string | null;
  last_error: string | null;
}

interface Payload { content?: string; embeds?: Array<{ title?: string; description?: string; fields?: Array<{ name: string; value: string }> }> }

function previewText(p: Payload[]): string {
  return p
    .map((m, i) => {
      const parts = [`── message ${i + 1} ──`];
      if (m.content) parts.push(m.content);
      for (const e of m.embeds ?? []) {
        if (e.title) parts.push(`[embed] ${e.title}`);
        if (e.description) parts.push(e.description);
        for (const f of e.fields ?? []) parts.push(`▸ ${f.name}\n${f.value}`);
      }
      return parts.join('\n');
    })
    .join('\n\n');
}

const ago = (iso: string | null) => {
  if (!iso) return 'never';
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 60) return `${m} min ago`;
  if (m < 48 * 60) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} days ago`;
};

async function post(body: Record<string, unknown>) {
  const res = await fetch('/api/admin/discord-live', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok || d.ok === false) throw new Error(d.error ?? `Failed (${res.status})`);
  return d as { status?: string; note?: string };
}

function LiveCard({ item, onChange }: { item: Item; onChange: () => void }) {
  const [channel, setChannel] = useState(item.channel_id ?? item.channel ?? '');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  async function run(label: string, body: Record<string, unknown>, done: (d: { status?: string; note?: string }) => string) {
    setBusy(label);
    setMsg(null);
    try {
      const d = await post({ key: item.key, ...body });
      setMsg({ ok: true, text: done(d) });
      onChange();
    } catch (err) {
      setMsg({ ok: false, text: String(err instanceof Error ? err.message : err) });
    } finally {
      setBusy(null);
    }
  }

  async function loadPreview() {
    if (preview !== null) return setPreview(null);
    setBusy('preview');
    try {
      const res = await fetch(`/api/admin/discord-live?preview=${encodeURIComponent(item.key)}`);
      const d = await res.json();
      setPreview(d.payloads?.length ? previewText(d.payloads) : 'Nothing yet: produced by the daily activity check.');
    } catch {
      setPreview('Preview failed.');
    } finally {
      setBusy(null);
    }
  }

  const statusText = (s?: string) => (s === 'unchanged' ? 'No changes, nothing edited.' : s === 'published' ? 'Posted.' : s ?? 'Done.');
  const moved = item.bound && channel.trim() !== item.channel_id;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="space-y-1">
            <CardTitle className="text-base flex items-center gap-2">
              {item.label}
              {!item.bound ? (
                <Badge variant="outline">not bound</Badge>
              ) : item.enabled ? (
                <Badge className="bg-crystal/20 text-crystal border-crystal/30">live</Badge>
              ) : (
                <Badge variant="secondary">paused</Badge>
              )}
              {item.guild_active === false && <Badge variant="secondary">guild inactive · no reports</Badge>}
              <Badge variant="outline" className="font-normal">{item.mode === 'edit' ? 'edited in place' : item.mode === 'append' ? 'new post daily, history kept' : 'reposted daily'}</Badge>
            </CardTitle>
            <CardDescription>{item.description}</CardDescription>
          </div>
          {item.link && (
            <a href={item.link} target="_blank" rel="noreferrer" className="text-sm text-crystal inline-flex items-center gap-1 hover:underline">
              Open in Discord <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Input value={channel} onChange={(e) => setChannel(e.target.value)} placeholder="Channel id" className="w-56 font-mono text-xs" />
          {(!item.bound || moved) && (
            <Button
              size="sm"
              disabled={!!busy || !channel.trim()}
              onClick={() => run('bind', { action: 'bind', channel_id: channel.trim() }, (d) => d.note ?? statusText(d.status))}
            >
              {busy === 'bind' && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
              {moved ? 'Move here' : item.buildable ? 'Bind & post' : 'Bind'}
            </Button>
          )}
          {item.bound && !moved && (
            <>
              {item.mode !== 'append' && (
                <Button size="sm" variant="outline" disabled={!!busy} onClick={() => run('publish', { action: 'publish', force: true }, (d) => statusText(d.status))}>
                  {busy === 'publish' ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <RefreshCw className="h-3 w-3 mr-1" />}
                  {item.mode === 'edit' ? 'Update now' : 'Repost last'}
                </Button>
              )}
              <Button size="sm" variant="outline" disabled={!!busy} onClick={() => run('toggle', { action: 'toggle', enabled: !item.enabled }, () => (item.enabled ? 'Paused.' : 'Resumed.'))}>
                {item.enabled ? <Pause className="h-3 w-3 mr-1" /> : <Play className="h-3 w-3 mr-1" />}
                {item.enabled ? 'Pause' : 'Resume'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!!busy}
                onClick={() => {
                  if (!confirm(`Unbind "${item.label}" and delete its ${item.message_count} Discord message(s)?`)) return;
                  run('unbind', { action: 'unbind', delete_messages: true }, () => 'Unbound, messages deleted.');
                }}
              >
                <Unlink className="h-3 w-3 mr-1" /> Unbind
              </Button>
            </>
          )}
          <Button size="sm" variant="ghost" disabled={!!busy} onClick={loadPreview}>
            {busy === 'preview' ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Eye className="h-3 w-3 mr-1" />}
            {preview !== null ? 'Hide preview' : 'Preview'}
          </Button>
        </div>
        {item.pings !== undefined && (
          <label className="flex items-center gap-2 text-sm cursor-pointer w-fit">
            <input
              type="checkbox"
              className="rounded"
              checked={item.pings}
              disabled={!!busy}
              onChange={(e) => run('pings', { action: 'pings', enabled: e.target.checked }, () => (e.target.checked ? '@mentions on.' : '@mentions off.'))}
            />
            @mention flagged members in the report
          </label>
        )}
        {item.bound && (
          <p className="text-xs text-muted-foreground">
            {item.message_count} message{item.message_count === 1 ? '' : 's'} · last posted {ago(item.last_published_at)}
            {item.source === 'auto-warn' && ' · updated by the daily activity check'}
            {item.source === 'guild-hall' && ' · updated daily at 15:50 UTC'}
            {item.source === 'achievements' && ' · new post daily after the activity check'}
            {item.source === 'assault-recap' && ' · posted once after the season ends'}
          </p>
        )}
        {item.last_error && (
          <p className="text-xs text-destructive flex items-start gap-1"><AlertCircle className="h-3 w-3 mt-0.5 shrink-0" /> {item.last_error}</p>
        )}
        {msg && (
          <p className={`text-sm flex items-start gap-1.5 ${msg.ok ? 'text-green-500' : 'text-destructive'}`}>
            {msg.ok ? <Check className="h-3.5 w-3.5 mt-0.5 shrink-0" /> : <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />}
            {msg.text}
          </p>
        )}
        {preview !== null && (
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/40 p-3 text-xs font-mono">{preview}</pre>
        )}
      </CardContent>
    </Card>
  );
}

type SectionId = 'network' | 'recaps' | 'reports' | 'halls';

const SECTIONS: { id: SectionId; label: string; note?: string; compact: boolean }[] = [
  { id: 'network', label: 'Network posts', compact: false },
  { id: 'recaps', label: 'Assault recaps', note: 'One season recap per assault guild, posted once the day after the season ends.', compact: true },
  {
    id: 'reports',
    label: 'Inactivity reports',
    note: 'One report per guild in its guild chat. Unbound or paused = no report. Inactive guilds get none (the activity check skips them).',
    compact: true,
  },
  {
    id: 'halls',
    label: 'Guild halls',
    note: "Stockpile post per guild. Needs the guild's API key and active buildings in Admin → Guilds.",
    compact: true,
  },
];

const sectionOf = (key: string): SectionId =>
  key.startsWith('inactivity:') ? 'reports' : key.startsWith('guild-hall:') ? 'halls' : key.startsWith('assault-recap:') ? 'recaps' : 'network';

/** Problems first, then live, paused, unbound; inactive guilds last. */
const weight = (i: Item) =>
  (i.guild_active === false ? 10 : 0) + (i.last_error ? 0 : !i.bound ? 3 : !i.enabled ? 2 : 1);

function statusBadge(i: Item) {
  if (!i.bound) return <Badge variant="outline">not bound</Badge>;
  if (!i.enabled) return <Badge variant="secondary">paused</Badge>;
  return <Badge className="bg-crystal/20 text-crystal border-crystal/30">live</Badge>;
}

/** One line per guild; click to open the full card. */
function CompactRow({ item, open, onToggle, onChange }: { item: Item; open: boolean; onToggle: () => void; onChange: () => void }) {
  return (
    <div className="rounded-md border">
      <button onClick={onToggle} className="flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/40">
        <span className="font-medium min-w-0 flex-1 truncate">{item.label.includes(' · ') ? item.label.slice(item.label.indexOf(' · ') + 3) : item.label}</span>
        {item.last_error && <AlertCircle className="h-4 w-4 text-destructive" />}
        {item.guild_active === false && <Badge variant="secondary">guild inactive</Badge>}
        {item.pings === false && item.bound && <Badge variant="outline" className="font-normal">no @mentions</Badge>}
        {statusBadge(item)}
        <span className="w-24 text-right text-xs text-muted-foreground">{item.bound ? ago(item.last_published_at) : ''}</span>
      </button>
      {open && (
        <div className="border-t p-2">
          <LiveCard item={item} onChange={onChange} />
        </div>
      )}
    </div>
  );
}

export default function LiveMessagesPanel() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [section, setSection] = useState<SectionId>('network');
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/discord-live', { cache: 'no-store' });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? `Failed (${res.status})`);
      setItems(d.items);
      setError(null);
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!items) return <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  const by = (id: SectionId) => items.filter((i) => sectionOf(i.key) === id).sort((a, b) => weight(a) - weight(b));
  const current = SECTIONS.find((s) => s.id === section)!;
  const list = by(section);
  const errors = items.filter((i) => i.last_error).length;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        DreamBot posts that stay current instead of piling up. Nothing is posted until you bind a channel.
        Reference posts are rebuilt daily after the activity check and only edited when something changed; daily reports replace yesterday&apos;s copy.
        {errors > 0 && <span className="text-destructive"> {errors} with an error (shown first).</span>}
      </p>

      <div className="flex flex-wrap gap-2">
        {SECTIONS.map((s) => {
          const rows = by(s.id);
          if (!rows.length) return null;
          const live = rows.filter((i) => i.bound && i.enabled).length;
          const bad = rows.some((i) => i.last_error);
          return (
            <button
              key={s.id}
              onClick={() => { setSection(s.id); setOpen(null); }}
              className={`rounded-full border px-3 py-1.5 text-sm transition ${section === s.id ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-muted/50'}`}
            >
              {s.label}
              <span className="ml-1.5 text-xs opacity-70">{live}/{rows.length} live</span>
              {bad && <span className="ml-1.5 inline-block h-2 w-2 rounded-full bg-destructive align-middle" />}
            </button>
          );
        })}
      </div>

      {current.note && <p className="text-xs text-muted-foreground">{current.note}</p>}

      {current.compact ? (
        <div className="space-y-2">
          {list.map((i) => (
            <CompactRow key={i.key} item={i} open={open === i.key} onToggle={() => setOpen(open === i.key ? null : i.key)} onChange={load} />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {list.map((i) => <LiveCard key={i.key} item={i} onChange={load} />)}
        </div>
      )}
    </div>
  );
}
