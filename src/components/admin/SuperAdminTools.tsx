'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, AlertCircle, Check, RefreshCw } from 'lucide-react';

type Msg = { type: 'success' | 'error'; text: string } | null;

function MessageLine({ message }: { message: Msg }) {
  if (!message) return null;
  return (
    <div className={`flex items-start gap-2 p-2 rounded text-sm ${message.type === 'success' ? 'bg-green-500/10 text-green-600' : 'bg-destructive/10 text-destructive'}`}>
      {message.type === 'success' ? <Check className="h-3 w-3 shrink-0 mt-0.5" /> : <AlertCircle className="h-3 w-3 shrink-0 mt-0.5" />}
      {message.text}
    </div>
  );
}

function useFlash() {
  const [message, setMessage] = useState<Msg>(null);
  const showMsg = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 8000);
  };
  return { message, showMsg };
}

interface MemberOverviewRow {
  id: string;
  ign: string;
  guild_id: string;
  guild_name: string;
  guild_nickname: string;
  hashed_id: string | null;
  discord_id: string | null;
  alts_found: number;
  alts_matched: number;
}

interface GuildOverviewStat {
  guild_id: string;
  guild_name: string;
  guild_nickname: string;
  total: number;
  with_hashed_id: number;
  without_hashed_id: number;
  with_alts: number;
}

interface OverviewData {
  members: MemberOverviewRow[];
  guild_stats: GuildOverviewStat[];
  totals: { members: number; with_hashed_id: number; without_hashed_id: number; with_alts: number; alts_matched: number };
}

/** Global Discord kill switches (app_settings). Super admin only. */
export function DiscordSwitches() {
  const { message, showMsg } = useFlash();
  const [pauseDiscordDMs, setPauseDiscordDMs] = useState<boolean | null>(null);
  const [togglingPause, setTogglingPause] = useState(false);
  const [disableGuildPings, setDisableGuildPings] = useState<boolean | null>(null);
  const [togglingPings, setTogglingPings] = useState(false);

  useEffect(() => {
    fetch('/api/admin/app-settings')
      .then(r => r.json())
      .then(d => {
        setPauseDiscordDMs(d.pause_discord_dms === 'true');
        setDisableGuildPings(d.disable_guild_pings === 'true');
      })
      .catch(() => { setPauseDiscordDMs(false); setDisableGuildPings(false); });
  }, []);

  const handleTogglePause = async () => {
    setTogglingPause(true);
    const next = !pauseDiscordDMs;
    try {
      const res = await fetch('/api/admin/app-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'pause_discord_dms', value: String(next) }),
      });
      if (res.ok) {
        setPauseDiscordDMs(next);
        showMsg('success', next ? 'Discord DMs paused — cron will log warnings but not DM members' : 'Discord DMs resumed');
      } else {
        const d = await res.json();
        showMsg('error', d.error || 'Failed to update setting');
      }
    } catch { showMsg('error', 'Network error'); }
    finally { setTogglingPause(false); }
  };

  const handleToggleGuildPings = async () => {
    setTogglingPings(true);
    const next = !disableGuildPings;
    try {
      const res = await fetch('/api/admin/app-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'disable_guild_pings', value: String(next) }),
      });
      if (res.ok) {
        setDisableGuildPings(next);
        showMsg('success', next ? 'Guild channel pings disabled — reports will not @mention members' : 'Guild channel pings re-enabled');
      } else {
        const d = await res.json();
        showMsg('error', d.error || 'Failed to update setting');
      }
    } catch { showMsg('error', 'Network error'); }
    finally { setTogglingPings(false); }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Global switches</CardTitle>
        <CardDescription>Apply to every guild. Use during incidents or testing.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <MessageLine message={message} />
        <div className="flex items-center justify-between p-3 border rounded-lg bg-background">
          <div>
            <p className="text-sm font-medium flex items-center gap-2">
              Pause Discord DMs
              {pauseDiscordDMs && <Badge variant="outline" className="text-xs bg-orange-500/10 text-orange-500 border-orange-500/50">PAUSED</Badge>}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">When paused, auto-warn cron logs warnings to DB and posts channel reports but skips member DMs</p>
          </div>
          <Button
            size="sm"
            variant={pauseDiscordDMs ? 'default' : 'outline'}
            onClick={handleTogglePause}
            disabled={togglingPause || pauseDiscordDMs === null}
            className={pauseDiscordDMs ? 'bg-orange-500 hover:bg-orange-600' : ''}
          >
            {togglingPause ? <Loader2 className="h-3 w-3 animate-spin" /> : pauseDiscordDMs ? 'Resume DMs' : 'Pause DMs'}
          </Button>
        </div>

        <div className="flex items-center justify-between p-3 border rounded-lg bg-background">
          <div>
            <p className="text-sm font-medium flex items-center gap-2">
              Disable Guild Channel Pings
              {disableGuildPings && <Badge variant="outline" className="text-xs bg-orange-500/10 text-orange-500 border-orange-500/50">DISABLED</Badge>}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">When disabled, inactivity reports in guild channels will not @mention members</p>
          </div>
          <Button
            size="sm"
            variant={disableGuildPings ? 'default' : 'outline'}
            onClick={handleToggleGuildPings}
            disabled={togglingPings || disableGuildPings === null}
            className={disableGuildPings ? 'bg-orange-500 hover:bg-orange-600' : ''}
          >
            {togglingPings ? <Loader2 className="h-3 w-3 animate-spin" /> : disableGuildPings ? 'Enable Pings' : 'Disable Pings'}
          </Button>
        </div>

        <AutoModWelcomeTexts />
      </CardContent>
    </Card>
  );
}

/** Hashed-ID backfill, alt sync and coverage overview across all guilds. Super admin only. */
export function AltSyncTools() {
  const { message, showMsg } = useFlash();
  const [backfilling, setBackfilling] = useState(false);
  const [syncingAlts, setSyncingAlts] = useState(false);
  const [linkingDiscord, setLinkingDiscord] = useState(false);
  const [loadingOverview, setLoadingOverview] = useState(false);
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [showOverview, setShowOverview] = useState(false);
  const [overviewFilter, setOverviewFilter] = useState<'all' | 'missing' | 'alts'>('all');

  const loadOverview = async () => {
    setLoadingOverview(true);
    try {
      const res = await fetch('/api/admin/hashed-id-overview');
      const data = await res.json();
      if (res.ok) {
        setOverview(data);
        setShowOverview(true);
      } else {
        showMsg('error', data.error || 'Failed to load overview');
      }
    } catch { showMsg('error', 'Network error'); }
    finally { setLoadingOverview(false); }
  };

  const handleBackfillAll = async () => {
    if (!confirm('Backfill hashed IDs for ALL guilds? Calls IdleMMO API for each guild — may take a few minutes.')) return;
    setBackfilling(true);
    try {
      const res = await fetch('/api/admin/backfill-hashed-ids', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      const data = await res.json();
      if (res.ok) {
        const msg = `Updated ${data.updated} hashed IDs. Still missing: ${data.still_missing}${data.still_missing > 0 ? ` (${data.still_missing_names?.slice(0, 5).join(', ')}${data.still_missing > 5 ? '…' : ''})` : ''}`;
        showMsg('success', msg);
        if (showOverview) await loadOverview();
      } else {
        showMsg('error', data.error || 'Backfill failed');
      }
    } catch { showMsg('error', 'Network error'); }
    finally { setBackfilling(false); }
  };

  const handleLinkByDiscord = async () => {
    if (!confirm('Scan all discord_id mappings and auto-link members sharing one as manual alts?')) return;
    setLinkingDiscord(true);
    try {
      const res = await fetch('/api/admin/link-alts-by-discord', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        showMsg('success', `Processed ${data.accounts_processed} accounts; created ${data.links_created} manual links from shared Discord IDs.`);
      } else {
        showMsg('error', data.error || 'Failed');
      }
    } catch { showMsg('error', 'Network error'); }
    finally { setLinkingDiscord(false); }
  };

  const handleSyncAltsAll = async () => {
    if (!confirm('Sync alt characters for ALL members with a hashed ID? Calls IdleMMO API per member — may take several minutes.')) return;
    setSyncingAlts(true);
    try {
      const res = await fetch('/api/admin/sync-alts-all', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      const data = await res.json();
      if (res.ok) {
        showMsg('success', `Processed ${data.processed}/${data.total_members_with_hashed_id} members, ${data.alts_found} alts found${data.error_count > 0 ? `, ${data.error_count} errors` : ''}`);
        if (showOverview) await loadOverview();
      } else {
        showMsg('error', data.error || 'Sync failed');
      }
    } catch { showMsg('error', 'Network error'); }
    finally { setSyncingAlts(false); }
  };

  const filteredMembers = overview?.members.filter(m => {
    if (overviewFilter === 'missing') return !m.hashed_id;
    if (overviewFilter === 'alts') return m.alts_found > 0;
    return true;
  }) ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Alt detection tools</CardTitle>
        <CardDescription>Uses your IdleMMO API key. Run Backfill first, then Sync Alts.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <MessageLine message={message} />
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={handleBackfillAll} disabled={backfilling || syncingAlts}>
            {backfilling ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
            Backfill All Hashed IDs
          </Button>
          <Button size="sm" variant="outline" onClick={handleSyncAltsAll} disabled={syncingAlts || backfilling}>
            {syncingAlts ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <RefreshCw className="h-3 w-3 mr-1" />}
            Sync All Alts
          </Button>
          <Button size="sm" variant="outline" onClick={handleLinkByDiscord} disabled={linkingDiscord}>
            {linkingDiscord ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
            Link Alts by Discord ID
          </Button>
          <Button size="sm" variant="outline" onClick={showOverview ? () => setShowOverview(false) : loadOverview} disabled={loadingOverview}>
            {loadingOverview ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
            {showOverview ? 'Hide Overview' : 'Show Overview'}
          </Button>
        </div>

        {showOverview && overview && (
          <div className="space-y-4">
            {/* Totals */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {[
                { label: 'Members', value: overview.totals.members, color: '' },
                { label: 'Hashed ID', value: overview.totals.with_hashed_id, color: 'text-green-500' },
                { label: 'Missing ID', value: overview.totals.without_hashed_id, color: overview.totals.without_hashed_id > 0 ? 'text-orange-400' : 'text-green-500' },
                { label: 'Have Alts', value: overview.totals.with_alts, color: 'text-blue-400' },
                { label: 'Alts Matched', value: overview.totals.alts_matched, color: 'text-blue-400' },
              ].map(s => (
                <div key={s.label} className="p-2 border rounded bg-background text-center">
                  <div className={`text-xl font-bold ${s.color}`}>{s.value}</div>
                  <div className="text-xs text-muted-foreground">{s.label}</div>
                </div>
              ))}
            </div>

            {/* Per-guild stats */}
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">Per Guild</p>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {overview.guild_stats.map(g => (
                  <div key={g.guild_id} className="flex items-center gap-2 text-xs py-1 border-b border-border/50">
                    <span className="font-mono font-bold text-primary w-12 shrink-0">{g.guild_nickname || g.guild_id}</span>
                    <span className="text-muted-foreground w-32 truncate shrink-0">{g.guild_name}</span>
                    <span className="text-green-500 shrink-0">{g.with_hashed_id}✓</span>
                    {g.without_hashed_id > 0 && <span className="text-orange-400 shrink-0">{g.without_hashed_id} missing</span>}
                    {g.with_alts > 0 && <span className="text-blue-400 shrink-0">{g.with_alts} alts</span>}
                    <div className="flex-1 bg-muted rounded-full h-1.5">
                      <div
                        className="bg-green-500 h-1.5 rounded-full"
                        style={{ width: `${Math.round((g.with_hashed_id / g.total) * 100)}%` }}
                      />
                    </div>
                    <span className="text-muted-foreground shrink-0">{Math.round((g.with_hashed_id / g.total) * 100)}%</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Member list */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <p className="text-xs font-medium text-muted-foreground">Members</p>
                <div className="flex gap-1">
                  {(['all', 'missing', 'alts'] as const).map(f => (
                    <button
                      key={f}
                      onClick={() => setOverviewFilter(f)}
                      className={`px-2 py-0.5 rounded text-xs ${overviewFilter === f ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}
                    >
                      {f === 'all' ? `All (${overview.members.length})` : f === 'missing' ? `Missing ID (${overview.totals.without_hashed_id})` : `Has Alts (${overview.totals.with_alts})`}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-0.5 max-h-64 overflow-y-auto">
                {filteredMembers.map(m => (
                  <div key={m.id} className="flex items-center gap-2 text-xs py-1 px-1 rounded hover:bg-muted/50">
                    <span className={`h-2 w-2 rounded-full shrink-0 ${m.hashed_id ? 'bg-green-500' : 'bg-orange-400'}`} />
                    <span className="font-medium w-28 truncate shrink-0">{m.ign}</span>
                    <span className="text-muted-foreground w-16 truncate shrink-0 font-mono">{m.guild_nickname || m.guild_id}</span>
                    {m.hashed_id
                      ? <span className="text-green-500/70 font-mono text-[10px] truncate flex-1">{m.hashed_id.slice(0, 12)}…</span>
                      : <span className="text-orange-400 flex-1">no hashed_id</span>
                    }
                    {m.discord_id && <span className="text-blue-400 shrink-0 text-[10px]">discord✓</span>}
                    {m.alts_found > 0 && (
                      <span className={`shrink-0 text-[10px] ${m.alts_matched > 0 ? 'text-blue-400' : 'text-muted-foreground'}`}>
                        {m.alts_matched}/{m.alts_found} alts
                      </span>
                    )}
                  </div>
                ))}
                {filteredMembers.length === 0 && (
                  <p className="text-xs text-muted-foreground py-2 text-center">No members match this filter</p>
                )}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const GUIDE_CHANNEL = '1573818767505490051';
const GUILD_INFO_CHANNEL = '1444861407978979459';

/**
 * Copyable texts for the AutoMod welcome message. AutoMod stays the welcomer: it reacts to joins
 * instantly, DreamBot can't (no gateway). The text points people to /claim, which DreamBot handles.
 */
function AutoModWelcomeTexts() {
  const [variant, setVariant] = useState('full');
  const [copied, setCopied] = useState(false);

  const texts: Record<string, { label: string; text: string }> = {
    full: {
      label: 'Full (recommended)',
      text: [
        'Welcome to the Dream Guilds, {user_mention}! Please send your character name and combat level, that way leadership can select a guild for you. Or find the guild that fits your CL yourself in <#' + GUILD_INFO_CHANNEL + '>.',
        'In the meantime you can check out <#' + GUIDE_CHANNEL + '> for all the important info on the game.',
        'Already in a Dream guild? Run `/claim` so your guild roles update automatically and `/me` shows your daily check. `/help` lists every DreamBot command.',
      ].join('\n'),
    },
    short: {
      label: 'Short',
      text: 'Welcome to the Dream Guilds, {user_mention}! Send your character name and combat level so leadership can pick a guild for you (or find one in <#' + GUILD_INFO_CHANNEL + '>). Already in a guild? Run `/claim`.',
    },
    current: {
      label: 'Current text + /claim line',
      text: [
        'Welcome to the server, {user_mention}! Please send your character name and combat level, that way leadership can select a guild for you.',
        'Already in a Dream guild? Run `/claim` to link your Discord. Every guild is listed in <#' + GUILD_INFO_CHANNEL + '>.',
      ].join('\n'),
    },
  };
  const text = texts[variant].text;

  return (
    <details className="p-3 border rounded-lg bg-background">
      <summary className="text-sm font-medium cursor-pointer">AutoMod welcome text (#introductions)</summary>
      <div className="mt-3 space-y-2">
        <p className="text-xs text-muted-foreground">
          AutoMod keeps welcoming people because it reacts to joins instantly; DreamBot can&apos;t see joins live. Paste one of these into the AutoMod
          welcome message. <code>{'{user_mention}'}</code> is AutoMod&apos;s placeholder that pings the new member. Visitors only see channels the Visitor role can view, so only link those (#guild-info needs View Channel for Visitor).
        </p>
        <div className="flex items-center gap-2">
          <select value={variant} onChange={(e) => { setVariant(e.target.value); setCopied(false); }} className="h-8 rounded border bg-background px-2 text-sm">
            {Object.entries(texts).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <Button size="sm" variant="outline" onClick={async () => { await navigator.clipboard.writeText(text); setCopied(true); }}>
            {copied ? <Check className="h-3 w-3" /> : null} {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
        <pre className="whitespace-pre-wrap text-xs bg-muted/50 rounded p-2">{text}</pre>
      </div>
    </details>
  );
}
