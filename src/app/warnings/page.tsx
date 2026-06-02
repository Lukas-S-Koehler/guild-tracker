'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, AlertTriangle, Check, X } from 'lucide-react';
import { useApiClient } from '@/lib/api-client';
import { useAuth } from '@/contexts/AuthContext';
import ProtectedRoute from '@/components/ProtectedRoute';
import type { Warning } from '@/types';

const LEVEL_LABELS: Record<string, string> = {
  warn1: '⚠️ Warning 1',
  warn2: '⚠️⚠️ Warning 2',
  kick: '🚫 Kick Notice',
};

const LEVEL_COLORS: Record<string, string> = {
  warn1: 'bg-yellow-500/20 text-yellow-500 border-yellow-500/50',
  warn2: 'bg-orange-500/20 text-orange-500 border-orange-500/50',
  kick: 'bg-red-500/20 text-red-500 border-red-500/50',
};

function WarnModal({
  guildId,
  onClose,
  onWarned,
}: {
  guildId: string;
  onClose: () => void;
  onWarned: () => void;
}) {
  const api = useApiClient();
  const [members, setMembers] = useState<Array<{ id: string; ign: string; discord_id: string | null }>>([]);
  const [memberId, setMemberId] = useState('');
  const [level, setLevel] = useState<'warn1' | 'warn2' | 'kick'>('warn1');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get('/api/members/list', { guildId })
      .then((r) => r.json())
      .then((data) => setMembers(Array.isArray(data) ? data : []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guildId]);

  const handleSubmit = async () => {
    if (!memberId) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.post('/api/warnings', { member_id: memberId, warning_level: level, reason }, { guildId });
      if (res.ok) {
        onWarned();
        onClose();
      } else {
        const d = await res.json();
        setError(d.error || 'Failed to warn member');
      }
    } catch {
      setError('Network error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-background border rounded-lg p-6 w-full max-w-md space-y-4">
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-semibold">Warn Member</h2>
          <Button variant="ghost" size="icon" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-sm font-medium">Member</label>
            <Select value={memberId} onValueChange={setMemberId}>
              <SelectTrigger><SelectValue placeholder="Select member…" /></SelectTrigger>
              <SelectContent>
                {members.filter(m => m.ign).map(m => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.ign}{!m.discord_id ? ' (no Discord ID)' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-sm font-medium">Warning Level</label>
            <Select value={level} onValueChange={(v) => setLevel(v as typeof level)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="warn1">⚠️ Warning 1 (private)</SelectItem>
                <SelectItem value="warn2">⚠️⚠️ Warning 2 (final)</SelectItem>
                <SelectItem value="kick">🚫 Kick Notice</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-sm font-medium">Reason (optional)</label>
            <input
              className="w-full mt-1 px-3 py-2 rounded-md border bg-background text-sm"
              placeholder="e.g. 3 days inactive"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={submitting || !memberId}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Send Warning'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function WarningsContent() {
  const { guilds, currentGuild } = useAuth();
  const api = useApiClient();

  const [selectedGuildId, setSelectedGuildId] = useState('');
  const [warnings, setWarnings] = useState<Warning[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [levelFilter, setLevelFilter] = useState('all');
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    if (currentGuild?.guild_id && !selectedGuildId) {
      setSelectedGuildId(currentGuild.guild_id);
    }
  }, [currentGuild?.guild_id, selectedGuildId]);

  const fetchWarnings = useCallback(async (guildId: string) => {
    if (!guildId) return;
    setLoading(true);
    try {
      const params = levelFilter !== 'all' ? `?level=${levelFilter}` : '';
      const res = await api.get(`/api/warnings${params}`, { guildId });
      if (res.ok) {
        const data = await res.json();
        setWarnings(data.warnings ?? []);
        setTotal(data.total ?? 0);
      }
    } catch {
      setWarnings([]);
    } finally {
      setLoading(false);
    }
  }, [api, levelFilter]);

  useEffect(() => {
    if (selectedGuildId) fetchWarnings(selectedGuildId);
  }, [selectedGuildId, fetchWarnings]);

  const selectedMembership = guilds.find((g) => g.guild_id === selectedGuildId);
  const canWarn = selectedMembership
    ? ['OFFICER', 'DEPUTY', 'LEADER'].includes(selectedMembership.role)
    : false;

  const multiGuild = guilds.length > 1;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold">⚠️ Warning History</h1>
          <p className="text-muted-foreground">Track warnings issued to guild members</p>
        </div>
        {canWarn && (
          <Button onClick={() => setShowModal(true)}>
            <AlertTriangle className="h-4 w-4 mr-1" />
            Warn Member
          </Button>
        )}
      </div>

      <div className="flex gap-2 flex-wrap">
        {multiGuild && (
          <Select value={selectedGuildId} onValueChange={setSelectedGuildId}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Guild…" /></SelectTrigger>
            <SelectContent>
              {guilds.map((g) => (
                <SelectItem key={g.guild_id} value={g.guild_id}>{g.guild_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Select value={levelFilter} onValueChange={setLevelFilter}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Levels</SelectItem>
            <SelectItem value="warn1">⚠️ Warning 1</SelectItem>
            <SelectItem value="warn2">⚠️⚠️ Warning 2</SelectItem>
            <SelectItem value="kick">🚫 Kick Notice</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Warnings {total > 0 && `(${total})`}</CardTitle>
          <CardDescription>Most recent first</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : warnings.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No warnings found.</p>
          ) : (
            <div className="space-y-2">
              {warnings.map((w) => (
                <div
                  key={w.id}
                  className="flex items-start justify-between gap-3 p-3 rounded-lg border bg-muted/30"
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{(w.members as { ign: string } | undefined)?.ign ?? '—'}</span>
                      <Badge variant="outline" className={LEVEL_COLORS[w.warning_level]}>
                        {LEVEL_LABELS[w.warning_level]}
                      </Badge>
                      {w.is_auto && (
                        <Badge variant="outline" className="text-xs text-muted-foreground">auto</Badge>
                      )}
                    </div>
                    {w.reason && (
                      <p className="text-sm text-muted-foreground">{w.reason}</p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {new Date(w.created_at).toLocaleString()}
                      {w.warned_by_ign && ` · by ${w.warned_by_ign}`}
                    </p>
                  </div>
                  <div className="shrink-0 flex items-center gap-1 text-xs text-muted-foreground">
                    {w.discord_dm_sent ? (
                      <span className="flex items-center gap-1 text-green-500">
                        <Check className="h-3 w-3" /> DM sent
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-muted-foreground">
                        <X className="h-3 w-3" /> No DM
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {showModal && selectedGuildId && (
        <WarnModal
          guildId={selectedGuildId}
          onClose={() => setShowModal(false)}
          onWarned={() => fetchWarnings(selectedGuildId)}
        />
      )}
    </div>
  );
}

export default function WarningsPage() {
  return (
    <ProtectedRoute requiredRole="MEMBER">
      <WarningsContent />
    </ProtectedRoute>
  );
}
