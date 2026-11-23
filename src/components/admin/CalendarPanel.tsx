'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useApiClient } from '@/lib/api-client';
import type { CustomEventRow, CustomKind } from '@/lib/calendar';

const KINDS: { value: CustomKind; label: string }[] = [
  { value: 'event', label: '🎉 Event' },
  { value: 'pool', label: '💧 Pool' },
  { value: 'giveaway', label: '🎁 Giveaway' },
  { value: 'meeting', label: '🗣️ Meeting' },
  { value: 'other', label: '📌 Other' },
];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const NETWORK = '__network__';

interface Guild {
  id: string;
  name: string;
  nickname: string;
}

interface Form {
  id: string | null;
  title: string;
  description: string;
  kind: CustomKind;
  guild: string;
  repeat: 'once' | 'weekly';
  /** once: local datetime-local value */
  startsLocal: string;
  /** weekly: LOCAL weekdays + local HH:MM (converted to UTC on save) */
  days: number[];
  timeLocal: string;
  from: string;
  until: string;
  duration: string;
}

const pad = (n: number) => String(n).padStart(2, '0');
const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** A Date in the coming week on local weekday `dow` at local HH:MM. */
function localSlot(dow: number, hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date();
  d.setHours(h!, m!, 0, 0);
  d.setDate(d.getDate() + ((dow - d.getDay() + 7) % 7));
  return d;
}

/** Local weekdays + time → UTC weekdays + HH:MM (today's UTC offset). */
function toUtc(days: number[], hhmm: string): { weekdays: number[]; time_utc: string } {
  const slots = days.map((d) => localSlot(d, hhmm));
  const first = slots[0] ?? localSlot(0, hhmm);
  return {
    weekdays: Array.from(new Set(slots.map((s) => s.getUTCDay()))).sort(),
    time_utc: `${pad(first.getUTCHours())}:${pad(first.getUTCMinutes())}`,
  };
}

/** UTC weekdays + HH:MM → local weekdays + time. */
function fromUtc(weekdays: number[], time: string): { days: number[]; timeLocal: string } {
  const [h, m] = time.split(':').map(Number);
  const slots = weekdays.map((wd) => {
    const d = new Date();
    d.setUTCHours(h!, m!, 0, 0);
    d.setUTCDate(d.getUTCDate() + ((wd - d.getUTCDay() + 7) % 7));
    return d;
  });
  const first = slots[0] ?? new Date();
  return { days: Array.from(new Set(slots.map((s) => s.getDay()))).sort(), timeLocal: `${pad(first.getHours())}:${pad(first.getMinutes())}` };
}

const empty = (guild: string): Form => ({
  id: null,
  title: '',
  description: '',
  kind: 'event',
  guild,
  repeat: 'once',
  startsLocal: '',
  days: [],
  timeLocal: '20:00',
  from: '',
  until: '',
  duration: '',
});

function whenText(e: CustomEventRow): string {
  if (e.starts_at) return new Date(e.starts_at).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const { days, timeLocal } = fromUtc(e.weekdays ?? [], e.time_utc ?? '00:00');
  const range = [e.active_from && `from ${e.active_from}`, e.active_until && `until ${e.active_until}`].filter(Boolean).join(' ');
  return `Every ${days.map((d) => DAYS[d]).join(', ')} at ${timeLocal}${range ? ` (${range})` : ''}`;
}

export default function CalendarPanel() {
  const api = useApiClient();
  const [events, setEvents] = useState<CustomEventRow[] | null>(null);
  const [guilds, setGuilds] = useState<Guild[]>([]);
  const [manageable, setManageable] = useState<string[] | null>(null);
  const [canNetwork, setCanNetwork] = useState(false);
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const [ev, gs] = await Promise.all([api.get('/api/admin/calendar'), api.get('/api/guilds')]);
    const j = await ev.json();
    if (!ev.ok) {
      setError(j.error ?? 'Failed to load');
      setEvents([]);
      return;
    }
    setEvents(j.events);
    setManageable(j.manageable_guild_ids);
    setCanNetwork(j.can_network);
    const g = await gs.json();
    setGuilds(Array.isArray(g) ? g : []);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tag = useMemo(() => new Map(guilds.map((g) => [g.id, g.nickname || g.name])), [guilds]);
  const allowed = (guildId: string | null) => (guildId ? manageable === null || manageable.includes(guildId) : canNetwork);
  const guildOptions = guilds.filter((g) => allowed(g.id));
  const defaultGuild = canNetwork ? NETWORK : guildOptions[0]?.id ?? NETWORK;

  const edit = (e: CustomEventRow) => {
    const weekly = !e.starts_at;
    const local = weekly ? fromUtc(e.weekdays ?? [], e.time_utc ?? '00:00') : null;
    setError(null);
    setForm({
      id: e.id,
      title: e.title,
      description: e.description ?? '',
      kind: e.kind,
      guild: e.guild_id ?? NETWORK,
      repeat: weekly ? 'weekly' : 'once',
      startsLocal: e.starts_at ? toLocalInput(e.starts_at) : '',
      days: local?.days ?? [],
      timeLocal: local?.timeLocal ?? '20:00',
      from: e.active_from ?? '',
      until: e.active_until ?? '',
      duration: e.duration_minutes ? String(e.duration_minutes) : '',
    });
  };

  const save = async () => {
    if (!form) return;
    setSaving(true);
    setError(null);
    const body: Record<string, unknown> = {
      id: form.id,
      title: form.title,
      description: form.description,
      kind: form.kind,
      guild_id: form.guild === NETWORK ? null : form.guild,
      repeat: form.repeat,
      duration_minutes: form.duration || null,
    };
    if (form.repeat === 'once') body.starts_at = form.startsLocal ? new Date(form.startsLocal).toISOString() : '';
    else Object.assign(body, toUtc(form.days, form.timeLocal), { active_from: form.from || null, active_until: form.until || null });
    const res = form.id ? await api.patch('/api/admin/calendar', body) : await api.post('/api/admin/calendar', body);
    const j = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) return setError(j.error ?? 'Save failed');
    setForm(null);
    load();
  };

  const remove = async (e: CustomEventRow) => {
    if (!confirm(`Delete "${e.title}"?`)) return;
    const res = await api.delete(`/api/admin/calendar?id=${e.id}`);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      return setError(j.error ?? 'Delete failed');
    }
    load();
  };

  if (!events) return <Loader2 className="h-6 w-6 animate-spin mx-auto my-8" />;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Calendar events</CardTitle>
            <CardDescription>
              Raids and assault launches show up on <a href="/calendar" className="underline">/calendar</a> by themselves. Add everything else here:
              pools, game events, giveaways, meetings. Officers+ manage their own guild&apos;s events; network-wide events are super admin only.
              Times are in your local time.
            </CardDescription>
          </div>
          {!form && (
            <Button size="sm" onClick={() => { setError(null); setForm(empty(defaultGuild)); }}>
              <Plus className="h-4 w-4 mr-1" /> New event
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {error && <p className="text-sm text-red-500">{error}</p>}

          {form && (
            <div className="rounded-lg border p-4 space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1 text-sm">
                  <span className="text-muted-foreground">Title</span>
                  <Input value={form.title} maxLength={80} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Double EXP weekend" />
                </label>
                <label className="space-y-1 text-sm">
                  <span className="text-muted-foreground">Type</span>
                  <Select value={form.kind} onValueChange={(v) => setForm({ ...form, kind: v as CustomKind })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {KINDS.map((k) => <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </label>
                <label className="space-y-1 text-sm">
                  <span className="text-muted-foreground">For</span>
                  <Select value={form.guild} onValueChange={(v) => setForm({ ...form, guild: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {canNetwork && <SelectItem value={NETWORK}>All Dream guilds</SelectItem>}
                      {guildOptions.map((g) => <SelectItem key={g.id} value={g.id}>{g.nickname} - {g.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </label>
                <label className="space-y-1 text-sm">
                  <span className="text-muted-foreground">Repeats</span>
                  <Select value={form.repeat} onValueChange={(v) => setForm({ ...form, repeat: v as Form['repeat'] })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="once">Once</SelectItem>
                      <SelectItem value="weekly">Weekly</SelectItem>
                    </SelectContent>
                  </Select>
                </label>
              </div>

              {form.repeat === 'once' ? (
                <label className="block space-y-1 text-sm max-w-xs">
                  <span className="text-muted-foreground">Starts</span>
                  <Input type="datetime-local" value={form.startsLocal} onChange={(e) => setForm({ ...form, startsLocal: e.target.value })} />
                </label>
              ) : (
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-1.5">
                    {DAYS.map((d, i) => {
                      const on = form.days.includes(i);
                      return (
                        <button
                          key={d}
                          type="button"
                          onClick={() => setForm({ ...form, days: on ? form.days.filter((x) => x !== i) : [...form.days, i] })}
                          className={`rounded-md border px-2.5 py-1 text-xs ${on ? 'bg-primary text-primary-foreground' : ''}`}
                        >
                          {d}
                        </button>
                      );
                    })}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <label className="space-y-1 text-sm">
                      <span className="text-muted-foreground">Time</span>
                      <Input type="time" value={form.timeLocal} onChange={(e) => setForm({ ...form, timeLocal: e.target.value })} />
                    </label>
                    <label className="space-y-1 text-sm">
                      <span className="text-muted-foreground">From (optional)</span>
                      <Input type="date" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} />
                    </label>
                    <label className="space-y-1 text-sm">
                      <span className="text-muted-foreground">Until (optional)</span>
                      <Input type="date" value={form.until} onChange={(e) => setForm({ ...form, until: e.target.value })} />
                    </label>
                  </div>
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
                <label className="space-y-1 text-sm">
                  <span className="text-muted-foreground">Details (optional)</span>
                  <Input value={form.description} maxLength={500} onChange={(e) => setForm({ ...form, description: e.target.value })} />
                </label>
                <label className="space-y-1 text-sm">
                  <span className="text-muted-foreground">Duration (min)</span>
                  <Input type="number" min={1} max={10080} value={form.duration} onChange={(e) => setForm({ ...form, duration: e.target.value })} />
                </label>
              </div>

              <div className="flex gap-2">
                <Button size="sm" onClick={save} disabled={saving}>
                  {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                  {form.id ? 'Save' : 'Add event'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setForm(null)}>Cancel</Button>
              </div>
            </div>
          )}

          {events.length === 0 ? (
            <p className="text-sm text-muted-foreground">No events yet.</p>
          ) : (
            <ul className="divide-y">
              {events.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">
                      {KINDS.find((k) => k.value === e.kind)?.label.split(' ')[0]} {e.title}{' '}
                      <Badge variant="outline" className="ml-1 text-xs font-mono">{e.guild_id ? tag.get(e.guild_id) ?? e.guild_id : 'All'}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {whenText(e)}
                      {e.duration_minutes ? ` · ${e.duration_minutes} min` : ''}
                      {e.description ? ` · ${e.description}` : ''}
                    </div>
                  </div>
                  {allowed(e.guild_id) && (
                    <div className="flex gap-1">
                      <Button size="icon" variant="ghost" onClick={() => edit(e)} title="Edit"><Pencil className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" onClick={() => remove(e)} title="Delete"><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
