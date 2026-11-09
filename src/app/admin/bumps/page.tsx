'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, ArrowLeft, Check, AlertCircle, Rocket } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import ProtectedRoute from '@/components/ProtectedRoute';

interface BumpGuild {
  guild_id: string;
  guild_name: string;
  discord_server_id: string;
  bump_channel_id: string;
  bump_king_role_id: string;
  bump_button_message_id: string;
  current_bump_king_discord_id: string;
}

function BumpsContent() {
  const { isSuperAdmin, loading: authLoading } = useAuth();
  const [guilds, setGuilds] = useState<BumpGuild[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [registering, setRegistering] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [edits, setEdits] = useState<Record<string, { bump_channel_id: string; bump_king_role_id: string }>>({});

  const showMsg = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 4000);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/bump-install');
      if (!res.ok) throw new Error((await res.json()).error ?? 'Load failed');
      const data = await res.json();
      setGuilds(data.guilds ?? []);
      const initial: Record<string, { bump_channel_id: string; bump_king_role_id: string }> = {};
      for (const g of data.guilds ?? []) {
        initial[g.guild_id] = {
          bump_channel_id: g.bump_channel_id,
          bump_king_role_id: g.bump_king_role_id,
        };
      }
      setEdits(initial);
    } catch (e) {
      showMsg('error', String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!authLoading && isSuperAdmin) load();
  }, [authLoading, isSuperAdmin, load]);

  const save = async (guildId: string) => {
    setSavingId(guildId);
    try {
      const edit = edits[guildId];
      const res = await fetch('/api/admin/bump-install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guild_id: guildId,
          bump_channel_id: edit.bump_channel_id,
          bump_king_role_id: edit.bump_king_role_id,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Save failed');
      showMsg('success', 'Saved');
      await load();
    } catch (e) {
      showMsg('error', String(e));
    } finally {
      setSavingId(null);
    }
  };

  const install = async (guildId: string) => {
    const edit = edits[guildId];
    if (!edit?.bump_channel_id) {
      showMsg('error', 'Enter Bump Channel ID first');
      return;
    }
    setInstallingId(guildId);
    try {
      const res = await fetch('/api/admin/bump-install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guild_id: guildId,
          bump_channel_id: edit.bump_channel_id,
          bump_king_role_id: edit.bump_king_role_id,
          install: true,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Install failed');
      showMsg('success', 'Button posted to Discord');
      await load();
    } catch (e) {
      showMsg('error', String(e));
    } finally {
      setInstallingId(null);
    }
  };

  const registerCmd = async () => {
    setRegistering(true);
    try {
      const res = await fetch('/api/admin/bump-install?action=register-command');
      if (!res.ok) throw new Error((await res.json()).error ?? 'Register failed');
      showMsg('success', '/bumps slash command registered');
    } catch (e) {
      showMsg('error', String(e));
    } finally {
      setRegistering(false);
    }
  };

  if (authLoading || loading) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isSuperAdmin) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Super admin only.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4 max-w-3xl mx-auto p-4">
      <div className="flex items-center justify-between">
        <Link href="/admin">
          <Button size="sm" variant="ghost">
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
        </Link>
        <Button size="sm" variant="outline" onClick={registerCmd} disabled={registering}>
          {registering ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
          Register /bumps Slash Command
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Rocket className="h-4 w-4" />
            Bump Tracker
          </CardTitle>
          <CardDescription className="text-xs">
            Per-guild bump tracking. Members click a button in the chosen channel after bumping the guild ad in main IdleMMO Discord. 2h cooldown enforced. Monthly top bumper gets the Bump King role.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {message && (
            <div
              className={`flex items-start gap-2 p-2 rounded text-sm ${
                message.type === 'success'
                  ? 'bg-green-500/10 text-green-600'
                  : 'bg-destructive/10 text-destructive'
              }`}
            >
              {message.type === 'success' ? (
                <Check className="h-3 w-3 mt-0.5" />
              ) : (
                <AlertCircle className="h-3 w-3 mt-0.5" />
              )}
              {message.text}
            </div>
          )}

          {guilds.length === 0 && (
            <p className="text-sm text-muted-foreground">No guilds configured.</p>
          )}

          {guilds.map((g) => {
            const e = edits[g.guild_id] ?? { bump_channel_id: '', bump_king_role_id: '' };
            const noServerId = !g.discord_server_id;
            return (
              <div key={g.guild_id} className="border rounded-lg p-3 space-y-3 bg-muted/20">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-sm">{g.guild_name}</p>
                    <p className="text-xs text-muted-foreground font-mono">{g.guild_id}</p>
                  </div>
                  {g.bump_button_message_id && (
                    <span className="text-xs text-green-600 flex items-center gap-1">
                      <Check className="h-3 w-3" /> Button installed
                    </span>
                  )}
                </div>

                {noServerId && (
                  <p className="text-xs text-orange-500">
                    ⚠️ Set Discord Server ID in this guild&apos;s settings before bumps will work.
                  </p>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs text-muted-foreground">Bump Channel ID</Label>
                    <Input
                      value={e.bump_channel_id}
                      onChange={(ev) =>
                        setEdits((prev) => ({
                          ...prev,
                          [g.guild_id]: { ...e, bump_channel_id: ev.target.value },
                        }))
                      }
                      placeholder="Channel snowflake ID"
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Bump King Role ID</Label>
                    <Input
                      value={e.bump_king_role_id}
                      onChange={(ev) =>
                        setEdits((prev) => ({
                          ...prev,
                          [g.guild_id]: { ...e, bump_king_role_id: ev.target.value },
                        }))
                      }
                      placeholder="Role snowflake ID"
                      className="mt-1"
                    />
                  </div>
                </div>

                {g.current_bump_king_discord_id && (
                  <p className="text-xs text-muted-foreground">
                    Current King: <code>{g.current_bump_king_discord_id}</code>
                  </p>
                )}

                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => save(g.guild_id)} disabled={savingId === g.guild_id}>
                    {savingId === g.guild_id ? (
                      <Loader2 className="h-3 w-3 animate-spin mr-1" />
                    ) : null}
                    Save
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => install(g.guild_id)}
                    disabled={installingId === g.guild_id}
                  >
                    {installingId === g.guild_id ? (
                      <Loader2 className="h-3 w-3 animate-spin mr-1" />
                    ) : null}
                    {g.bump_button_message_id ? 'Re-post Button' : 'Install Button'}
                  </Button>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}

export default function BumpsPage() {
  return (
    <ProtectedRoute>
      <BumpsContent />
    </ProtectedRoute>
  );
}
