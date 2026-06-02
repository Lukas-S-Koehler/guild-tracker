'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Loader2, Copy, Check, Send, X, AlertTriangle } from 'lucide-react';
import { getInactivityEmoji, formatInactivityReport, copyToClipboard } from '@/lib/utils';
import { useApiClient } from '@/lib/api-client';
import { useAuth } from '@/contexts/AuthContext';
import type { InactivityEntry } from '@/types';

export default function ReportsPage() {
  const { guilds, currentGuild } = useAuth();
  const api = useApiClient();

  const [selectedGuildId, setSelectedGuildId] = useState<string>('');
  const [entries, setEntries] = useState<InactivityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [guildName, setGuildName] = useState('Guild');
  const [hasWebhook, setHasWebhook] = useState(false);

  const [copied, setCopied] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<'ok' | 'err' | null>(null);
  const [autoWarning, setAutoWarning] = useState(false);
  const [autoWarnResult, setAutoWarnResult] = useState<'ok' | 'err' | null>(null);

  const [showWebhookInput, setShowWebhookInput] = useState(false);
  const [webhookInput, setWebhookInput] = useState('');
  const [savingWebhook, setSavingWebhook] = useState(false);
  const [webhookError, setWebhookError] = useState<string | null>(null);

  useEffect(() => {
    if (currentGuild?.guild_id && !selectedGuildId) {
      setSelectedGuildId(currentGuild.guild_id);
    }
  }, [currentGuild?.guild_id, selectedGuildId]);

  const fetchData = useCallback(
    async (guildId: string) => {
      setLoading(true);
      try {
        const [reportRes, configRes] = await Promise.all([
          api.get('/api/reports/inactivity', { guildId }),
          api.get('/api/config', { guildId }),
        ]);

        const reportData = reportRes.ok ? await reportRes.json() : [];
        const configData = configRes.ok ? await configRes.json() : {};

        setEntries(Array.isArray(reportData) ? reportData : []);
        if (configData.guild_name) setGuildName(configData.guild_name);
        setHasWebhook(!!(configData.settings?.discord_webhook_url));
      } catch (error) {
        console.error('Failed to fetch report:', error);
        setEntries([]);
      } finally {
        setLoading(false);
      }
    },
    [api]
  );

  useEffect(() => {
    if (selectedGuildId) {
      fetchData(selectedGuildId);
    }
  }, [selectedGuildId, fetchData]);

  const selectedGuildMembership = guilds.find((g) => g.guild_id === selectedGuildId);
  const canManageDiscord = selectedGuildMembership
    ? ['OFFICER', 'DEPUTY', 'LEADER'].includes(selectedGuildMembership.role)
    : false;

  const handleCopy = async () => {
    const text = formatInactivityReport(
      entries.map((e) => ({ ign: e.ign, category: e.category })),
      guildName
    );
    const ok = await copyToClipboard(text);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleSendToDiscord = async () => {
    setSending(true);
    setSendResult(null);
    try {
      const res = await api.post('/api/discord/send', {}, { guildId: selectedGuildId });
      setSendResult(res.ok ? 'ok' : 'err');
    } catch {
      setSendResult('err');
    } finally {
      setSending(false);
      setTimeout(() => setSendResult(null), 3000);
    }
  };

  const handleAutoWarn = async () => {
    setAutoWarning(true);
    setAutoWarnResult(null);
    try {
      const res = await api.post('/api/cron/auto-warn', {}, { guildId: selectedGuildId });
      setAutoWarnResult(res.ok ? 'ok' : 'err');
    } catch {
      setAutoWarnResult('err');
    } finally {
      setAutoWarning(false);
      setTimeout(() => setAutoWarnResult(null), 4000);
    }
  };

  const handleSaveWebhook = async () => {
    setWebhookError(null);
    if (!webhookInput.startsWith('https://discord.com/api/webhooks/')) {
      setWebhookError('Must be a Discord webhook URL (https://discord.com/api/webhooks/...)');
      return;
    }
    setSavingWebhook(true);
    try {
      const res = await api.post(
        '/api/discord/webhook',
        { webhook_url: webhookInput },
        { guildId: selectedGuildId }
      );
      if (res.ok) {
        setHasWebhook(true);
        setShowWebhookInput(false);
        setWebhookInput('');
      } else {
        const data = await res.json();
        setWebhookError(data.error || 'Failed to save webhook');
      }
    } catch {
      setWebhookError('Network error saving webhook');
    } finally {
      setSavingWebhook(false);
    }
  };

  const grouped = entries.reduce((acc, entry) => {
    if (!acc[entry.category]) acc[entry.category] = [];
    acc[entry.category].push(entry);
    return acc;
  }, {} as Record<string, InactivityEntry[]>);

  const categories = ['1d', '2d', '3d', '4d+'];

  const getWarningLevelColor = (warning_level: string) => {
    switch (warning_level) {
      case 'safe':
        return 'bg-green-500/20 text-green-500 border-green-500/50';
      case 'warn1':
        return 'bg-yellow-500/20 text-yellow-500 border-yellow-500/50';
      case 'warn2':
        return 'bg-orange-500/20 text-orange-500 border-orange-500/50';
      case 'kick':
        return 'bg-red-500/20 text-red-500 border-red-500/50';
      default:
        return 'bg-gray-500/20 text-gray-500 border-gray-500/50';
    }
  };

  const getWarningLevelLabel = (warning_level: string) => {
    switch (warning_level) {
      case 'warn1':
        return '⚠️ Private Warning';
      case 'warn2':
        return '⚠️ Private Warning (+optional public)';
      case 'kick':
        return '🚫 Kick from Guild';
      default:
        return '';
    }
  };

  const multiGuild = guilds.length > 1;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">📊 Inactivity Report</h1>
        <p className="text-muted-foreground">
          Members who haven&apos;t met activity requirements
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <CardTitle>
                Inactive Members{multiGuild ? ` — ${guildName}` : ''}
              </CardTitle>
              <CardDescription>
                Based on daily tracker data (excludes Leaders &amp; Deputies)
              </CardDescription>
            </div>
            <div className="flex gap-2 flex-wrap">
              <Button
                variant="outline"
                onClick={handleCopy}
                disabled={loading || entries.length === 0}
              >
                {copied ? (
                  <Check className="h-4 w-4 mr-1" />
                ) : (
                  <Copy className="h-4 w-4 mr-1" />
                )}
                {copied ? 'Copied!' : 'Copy for Discord'}
              </Button>

              {canManageDiscord && (
                <>
                  <Button
                    variant={
                      sendResult === 'ok'
                        ? 'default'
                        : sendResult === 'err'
                        ? 'destructive'
                        : 'outline'
                    }
                    onClick={
                      hasWebhook
                        ? handleSendToDiscord
                        : () => setShowWebhookInput(true)
                    }
                    disabled={sending || (hasWebhook && (loading || entries.length === 0))}
                  >
                    {sending ? (
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4 mr-1" />
                    )}
                    {sending
                      ? 'Sending…'
                      : sendResult === 'ok'
                      ? 'Sent!'
                      : sendResult === 'err'
                      ? 'Failed'
                      : hasWebhook
                      ? 'Send to Discord'
                      : 'Setup Discord'}
                  </Button>

                  <Button
                    variant={
                      autoWarnResult === 'ok'
                        ? 'default'
                        : autoWarnResult === 'err'
                        ? 'destructive'
                        : 'outline'
                    }
                    onClick={handleAutoWarn}
                    disabled={autoWarning || loading || entries.length === 0}
                    title="Auto-DM all members at warning threshold"
                  >
                    {autoWarning ? (
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    ) : (
                      <AlertTriangle className="h-4 w-4 mr-1" />
                    )}
                    {autoWarning
                      ? 'Warning…'
                      : autoWarnResult === 'ok'
                      ? 'Warned!'
                      : autoWarnResult === 'err'
                      ? 'Failed'
                      : 'Auto-Warn'}
                  </Button>
                </>
              )}
            </div>
          </div>

          {/* Webhook setup inline */}
          {showWebhookInput && canManageDiscord && (
            <div className="mt-4 space-y-2">
              <p className="text-xs text-muted-foreground">
                Paste a Discord webhook URL. Create one in Discord: Channel Settings → Integrations → Webhooks.
              </p>
              <div className="flex gap-2">
                <Input
                  placeholder="https://discord.com/api/webhooks/..."
                  value={webhookInput}
                  onChange={(e) => setWebhookInput(e.target.value)}
                  className="flex-1"
                />
                <Button onClick={handleSaveWebhook} disabled={savingWebhook}>
                  {savingWebhook ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => {
                    setShowWebhookInput(false);
                    setWebhookInput('');
                    setWebhookError(null);
                  }}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              {webhookError && (
                <p className="text-xs text-red-500">{webhookError}</p>
              )}
            </div>
          )}

          {/* Reconfigure webhook link */}
          {hasWebhook && canManageDiscord && !showWebhookInput && (
            <button
              className="text-xs text-muted-foreground underline mt-2 text-left"
              onClick={() => setShowWebhookInput(true)}
            >
              Change webhook URL
            </button>
          )}
        </CardHeader>

        <CardContent>
          {entries.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              No inactive members found! 🎉
            </p>
          ) : (
            <div className="space-y-4">
              {categories.map((cat) => {
                const members = grouped[cat];
                if (!members || members.length === 0) return null;

                const emoji = getInactivityEmoji(cat);
                const label = `${cat} Inactive`;
                const warning_level = members[0]?.warning_level || 'safe';
                const warningLabel = getWarningLevelLabel(warning_level);

                return (
                  <div key={cat} className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{emoji}</span>
                      <Badge variant="outline" className={getWarningLevelColor(warning_level)}>
                        {label}
                      </Badge>
                      {warningLabel && (
                        <span className="text-xs font-medium text-muted-foreground">
                          {warningLabel}
                        </span>
                      )}
                      <span className="text-sm text-muted-foreground">
                        ({members.length})
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2 pl-7">
                      {members.map((member) => (
                        <div
                          key={member.id}
                          className="bg-muted rounded-md px-3 py-1 text-sm flex items-center gap-1.5"
                          title={
                            member.alt_covered
                              ? 'Alt character covers this member'
                              : member.has_alts
                              ? 'Has alt characters'
                              : undefined
                          }
                        >
                          {member.ign}
                          {member.alt_covered && (
                            <span className="text-blue-400 text-xs">(alt)</span>
                          )}
                          {!member.discord_id && (
                            <span className="text-orange-400 text-xs" title="No Discord ID mapped">⚠</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}

              <div className="pt-4 border-t">
                <p className="text-sm text-muted-foreground">
                  Total inactive:{' '}
                  <span className="font-bold text-foreground">{entries.length}</span>
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="text-sm text-muted-foreground p-4 bg-muted rounded-lg space-y-3">
        <div>
          <p className="font-medium mb-1">📋 Activity Requirement</p>
          <p>A member is considered active if they meet either requirement:</p>
          <ul className="list-disc list-inside mt-1 space-y-1">
            <li>Donated 5,000+ gold in a day, OR</li>
            <li>Donated 50% or more of the daily challenge requirement</li>
          </ul>
        </div>
        <div>
          <p className="font-medium mb-1">⚠️ Warning Stages</p>
          <ul className="list-disc list-inside mt-1 space-y-1">
            <li><span className="text-green-500">1 day</span>: Safe - no action needed</li>
            <li><span className="text-yellow-500">2 days</span>: Private warning sent</li>
            <li><span className="text-orange-500">3 days</span>: Private warning + optional public</li>
            <li><span className="text-red-500">4+ days</span>: Kick from guild</li>
          </ul>
          <p className="mt-2 text-xs">
            Note: Leaders and Deputies are excluded from inactivity tracking. New members are tracked from their join date.
          </p>
        </div>
        {canManageDiscord && (
          <div>
            <p className="font-medium mb-1">🔔 Discord Integration</p>
            <p>
              {hasWebhook
                ? 'Webhook configured. Use "Send to Discord" to post the report to your channel.'
                : 'Click "Setup Discord" to configure a webhook and post reports directly to your Discord channel.'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
