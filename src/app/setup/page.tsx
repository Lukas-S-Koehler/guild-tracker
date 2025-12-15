'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Check, AlertCircle } from 'lucide-react';

export default function SetupPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [config, setConfig] = useState({
    guild_name: '',
    api_key: '',
    donation_requirement: 5000,
  });

  useEffect(() => {
    async function fetchConfig() {
      try {
        const res = await fetch('/api/config');
        const data = await res.json();

        if (data.api_key) {
          setConfig({
            guild_name: data.guild_name || '',
            api_key: data.api_key,
            donation_requirement: data.donation_requirement || 5000,
          });
        }
      } catch (err) {
        console.error('Failed to fetch config:', err);
      } finally {
        setLoading(false);
      }
    }
    fetchConfig();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);

    // 🚨 Validation Updated: Check api_key and guild_name
    if (!config.api_key || !config.guild_name) {
      setError('API key and Guild Name are required');
      setSaving(false);
      return;
    }

    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });

      if (!res.ok) {
        // Attempt to parse JSON error message
        let data;
        try {
            data = await res.json();
        } catch {
            throw new Error(`Server returned status ${res.status}, but response was not valid JSON.`);
        }
        throw new Error(data.error || 'Failed to save');
      }

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

      <Card>
        <CardHeader>
          <CardTitle>Guild Settings</CardTitle>
          <CardDescription>Basic configuration for your guild</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="guild_name">Guild Name</Label>
            <Input
              id="guild_name"
              placeholder="My Awesome Guild"
              value={config.guild_name}
              onChange={(e) => setConfig({ ...config, guild_name: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="donation_req">Donation Requirement (gold)</Label>
            <Input
              id="donation_req"
              type="number"
              min="0"
              value={config.donation_requirement}
              onChange={(e) => setConfig({ ...config, donation_requirement: parseInt(e.target.value) || 0 })}
            />
            <p className="text-xs text-muted-foreground">
              Members donating this much gold will be marked as meeting the requirement
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>IdleMMO API Key</CardTitle>
          <CardDescription>Required for fetching market prices</CardDescription>
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
              Get your API key from IdleMMO settings. Used only for market price lookups.
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