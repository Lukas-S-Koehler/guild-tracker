'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Loader2, Trash2, ArrowLeft, Plus, AlertCircle, Check } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import ProtectedRoute from '@/components/ProtectedRoute';

interface RaidReminder {
  id: string;
  name: string;
  time_utc: string;
  discord_channel_id: string;
  message: string;
  role_ping_id: string | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

function pad(n: number) { return String(n).padStart(2, '0'); }

// UTC HH:MM:SS → local HH:MM for display
function utcToLocalHHMM(utc: string): string {
  const [h, m] = utc.split(':').map(Number);
  const d = new Date();
  d.setUTCHours(h, m, 0, 0);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// local HH:MM → UTC HH:MM:00 for storage
function localHHMMToUtc(local: string): string {
  const [h, m] = local.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:00`;
}

function RaidRemindersContent() {
  const { isSuperAdmin, loading: authLoading } = useAuth();
  const [reminders, setReminders] = useState<RaidReminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Create form state
  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [formName, setFormName] = useState('');
  const [formTime, setFormTime] = useState('');
  const [formChannelId, setFormChannelId] = useState('');
  const [formMessage, setFormMessage] = useState('');
  const [formRoleId, setFormRoleId] = useState('');

  const showMsg = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 4000);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/raid-reminders', { cache: 'no-store' });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to load');
      setReminders(await res.json());
    } catch (e) {
      showMsg('error', String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (isSuperAdmin) load(); }, [isSuperAdmin, load]);

  const resetForm = () => {
    setFormName(''); setFormTime(''); setFormChannelId('');
    setFormMessage(''); setFormRoleId('');
  };

  const handleCreate = async () => {
    if (!formName || !formTime || !formChannelId || !formMessage) {
      showMsg('error', 'Fill name, time, channel ID, message');
      return;
    }
    setCreating(true);
    try {
      const res = await fetch('/api/raid-reminders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formName,
          time_utc: localHHMMToUtc(formTime),
          discord_channel_id: formChannelId,
          message: formMessage,
          role_ping_id: formRoleId || null,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed');
      showMsg('success', 'Reminder created');
      resetForm();
      setShowForm(false);
      await load();
    } catch (e) {
      showMsg('error', String(e));
    } finally {
      setCreating(false);
    }
  };

  const handleToggle = async (r: RaidReminder) => {
    const res = await fetch(`/api/raid-reminders/${r.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !r.enabled }),
    });
    if (!res.ok) { showMsg('error', (await res.json()).error ?? 'Toggle failed'); return; }
    await load();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this reminder?')) return;
    const res = await fetch(`/api/raid-reminders/${id}`, { method: 'DELETE' });
    if (!res.ok) { showMsg('error', (await res.json()).error ?? 'Delete failed'); return; }
    showMsg('success', 'Deleted');
    await load();
  };

  if (authLoading) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  }

  if (!isSuperAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold">Access Denied</h1>
          <p className="text-muted-foreground">Super admin only.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 sm:p-6 max-w-4xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/admin" className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 mb-1">
            <ArrowLeft className="h-3 w-3" /> Back to admin
          </Link>
          <h1 className="text-2xl font-bold">Raid Reminders</h1>
          <p className="text-sm text-muted-foreground">Minute-precise Discord pings via Supabase pg_cron. Times shown/entered in your device local time; stored as UTC.</p>
        </div>
        <Button onClick={() => setShowForm(v => !v)} size="sm">
          <Plus className="h-4 w-4 mr-1" /> {showForm ? 'Cancel' : 'New'}
        </Button>
      </div>

      {message && (
        <div className={`flex items-start gap-2 p-2 rounded text-sm ${message.type === 'success' ? 'bg-green-500/10 text-green-600' : 'bg-destructive/10 text-destructive'}`}>
          {message.type === 'success' ? <Check className="h-3 w-3 mt-0.5" /> : <AlertCircle className="h-3 w-3 mt-0.5" />}
          {message.text}
        </div>
      )}

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">New reminder</CardTitle>
            <CardDescription className="text-xs">Time is device-local; converted to UTC on save.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label htmlFor="rr-name">Name</Label>
                <Input id="rr-name" value={formName} onChange={e => setFormName(e.target.value)} placeholder="Monday raid" />
              </div>
              <div>
                <Label htmlFor="rr-time">Time (your local)</Label>
                <Input id="rr-time" type="time" value={formTime} onChange={e => setFormTime(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="rr-channel">Discord channel ID</Label>
                <Input id="rr-channel" value={formChannelId} onChange={e => setFormChannelId(e.target.value)} placeholder="123456789012345678" />
              </div>
              <div>
                <Label htmlFor="rr-role">Role ping ID (optional)</Label>
                <Input id="rr-role" value={formRoleId} onChange={e => setFormRoleId(e.target.value)} placeholder="123456789012345678" />
              </div>
            </div>
            <div>
              <Label htmlFor="rr-msg">Message</Label>
              <Textarea id="rr-msg" value={formMessage} onChange={e => setFormMessage(e.target.value)} rows={3} placeholder="Raid starting in 15 minutes!" />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => { resetForm(); setShowForm(false); }}>Cancel</Button>
              <Button size="sm" onClick={handleCreate} disabled={creating}>
                {creating && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
                Create
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Reminders ({reminders.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin" /></div>
          ) : reminders.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No reminders yet.</p>
          ) : (
            <div className="space-y-2">
              {reminders.map(r => (
                <div key={r.id} className="flex items-center gap-3 p-3 border rounded-lg">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">{r.name}</span>
                      {r.enabled
                        ? <Badge variant="outline" className="text-xs bg-green-500/10 text-green-600 border-green-500/30">ON</Badge>
                        : <Badge variant="outline" className="text-xs bg-muted text-muted-foreground">OFF</Badge>}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      <span className="font-mono">{utcToLocalHHMM(r.time_utc)}</span> local
                      <span className="mx-1">·</span>
                      <span className="font-mono">{r.time_utc.slice(0, 5)}</span> UTC
                      <span className="mx-1">·</span>
                      channel <span className="font-mono">{r.discord_channel_id}</span>
                      {r.role_ping_id && <><span className="mx-1">·</span>role <span className="font-mono">{r.role_ping_id}</span></>}
                    </div>
                    <div className="text-xs mt-1 whitespace-pre-wrap">{r.message}</div>
                  </div>
                  <div className="flex flex-col gap-1 shrink-0">
                    <Button size="sm" variant="outline" onClick={() => handleToggle(r)}>
                      {r.enabled ? 'Disable' : 'Enable'}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => handleDelete(r.id)}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function RaidRemindersPage() {
  return (
    <ProtectedRoute requiredRole="LEADER">
      <RaidRemindersContent />
    </ProtectedRoute>
  );
}
