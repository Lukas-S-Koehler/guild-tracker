'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Check, AlertCircle, Key } from 'lucide-react';
import ProtectedRoute from '@/components/ProtectedRoute';
import { useApiClient } from '@/lib/api-client';

function SetupPageContent() {
  const api = useApiClient();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [hasExistingKey, setHasExistingKey] = useState(false);

  useEffect(() => {
    async function fetchData() {
      try {
        const keyRes = await api.get('/api/member-keys');
        if (keyRes.ok) {
          const keyData = await keyRes.json();
          if (keyData.has_key) {
            setApiKey(keyData.api_key);
            setHasExistingKey(true);
          }
        }
      } catch (err) {
        console.error('Failed to fetch API key:', err);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [api]);

  const handleSaveApiKey = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);

    if (!apiKey) {
      setError('Please enter an API key');
      setSaving(false);
      return;
    }

    try {
      const res = await api.post('/api/member-keys', { api_key: apiKey });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save');
      setSuccess('API key saved successfully!');
      setHasExistingKey(true);
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
    <div className="max-w-lg mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Personal Settings</h1>
        <p className="text-muted-foreground">
          Configure your personal IdleMMO API key for challenge management and item price lookups.
        </p>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 bg-destructive/10 text-destructive rounded-lg text-sm">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {success && (
        <div className="flex items-center gap-2 p-3 bg-green-500/10 text-green-600 rounded-lg text-sm">
          <Check className="h-4 w-4 flex-shrink-0" />
          {success}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="h-5 w-5" />
            Your IdleMMO API Key
          </CardTitle>
          <CardDescription>
            Used for item price lookups when managing challenges. Each member uses their own key.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="api_key">API Key</Label>
            <Input
              id="api_key"
              type="text"
              placeholder="idlemmo_xxxxx..."
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Get your key from{' '}
              <a
                href="https://web.idle-mmo.com/settings/api"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-primary"
              >
                idle-mmo.com/settings/api
              </a>
            </p>
            {hasExistingKey && (
              <p className="text-xs text-green-600">✓ API key configured</p>
            )}
          </div>

          <Button onClick={handleSaveApiKey} disabled={saving}>
            {saving ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving...</>
            ) : (
              hasExistingKey ? 'Update API Key' : 'Save API Key'
            )}
          </Button>
        </CardContent>
      </Card>

      <Card className="bg-muted/50">
        <CardContent className="pt-6 space-y-2">
          <p className="text-sm font-medium">Guild settings are now in Admin</p>
          <p className="text-sm text-muted-foreground">
            API keys for automated activity fetching, donation requirements, and building settings
            are managed per-guild by the admin. Contact your guild leader if settings need updating.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

export default function SetupPage() {
  return (
    <ProtectedRoute requiredRole="MEMBER">
      <SetupPageContent />
    </ProtectedRoute>
  );
}
