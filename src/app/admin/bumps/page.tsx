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

interface BumpConfig {
  bump_server_id: string;
  bump_channel_id: string;
  bump_king_role_id: string;
  bump_button_message_id: string;
  current_bump_king_discord_id: string;
}

const BLANK: BumpConfig = {
  bump_server_id: '',
  bump_channel_id: '',
  bump_king_role_id: '',
  bump_button_message_id: '',
  current_bump_king_discord_id: '',
};

function BumpsContent() {
  const { isSuperAdmin, loading: authLoading } = useAuth();
  const [config, setConfig] = useState<BumpConfig>(BLANK);
  const [edit, setEdit] = useState<BumpConfig>(BLANK);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

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
      const c: BumpConfig = { ...BLANK, ...(data.config ?? {}) };
      setConfig(c);
      setEdit(c);
    } catch (e) {
      showMsg('error', String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!authLoading && isSuperAdmin) load();
  }, [authLoading, isSuperAdmin, load]);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/admin/bump-install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bump_server_id: edit.bump_server_id,
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
      setSaving(false);
    }
  };

  const install = async () => {
    if (!edit.bump_channel_id) {
      showMsg('error', 'Enter Bump Channel ID first');
      return;
    }
    setInstalling(true);
    try {
      const res = await fetch('/api/admin/bump-install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bump_server_id: edit.bump_server_id,
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
      setInstalling(false);
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
    <div className="space-y-4 max-w-2xl mx-auto p-4">
      <Link href="/admin">
        <Button size="sm" variant="ghost">
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Button>
      </Link>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Rocket className="h-4 w-4" />
            Bump Tracker
          </CardTitle>
          <CardDescription className="text-xs">
            One global tally across the family of guilds. Members click the button in the chosen channel after bumping the ad in the main IdleMMO Discord. 2h cooldown. Monthly top bumper gets the Bump King role.
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

          <div>
            <Label className="text-xs text-muted-foreground">Discord Server ID (where role is granted)</Label>
            <Input
              value={edit.bump_server_id}
              onChange={(e) => setEdit({ ...edit, bump_server_id: e.target.value })}
              placeholder="Server snowflake ID"
              className="mt-1"
            />
          </div>

          <div>
            <Label className="text-xs text-muted-foreground">Bump Channel ID (where button + announcements post)</Label>
            <Input
              value={edit.bump_channel_id}
              onChange={(e) => setEdit({ ...edit, bump_channel_id: e.target.value })}
              placeholder="Channel snowflake ID"
              className="mt-1"
            />
          </div>

          <div>
            <Label className="text-xs text-muted-foreground">Bump King Role ID (awarded monthly)</Label>
            <Input
              value={edit.bump_king_role_id}
              onChange={(e) => setEdit({ ...edit, bump_king_role_id: e.target.value })}
              placeholder="Role snowflake ID"
              className="mt-1"
            />
          </div>

          {config.bump_button_message_id && (
            <p className="text-xs text-muted-foreground">
              Button installed (message ID: <code>{config.bump_button_message_id}</code>)
            </p>
          )}
          {config.current_bump_king_discord_id && (
            <p className="text-xs text-muted-foreground">
              Current Bump King: <code>{config.current_bump_king_discord_id}</code>
            </p>
          )}

          <div className="flex flex-wrap gap-2 pt-2">
            <Button size="sm" onClick={save} disabled={saving}>
              {saving ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
              Save
            </Button>
            <Button size="sm" variant="outline" onClick={install} disabled={installing}>
              {installing ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
              {config.bump_button_message_id ? 'Re-post Button' : 'Install Button'}
            </Button>
            <Button size="sm" variant="outline" onClick={registerCmd} disabled={registering}>
              {registering ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
              Register /bumps Command
            </Button>
          </div>
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
