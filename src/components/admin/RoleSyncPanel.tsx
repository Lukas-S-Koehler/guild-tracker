'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AlertCircle, Loader2, RefreshCw, Shield } from 'lucide-react';

interface Change { discord_id: string; name: string; characters: string[]; add: string[]; remove: string[]; kept: string[] }
interface Plan { changes: Change[]; unmapped: { discord_id: string; name: string; roles: string[] }[]; scanned: number }
interface Keep { discord_id: string; role_id: string; role_name: string; note: string | null }
interface Data { ok: boolean; error?: string; plan?: Plan; keeps: Keep[]; auto: boolean; names?: Record<string, string> }

/**
 * Admin → Discord → Role sync (super admin). In-game guild + position → Member/Staff - <guild>,
 * Retired Member when in no Dream guild. Dry run first, keep exceptions, then apply.
 */
export function RoleSyncPanel() {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/admin/discord-roles', { cache: 'no-store' });
    const d: Data = await res.json().catch(() => ({ ok: false, error: 'Request failed', keeps: [], auto: false }));
    setData(d);
    if (d.names) setNames(d.names);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const rn = (id: string) => names[id] ?? id;

  async function post(body: Record<string, unknown>, key: string) {
    setBusy(key);
    setMsg(null);
    const res = await fetch('/api/admin/discord-roles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) {
      setMsg(d.error ?? 'Request failed');
      return null;
    }
    return d;
  }

  async function apply(discordId?: string) {
    const n = discordId ? 1 : data?.plan?.changes.length ?? 0;
    if (!discordId && !confirm(`Apply role changes for ${n} people now?`)) return;
    const d = await post(discordId ? { action: 'apply-user', discord_id: discordId } : { action: 'apply' }, discordId ?? 'all');
    if (d) {
      setMsg(`Done: ${d.added} added, ${d.removed} removed${d.errors?.length ? `, ${d.errors.length} errors: ${d.errors.slice(0, 3).map((e: { error: string }) => e.error).join(' | ')}` : ''}.`);
      load();
    }
  }

  async function keep(c: Change, roleId: string) {
    const note = prompt(`Keep ${rn(roleId)} for ${c.name}? Optional note (e.g. "assault staff"):`);
    if (note === null) return;
    if (await post({ action: 'keep', discord_id: c.discord_id, role_id: roleId, note: note || null }, `keep:${c.discord_id}:${roleId}`)) load();
  }

  async function unkeep(k: Keep) {
    if (await post({ action: 'unkeep', discord_id: k.discord_id, role_id: k.role_id }, `unkeep:${k.discord_id}:${k.role_id}`)) load();
  }

  async function toggleAuto() {
    const d = await post({ action: 'auto', value: !data?.auto }, 'auto');
    if (d) setData((x) => (x ? { ...x, auto: d.auto } : x));
  }

  const plan = data?.plan;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2"><Shield className="h-4 w-4" /> Discord role sync</CardTitle>
          <CardDescription>
            Everyone in a Dream guild gets <b>Member - TAG</b>; officers, deputies and leaders also <b>Staff - TAG</b>. Mapped people in no
            Dream guild get <b>Retired Member</b>. Only these roles are touched; Officer/Deputy/Leadership/Holiday stay manual. People without
            a mapped character are never changed, only listed. Linking (/claim, /map, approving a claim) syncs that person immediately.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={load} disabled={loading}>
              {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} Dry run
            </Button>
            <Button size="sm" onClick={() => apply()} disabled={!plan?.changes.length || busy !== null}>
              {busy === 'all' ? <Loader2 className="h-3 w-3 animate-spin" /> : null} Apply all ({plan?.changes.length ?? 0})
            </Button>
            <span className="flex-1" />
            <span className="text-xs text-muted-foreground">Daily auto sync (after members sync)</span>
            <Button size="sm" variant={data?.auto ? 'default' : 'outline'} onClick={toggleAuto} disabled={!data || busy !== null}>
              {data?.auto ? 'On' : 'Off'}
            </Button>
          </div>
          {msg && <p className="text-sm">{msg}</p>}
          {data?.error && (
            <p className="flex items-start gap-2 text-sm text-destructive"><AlertCircle className="h-4 w-4 shrink-0 mt-0.5" /> {data.error}</p>
          )}
          {plan && (
            <p className="text-xs text-muted-foreground">
              Scanned {plan.scanned} server members · {plan.changes.length} need changes · {plan.unmapped.length} unmapped with guild roles
            </p>
          )}
        </CardContent>
      </Card>

      {plan && plan.changes.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Pending changes</CardTitle></CardHeader>
          <CardContent>
            <ul className="divide-y divide-border text-sm">
              {plan.changes.map((c) => (
                <li key={c.discord_id} className="py-2 flex flex-wrap items-center gap-2">
                  <span className="font-medium">{c.name}</span>
                  <span className="text-xs text-muted-foreground">{c.characters.slice(0, 4).join(', ')}</span>
                  <span className="flex-1" />
                  {c.add.map((r) => (
                    <Badge key={r} variant="outline" className="bg-green-500/10 text-green-500 border-green-500/40">+ {rn(r)}</Badge>
                  ))}
                  {c.remove.map((r) => (
                    <span key={r} className="inline-flex items-center gap-1">
                      <Badge variant="outline" className="bg-red-500/10 text-red-500 border-red-500/40">− {rn(r)}</Badge>
                      <button className="text-xs underline text-muted-foreground hover:text-foreground" onClick={() => keep(c, r)} disabled={busy !== null}>keep</button>
                    </span>
                  ))}
                  <Button size="sm" variant="outline" className="h-7" onClick={() => apply(c.discord_id)} disabled={busy !== null}>
                    {busy === c.discord_id ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Apply'}
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {plan && plan.unmapped.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Unmapped people with guild roles</CardTitle>
            <CardDescription>Not changed. Map them (Member mapping, or /map) or ask them to run /claim, then they sync automatically.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="text-sm space-y-1">
              {plan.unmapped.map((u) => (
                <li key={u.discord_id} className="flex flex-wrap gap-2 items-center">
                  <span className="font-medium">{u.name}</span>
                  <code className="text-xs text-muted-foreground">{u.discord_id}</code>
                  {u.roles.map((r) => <Badge key={r} variant="secondary">{rn(r)}</Badge>)}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {data && data.keeps.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Kept roles</CardTitle>
            <CardDescription>The sync never removes these.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="text-sm space-y-1">
              {data.keeps.map((k) => (
                <li key={`${k.discord_id}:${k.role_id}`} className="flex flex-wrap gap-2 items-center">
                  <code className="text-xs">{k.discord_id}</code>
                  <Badge variant="secondary">{k.role_name}</Badge>
                  {k.note && <span className="text-xs text-muted-foreground">{k.note}</span>}
                  <button className="ml-auto text-xs underline text-muted-foreground hover:text-red-500" onClick={() => unkeep(k)} disabled={busy !== null}>remove</button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
