'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { AlertCircle, Check, ChevronDown, ChevronRight, Clock, Copy, ExternalLink, Loader2, Search, Trash2, UserPlus } from 'lucide-react';
import { useApiClient } from '@/lib/api-client';
import { copyToClipboard } from '@/lib/utils';
import { TEMPLATES, type RecruitLanguage, type RecruitStatus } from '@/lib/recruit-parse';
import type { Funnel, NearbyRow, Prospect } from '@/lib/recruit-service';
import type { GuildRubric, ScoutRow } from '@/lib/assault-eligibility';
import { TRACKS } from '@/lib/roster-goals';
import { RecruitCheckCard } from '@/components/admin/RecruitCheck';

/**
 * Recruit tracker. Paste the in-game Nearby list → see who still needs checking; one click to copy
 * the message and log it. Shared by all deputies/leaders so nobody messages the same player twice.
 */

const STATUS_LABEL: Record<RecruitStatus, string> = {
  interested: 'Interested', messaged: 'Messaged', replied: 'Replied', joined: 'Joined', declined: 'Declined',
  skip_guild: 'Has guild', skip_weak: 'Too weak',
};
const STATUS_CLASS: Record<RecruitStatus, string> = {
  interested: 'bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/40',
  messaged: 'bg-blue-500/15 text-blue-400 border-blue-500/40',
  replied: 'bg-amber-500/15 text-amber-400 border-amber-500/40',
  joined: 'bg-green-500/15 text-green-400 border-green-500/40',
  declined: 'bg-red-500/15 text-red-400 border-red-500/40',
  skip_guild: 'bg-gray-500/15 text-gray-400 border-gray-500/40',
  skip_weak: 'bg-gray-500/15 text-gray-400 border-gray-500/40',
};
const profileUrl = (ign: string) => `https://web.idle-mmo.com/@${encodeURIComponent(ign)}`;
const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '';

function readLocal(k: string, fallback: string) {
  try { return localStorage.getItem(k) ?? fallback; } catch { return fallback; }
}
function writeLocal(k: string, v: string) {
  try { localStorage.setItem(k, v); } catch { /* private mode */ }
}

function StatusBadge({ s }: { s: RecruitStatus }) {
  return <span className={`inline-block rounded border px-1.5 py-0.5 text-xs ${STATUS_CLASS[s]}`}>{STATUS_LABEL[s]}</span>;
}

function Name({ ign, tag }: { ign: string; tag?: string | null }) {
  return (
    <a href={profileUrl(ign)} target="_blank" rel="noreferrer" className="font-medium hover:underline inline-flex items-center gap-1">
      {ign}
      {tag && <span className="rounded bg-muted px-1 text-[10px] text-muted-foreground">{tag}</span>}
      <ExternalLink className="h-3 w-3 opacity-50" />
    </a>
  );
}

function prospectLine(p: Prospect) {
  const bits: string[] = [];
  if (p.interest_at && p.interest_tiers) {
    const t = p.interest_tiers;
    bits.push(
      `wants ${t.guild_name} ${fmtDate(p.interest_at)} · CL ${t.combat_level ?? '?'} ${t.character_class ?? ''} · ${t.meets ? 'meets the minimum' : `below Bronze: ${t.below.join(', ') || 'setup'}`}`
    );
  }
  if (p.messaged_at) bits.push(`messaged ${fmtDate(p.messaged_at)}${p.messaged_by_name ? ` by ${p.messaged_by_name}` : ''}`);
  if (p.status === 'skip_guild' || p.status === 'skip_weak') {
    bits.push(`checked ${fmtDate(p.updated_at)}${p.updated_by_name ? ` by ${p.updated_by_name}` : ''}`);
    if (p.recheck_after) bits.push(`recheck ${fmtDate(p.recheck_after)}`);
  }
  if (p.note) bits.push(p.note);
  return bits.join(' · ');
}

export default function RecruitPanel() {
  const api = useApiClient();
  const [location, setLocation] = useState('');
  const [lang, setLang] = useState<RecruitLanguage>('en');
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [funnel, setFunnel] = useState<Funnel | null>(null);
  const [guilds, setGuilds] = useState<JoinGuild[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setLocation(readLocal('recruit.location', 'Floating Gardens'));
    setLang(readLocal('recruit.lang', 'en') === 'de' ? 'de' : 'en');
  }, []);
  useEffect(() => { if (location) writeLocal('recruit.location', location); }, [location]);
  useEffect(() => { writeLocal('recruit.lang', lang); }, [lang]);

  const message = TEMPLATES[lang](location || '…');

  const load = useCallback(async () => {
    try {
      const res = await api.get('/api/admin/recruit');
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? `Failed (${res.status})`);
      setProspects(d.prospects);
      setFunnel(d.funnel);
      setGuilds(d.guilds ?? []);
      setErr(null);
    } catch (e) {
      setErr(String((e as Error).message ?? e));
    } finally {
      setLoading(false);
    }
  }, [api]);
  useEffect(() => { load(); }, [load]);

  /** Status change; returns the saved prospect so callers can update their own lists. */
  const setStatus = async (ign: string, status: RecruitStatus, extra: Record<string, unknown> = {}) => {
    const res = await api.post('/api/admin/recruit', { ign, status, ...extra });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { setErr(d.error ?? `Failed (${res.status})`); return null; }
    const p = d.prospect as Prospect;
    setProspects((prev) => [p, ...prev.filter((x) => x.id !== p.id)]);
    return p;
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Recruiting</CardTitle>
          <CardDescription>
            Shared by all deputies and leaders. Players who show up in a Dream guild are marked joined automatically.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Location" className="w-48" />
            <div className="flex rounded-md border">
              {(['en', 'de'] as const).map((l) => (
                <button key={l} onClick={() => setLang(l)}
                  className={`px-3 py-1.5 text-xs uppercase ${lang === l ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}>
                  {l}
                </button>
              ))}
            </div>
            <CopyButton text={message} label="Copy message" />
          </div>
          <p className="text-xs text-muted-foreground rounded-md border bg-muted/30 p-2">{message}</p>
          {funnel && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {funnel.interested > 0 && <span className="text-fuchsia-300"><b>{funnel.interested}</b> interested</span>}
              <span><b>{funnel.messaged}</b> messaged</span>
              <span><b>{funnel.replied}</b> replied {funnel.messaged > 0 && <span className="text-muted-foreground">({Math.round((funnel.replied / funnel.messaged) * 100)}%)</span>}</span>
              <span className="text-green-500"><b>{funnel.joined}</b> joined {funnel.messaged > 0 && <span className="text-muted-foreground">({Math.round((funnel.joined / funnel.messaged) * 100)}%)</span>}</span>
              <span><b>{funnel.declined}</b> declined</span>
              <span className="text-muted-foreground"><b>{funnel.skipped}</b> ruled out</span>
              {funnel.by_location.length > 1 && (
                <span className="text-muted-foreground">
                  {funnel.by_location.map((l) => `${l.location} ${l.joined}/${l.messaged}`).join(' · ')}
                </span>
              )}
            </div>
          )}
          {err && <p className="text-sm text-destructive flex items-center gap-1"><AlertCircle className="h-4 w-4" />{err}</p>}
        </CardContent>
      </Card>

      <JoiningCard api={api} prospects={prospects} guilds={guilds} reload={load} />
      <RecruitCheckCard api={api} />
      <ScoutCard api={api} />
      <NearbyCard api={api} message={message} location={location} lang={lang} setStatus={setStatus} />
      <ImportCard api={api} onDone={load} />
      {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : (
        <ProspectsCard api={api} prospects={prospects} setStatus={setStatus} reload={load} />
      )}
    </div>
  );
}

function CopyButton({ text, label, onCopied, variant = 'outline' }: {
  text: string; label: string; onCopied?: () => void; variant?: 'outline' | 'default';
}) {
  const [done, setDone] = useState(false);
  return (
    <Button size="sm" variant={variant} onClick={async () => {
      if (await copyToClipboard(text)) {
        setDone(true);
        setTimeout(() => setDone(false), 1500);
        onCopied?.();
      }
    }}>
      {done ? <Check className="h-3.5 w-3.5 mr-1" /> : <Copy className="h-3.5 w-3.5 mr-1" />}{label}
    </Button>
  );
}

type Api = ReturnType<typeof useApiClient>;

type JoinGuild = { id: string; name: string; nickname: string | null; is_assault: boolean | null };

function timeLeft(iso: string) {
  const ms = Date.parse(iso) - Date.now();
  if (ms <= 0) return 'expired';
  const h = Math.floor(ms / 3_600_000);
  return h >= 1 ? `${h}h left` : `${Math.max(1, Math.round(ms / 60_000))}m left`;
}

/**
 * Joining: a player applied and left their old guild but the in-game move is on cooldown. Until the
 * members sync sees them in the guild (or the window ends) they count as a recruit there: assault
 * pages, roster row, Discord member role, claiming. Ends by itself once the move shows up.
 */
function JoiningCard({ api, prospects, guilds, reload }: { api: Api; prospects: Prospect[]; guilds: JoinGuild[]; reload: () => void }) {
  const [ign, setIgn] = useState('');
  const [guildId, setGuildId] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { if (!guildId && guilds.length) setGuildId(guilds[0].id); }, [guilds, guildId]);
  const gName = (id: string | null) => {
    const g = guilds.find((x) => x.id === id);
    return g ? g.nickname ?? g.name : 'a guild';
  };
  const active = prospects.filter((p) => p.joining_member_id && p.joining_until && Date.parse(p.joining_until) > Date.now());

  const call = async (key: string, fn: () => Promise<Response>, ok: (d: any) => string) => {
    setBusy(key); setErr(null); setMsg(null);
    try {
      const res = await fn();
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? `Failed (${res.status})`);
      setMsg(ok(d));
      reload();
    } catch (e) {
      setErr(String((e as Error).message ?? e));
    } finally {
      setBusy(null);
    }
  };

  const start = () =>
    call('start', () => api.post('/api/admin/recruit/joining', { ign: ign.trim(), guild_id: guildId }), (d) => {
      setIgn('');
      return `${d.ign} is joining ${gName(guildId)} until ${new Date(d.until).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })}. Access, roster and Discord role are live now.`;
    });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-1.5"><UserPlus className="h-4 w-4" />Joining (guild move on cooldown)</CardTitle>
        <CardDescription>
          For players who left their old guild and wait out the 24h cooldown. They count as a recruit of the guild right away:
          assault pages, roster row, Discord member role (not stripped), and they can claim the character. Ends by itself once the
          members sync sees them in the guild, or after 48h.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Input value={ign} onChange={(e) => setIgn(e.target.value)} placeholder="Character name" className="w-48"
            onKeyDown={(e) => { if (e.key === 'Enter' && ign.trim() && guildId) start(); }} />
          <select value={guildId} onChange={(e) => setGuildId(e.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm">
            {guilds.map((g) => <option key={g.id} value={g.id}>{g.nickname ?? g.name}{g.is_assault ? ' (assault)' : ''}</option>)}
          </select>
          <Button size="sm" onClick={start} disabled={!ign.trim() || !guildId || busy === 'start'}>
            {busy === 'start' && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}Mark as joining
          </Button>
        </div>
        {msg && <p className="text-sm text-green-500">{msg}</p>}
        {err && <p className="text-sm text-destructive flex items-center gap-1"><AlertCircle className="h-4 w-4" />{err}</p>}
        {active.length > 0 && (
          <div className="divide-y rounded-md border">
            {active.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center gap-2 p-2 text-sm">
                <Name ign={p.ign} />
                <span className="rounded border border-sky-500/40 bg-sky-500/15 px-1.5 py-0.5 text-xs text-sky-300">Joining {gName(p.joining_guild_id)}</span>
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3" />{timeLeft(p.joining_until!)}{p.joining_by_name ? ` · by ${p.joining_by_name}` : ''}
                </span>
                <div className="ml-auto flex gap-1">
                  <Button size="sm" variant="outline" disabled={!!busy}
                    onClick={() => call(`ext-${p.id}`, () => api.patch('/api/admin/recruit/joining', { id: p.id, hours: 24 }), (d) => `${d.ign}: extended to ${timeLeft(d.until)}.`)}>
                    +24h
                  </Button>
                  <Button size="sm" variant="ghost" disabled={!!busy}
                    onClick={() => {
                      if (!window.confirm(`Cancel ${p.ign}'s joining state? Their temporary access and Discord role are removed.`)) return;
                      call(`end-${p.id}`, () => api.delete(`/api/admin/recruit/joining?id=${p.id}`), () => `${p.ign}: joining cancelled.`);
                    }}>
                    Cancel
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const TIER_WORD = ['–', 'Bronze', 'Silver', 'Gold', 'Crystal', 'Dream'];
const TIER_TEXT = ['text-muted-foreground', 'text-amber-600', 'text-zinc-300', 'text-yellow-400', 'text-sky-300', 'text-crystal'];

/**
 * Scouting: claimed characters outside the assault guilds that meet an assault guild's minimum
 * (from /assault/eligibility snapshots, refreshed daily), players who said "interested" first.
 */
function ScoutCard({ api }: { api: Api }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<{ rubrics: GuildRubric[]; rows: ScoutRow[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!open || data) return;
    (async () => {
      const res = await api.get('/api/admin/recruit/scout');
      const d = await res.json().catch(() => ({}));
      if (!res.ok) return setErr(d.error ?? `Failed (${res.status})`);
      setData(d);
    })();
  }, [open, data, api]);
  const core = TRACKS.filter((t) => t.importance === 'core' || t.importance === 'high');
  return (
    <Card>
      <CardHeader className="pb-3 cursor-pointer" onClick={() => setOpen((v) => !v)}>
        <CardTitle className="text-base flex items-center gap-1">
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          Scouting: our players who could assault{data ? ` (${data.rows.length})` : ''}
        </CardTitle>
        <CardDescription>
          Claimed characters outside the assault guilds that meet a guild&apos;s minimum (its roster goals at its assault zone). Interested ones first. Refreshed daily.
        </CardDescription>
      </CardHeader>
      {open && (
        <CardContent>
          {err && <p className="text-sm text-destructive">{err}</p>}
          {!data && !err && <Loader2 className="h-5 w-5 animate-spin" />}
          {data && !data.rows.length && <p className="text-sm text-muted-foreground">Nobody yet.</p>}
          {data && data.rows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground border-b">
                    <th className="py-2 pr-3 font-medium">Character</th>
                    {data.rubrics.map((g) => <th key={g.id} className="py-2 pr-3 font-medium">{g.nickname ?? g.name}</th>)}
                    <th className="py-2 font-medium">Interest</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.hashed_id} className="border-b last:border-0 align-top">
                      <td className="py-2 pr-3 whitespace-nowrap">
                        <Name ign={r.ign} />
                        <div className="text-xs text-muted-foreground">CL {r.combat_level ?? '?'} · {r.character_class ?? '?'} · {r.guild_name ?? 'no Dream guild'}</div>
                      </td>
                      {data.rubrics.map((g) => {
                        const v = r.verdicts[g.id];
                        if (!v) return <td key={g.id} className="py-2 pr-3 text-xs text-muted-foreground">—</td>;
                        return (
                          <td key={g.id} className="py-2 pr-3 text-xs">
                            <div className={v.meets ? 'text-green-500' : 'text-muted-foreground'}>{v.meets ? '✓ meets the minimum' : `below Bronze: ${v.below.length + v.setup.length}`}</div>
                            <div className="flex flex-wrap gap-x-2">
                              {core.map((t) => (
                                <span key={t.id} className="text-muted-foreground">{t.label} <span className={TIER_TEXT[v.tiers[t.id] ?? 0]}>{TIER_WORD[v.tiers[t.id] ?? 0]}</span></span>
                              ))}
                            </div>
                          </td>
                        );
                      })}
                      <td className="py-2 text-xs whitespace-nowrap">
                        {r.interest ? (
                          <span className="rounded border border-fuchsia-500/40 bg-fuchsia-500/15 px-1.5 py-0.5 text-fuchsia-300">
                            {data.rubrics.find((g) => g.id === r.interest!.guild_id)?.nickname ?? 'a guild'} · {fmtDate(r.interest.at)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
type SetStatus = (ign: string, status: RecruitStatus, extra?: Record<string, unknown>) => Promise<Prospect | null>;

function NearbyCard({ api, message, location, lang, setStatus }: {
  api: Api; message: string; location: string; lang: RecruitLanguage; setStatus: SetStatus;
}) {
  const [text, setText] = useState('');
  const [rows, setRows] = useState<NearbyRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const triage = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await api.post('/api/admin/recruit/nearby', { text });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? `Failed (${res.status})`);
      setRows(d.rows);
    } catch (e) {
      setErr(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const act = async (ign: string, status: RecruitStatus) => {
    const extra = status === 'messaged' ? { location, language: lang } : { location };
    const p = await setStatus(ign, status, extra);
    if (p) setRows((prev) => prev?.map((r) => (r.ign === ign ? { ...r, bucket: 'done', prospect: p } : r)) ?? null);
  };

  const groups = useMemo(() => {
    const g = { check: [] as NearbyRow[], done: [] as NearbyRow[], tagged: [] as NearbyRow[], dream: [] as NearbyRow[] };
    for (const r of rows ?? []) (r.bucket === 'recheck' ? g.check : g[r.bucket]).push(r);
    return g;
  }, [rows]);

  const Section = ({ id, title, items, render }: { id: string; title: string; items: NearbyRow[]; render: (r: NearbyRow) => React.ReactNode }) =>
    items.length ? (
      <div>
        <button onClick={() => setOpen((o) => ({ ...o, [id]: !o[id] }))} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          {open[id] ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}{title} ({items.length})
        </button>
        {open[id] && <div className="mt-1 ml-5 space-y-1 text-sm">{items.map((r) => <div key={r.ign}>{render(r)}</div>)}</div>}
      </div>
    ) : null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Nearby check</CardTitle>
        <CardDescription>Copy the Nearby Characters panel in game and paste it here. Guild tags and Dream members are filtered out.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} placeholder="Nearby Characters…" className="font-mono text-xs" />
        <div className="flex gap-2">
          <Button size="sm" onClick={triage} disabled={busy || !text.trim()}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Search className="h-3.5 w-3.5 mr-1" />}Check list
          </Button>
          {rows && <Button size="sm" variant="ghost" onClick={() => { setRows(null); setText(''); }}>Clear</Button>}
        </div>
        {err && <p className="text-sm text-destructive">{err}</p>}

        {rows && (
          <div className="space-y-3">
            <p className="text-sm font-medium">To check ({groups.check.length})</p>
            {groups.check.length === 0 && <p className="text-sm text-muted-foreground">Nobody new here.</p>}
            <div className="divide-y rounded-md border">
              {groups.check.map((r) => (
                <div key={r.ign} className="flex flex-wrap items-center justify-between gap-2 p-2">
                  <div className="min-w-0">
                    <Name ign={r.ign} />
                    <span className="ml-2 text-xs text-muted-foreground">{r.activity}</span>
                    {r.bucket === 'recheck' && r.prospect && (
                      <p className="text-xs text-amber-400">Recheck: was {STATUS_LABEL[r.prospect.status].toLowerCase()} on {fmtDate(r.prospect.updated_at)}{r.prospect.note ? ` (${r.prospect.note})` : ''}</p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <CopyButton text={message} label="Copy + messaged" variant="default" onCopied={() => act(r.ign, 'messaged')} />
                    <Button size="sm" variant="outline" onClick={() => act(r.ign, 'skip_guild')}>Has guild</Button>
                    <Button size="sm" variant="outline" onClick={() => act(r.ign, 'skip_weak')}>Too weak</Button>
                  </div>
                </div>
              ))}
            </div>
            <Section id="done" title="Already handled" items={groups.done} render={(r) => (
              <span className="flex flex-wrap items-center gap-2">
                <Name ign={r.ign} />{r.prospect && <StatusBadge s={r.prospect.status} />}
                <span className="text-xs text-muted-foreground">{r.prospect && prospectLine(r.prospect)}</span>
              </span>
            )} />
            <Section id="tagged" title="In another guild" items={groups.tagged} render={(r) => <Name ign={r.ign} tag={r.tag} />} />
            <Section id="dream" title="Already in Dream" items={groups.dream} render={(r) => <Name ign={r.ign} />} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ImportCard({ api, onDone }: { api: Api; onDone: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [open, setOpen] = useState(false);

  const run = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await api.post('/api/admin/recruit/import', { text });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? `Failed (${res.status})`);
      setMsg({
        ok: true,
        text: `${d.parsed} messages read. ${d.added} new, ${d.advanced} updated, ${d.unchanged} unchanged.${d.igns.length ? ` (${d.igns.join(', ')})` : ''}`,
      });
      setText('');
      onDone();
    } catch (e) {
      setMsg({ ok: false, text: String((e as Error).message ?? e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3 cursor-pointer" onClick={() => setOpen((o) => !o)}>
        <CardTitle className="text-base flex items-center gap-1">
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}Import messages
        </CardTitle>
        <CardDescription>Paste your in-game message list. Our recruit message counts as messaged, anything else as a reply. Never moves anyone backwards.</CardDescription>
      </CardHeader>
      {open && (
        <CardContent className="space-y-2">
          <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} className="font-mono text-xs" placeholder="Paste messages (with the player links)…" />
          <Button size="sm" onClick={run} disabled={busy || !text.trim()}>
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}Import
          </Button>
          {msg && <p className={`text-sm ${msg.ok ? 'text-green-500' : 'text-destructive'}`}>{msg.text}</p>}
        </CardContent>
      )}
    </Card>
  );
}

const FILTERS: { id: string; label: string; match: (p: Prospect) => boolean }[] = [
  { id: 'interested', label: 'Interested', match: (p) => p.status === 'interested' },
  { id: 'open', label: 'Waiting', match: (p) => p.status === 'messaged' || p.status === 'replied' },
  { id: 'joined', label: 'Joined', match: (p) => p.status === 'joined' },
  { id: 'declined', label: 'Declined', match: (p) => p.status === 'declined' },
  { id: 'skipped', label: 'Ruled out', match: (p) => p.status === 'skip_guild' || p.status === 'skip_weak' },
  { id: 'all', label: 'All', match: () => true },
];

function ProspectsCard({ api, prospects, setStatus, reload }: {
  api: Api; prospects: Prospect[]; setStatus: SetStatus; reload: () => void;
}) {
  const [filter, setFilter] = useState('open');
  const [q, setQ] = useState('');
  const [addIgn, setAddIgn] = useState('');
  const shown = useMemo(() => {
    const f = FILTERS.find((x) => x.id === filter) ?? FILTERS[0];
    const ql = q.trim().toLowerCase();
    return prospects.filter((p) => (ql ? p.ign.toLowerCase().includes(ql) : f.match(p)));
  }, [prospects, filter, q]);

  const editNote = async (p: Prospect) => {
    const note = window.prompt(`Note for ${p.ign}`, p.note ?? '');
    if (note === null) return;
    await api.patch('/api/admin/recruit', { id: p.id, note });
    reload();
  };
  const remove = async (p: Prospect) => {
    if (!window.confirm(`Remove ${p.ign} from the recruit list?`)) return;
    await api.delete(`/api/admin/recruit?id=${p.id}`);
    reload();
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Players</CardTitle>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {FILTERS.map((f) => (
            <Button key={f.id} size="sm" variant={filter === f.id && !q ? 'default' : 'outline'} onClick={() => { setFilter(f.id); setQ(''); }}>
              {f.label} ({prospects.filter(f.match).length})
            </Button>
          ))}
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name" className="h-8 w-40" />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="divide-y rounded-md border">
          {shown.length === 0 && <p className="p-3 text-sm text-muted-foreground">Nobody here.</p>}
          {shown.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 p-2">
              <div className="min-w-0 space-y-0.5">
                <div className="flex items-center gap-2"><Name ign={p.ign} /><StatusBadge s={p.status} />
                  {p.location && <span className="text-xs text-muted-foreground">{p.location}</span>}
                </div>
                <p className="text-xs text-muted-foreground">{prospectLine(p)}</p>
              </div>
              <div className="flex items-center gap-1">
                <select value={p.status} onChange={(e) => setStatus(p.ign, e.target.value as RecruitStatus)}
                  className="h-8 rounded-md border bg-background px-2 text-xs">
                  {(Object.keys(STATUS_LABEL) as RecruitStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                </select>
                <Button size="sm" variant="ghost" onClick={() => editNote(p)}>Note</Button>
                <Button size="sm" variant="ghost" onClick={() => remove(p)} aria-label="Remove"><Trash2 className="h-3.5 w-3.5" /></Button>
              </div>
            </div>
          ))}
        </div>
        <form className="flex gap-2" onSubmit={async (e) => {
          e.preventDefault();
          if (addIgn.trim() && (await setStatus(addIgn.trim(), 'messaged'))) setAddIgn('');
        }}>
          <Input value={addIgn} onChange={(e) => setAddIgn(e.target.value)} placeholder="Add name as messaged" className="h-8 w-52" />
          <Button size="sm" variant="outline" type="submit" disabled={!addIgn.trim()}>Add</Button>
        </form>
      </CardContent>
    </Card>
  );
}
