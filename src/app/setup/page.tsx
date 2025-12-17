'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

// Force dynamic rendering, disable all caching
export const dynamic = 'force-dynamic';
export const revalidate = 0;
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Check, AlertCircle } from 'lucide-react';
import ProtectedRoute from '@/components/ProtectedRoute';
import { useApiClient } from '@/lib/api-client';
import { useAuth } from '@/contexts/AuthContext';

interface Guild {
  id: string;
  name: string;
  nickname: string;
  min_level: number;
}

function SetupPageContent() {
  const router = useRouter();
  const api = useApiClient();
  const { currentGuild } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [guilds, setGuilds] = useState<Guild[]>([]);

  const [config, setConfig] = useState({
    guild_id: '',
    api_key: '',
    donation_requirement: 5000,
  });

  useEffect(() => {
    // Don't fetch config until we have a current guild
    if (!currentGuild) return;

    async function fetchData() {
      try {
        const [configRes, guildsRes] = await Promise.all([
          api.get('/api/config'),
          api.get('/api/guilds'),
        ]);

        const configData = await configRes.json();
        const guildsData = await guildsRes.json();

        setGuilds(Array.isArray(guildsData) ? guildsData : []);
        setConfig({
          guild_id: configData.guild_id || currentGuild?.guild_id || '',
          api_key: configData.api_key || '',
          donation_requirement: configData.donation_requirement || 5000,
        });
      } catch (err) {
        console.error('Failed to fetch data:', err);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [api, currentGuild]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);

    if (!config.api_key || !config.guild_id) {
      setError('Please select a guild and enter an API key');
      setSaving(false);
      return;
    }

    try {
      // Get guild name from selected guild
      const selectedGuild = guilds.find(g => g.id === config.guild_id);
      const payload = {
        ...config,
        guild_name: selectedGuild?.name || '',
      };

      const res = await api.post('/api/config', payload);

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save');

      setSuccess('Configuration saved!');
      setTimeout(() => router.push('/'), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Setup</h1>
        <p className="text-muted-foreground">Configure your guild tracker settings</p>
      </div>

      {/* Guild Settings */}
      <Card>
        <CardHeader>
          <CardTitle>Guild Settings</CardTitle>
          <CardDescription>Select your guild and configure settings</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">

          <div className="space-y-2">
            <Label htmlFor="guild_select">Select Guild</Label>
            <Select value={config.guild_id} onValueChange={(value) => setConfig({ ...config, guild_id: value })}>
              <SelectTrigger id="guild_select">
                <SelectValue placeholder="Choose your guild..." />
              </SelectTrigger>
              <SelectContent>
                {guilds.map((guild) => (
                  <SelectItem key={guild.id} value={guild.id}>
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold">{guild.nickname}</span>
                      <span>-</span>
                      <span>{guild.name}</span>
                      <span className="text-xs text-muted-foreground">(Level {guild.min_level}+)</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Select the guild you want to configure. Guild ID is automatically set.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="donation_req">Donation Requirement (gold)</Label>
            <Input
              id="donation_req"
              type="number"
              min="0"
              value={config.donation_requirement}
              onChange={(e) =>
                setConfig({ ...config, donation_requirement: parseInt(e.target.value) || 0 })
              }
            />
            <p className="text-xs text-muted-foreground">
              Minimum daily gold donation to be considered active
            </p>
          </div>

        </CardContent>
      </Card>

      {/* API Key */}
      <Card>
        <CardHeader>
          <CardTitle>IdleMMO API Key</CardTitle>
          <CardDescription>Required for syncing members and fetching market prices</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="api_key">API Key</Label>
            <Input
              id="api_key"
              type="password"
              placeholder="idlemmo_xxxxx..."
              value={config.api_key}
              onChange={(e) => setConfig({ ...config, api_key: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              Get your API key from{' '}
              <a
                href="https://idle-mmo.com/account/api-tokens"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-primary"
              >
                idle-mmo.com/account/api-tokens
              </a>
            </p>
          </div>
        </CardContent>
      </Card>

      {error && (
        <div className="flex items-center gap-2 p-4 bg-destructive/10 text-destructive rounded-lg">
          <AlertCircle className="h-4 w-4" />
          {error}
        </div>
      )}

      {success && (
        <div className="flex items-center gap-2 p-4 bg-green-500/10 text-green-500 rounded-lg">
          <Check className="h-4 w-4" />
          {success}
        </div>
      )}

      <div className="flex gap-3">
        <Button onClick={handleSave} disabled={saving} className="flex-1">
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Saving...
            </>
          ) : (
            'Save Configuration'
          )}
        </Button>
        <Button variant="outline" onClick={() => router.push('/')}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

export default function SetupPage() {
  return (
    <ProtectedRoute requiredRole="LEADER">
      <SetupPageContent />
    </ProtectedRoute>
  );
}
