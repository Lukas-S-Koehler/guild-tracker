'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Check, AlertCircle, Key } from 'lucide-react';
import ProtectedRoute from '@/components/ProtectedRoute';
import { useApiClient } from '@/lib/api-client';
import { useAuth } from '@/contexts/AuthContext';

function SetupPageContent() {
  const router = useRouter();
  const api = useApiClient();
  const { currentGuild, hasRole } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Member API key state
  const [apiKey, setApiKey] = useState('');
  const [hasExistingKey, setHasExistingKey] = useState(false);

  // Guild config state (LEADER/DEPUTY only)
  const [donationReq, setDonationReq] = useState(5000);
  const [allowChallengeQty, setAllowChallengeQty] = useState(false);
  const [activeBuildings, setActiveBuildings] = useState<string[]>([]);
  const [availableBuildings, setAvailableBuildings] = useState<any[]>([]);
  const [savingConfig, setSavingConfig] = useState(false);

  const isLeaderOrDeputy = hasRole('DEPUTY');

  useEffect(() => {
    async function fetchData() {
      try {
        // Fetch member's API key (works even without guild)
        const keyRes = await api.get('/api/member-keys');
        if (keyRes.ok) {
          const keyData = await keyRes.json();
          if (keyData.has_key) {
            setApiKey(keyData.api_key);
            setHasExistingKey(true);
          }
        }

        // Fetch guild config (for donation requirement) if LEADER/DEPUTY and has guild
        if (currentGuild && isLeaderOrDeputy) {
          const [configRes, buildingsRes] = await Promise.all([
            api.get('/api/config'),
            api.get('/api/guild-buildings')
          ]);

          if (configRes.ok) {
            const configData = await configRes.json();
            setDonationReq(configData.donation_requirement || 5000);
            setAllowChallengeQty(configData.settings?.allow_challenge_quantity_requirement || false);
            setActiveBuildings(configData.settings?.active_buildings || []);
          }

          if (buildingsRes.ok) {
            const buildings = await buildingsRes.json();
            setAvailableBuildings(buildings);
          }
        }
      } catch (err) {
        console.error('Failed to fetch data:', err);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [api, currentGuild, isLeaderOrDeputy]);

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

  const handleSaveGuildConfig = async () => {
    setSavingConfig(true);
    setError(null);
    setSuccess(null);

    try {
      // Get current config to preserve other fields
      const configRes = await api.get('/api/config');
      const configData = await configRes.json();

      const payload = {
        guild_name: configData.guild_name || currentGuild?.guild_name || '',
        guild_id: currentGuild?.guild_id || '',
        api_key: configData.api_key || 'placeholder', // Keep existing or use placeholder
        donation_requirement: donationReq,
        settings: {
          daily_donation_requirement: donationReq,
          allow_challenge_quantity_requirement: allowChallengeQty,
          active_buildings: activeBuildings,
        },
      };

      const res = await api.post('/api/config', payload);
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || 'Failed to save');

      setSuccess('Guild settings saved successfully!');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSavingConfig(false);
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
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-muted-foreground">
          Configure your personal API key{isLeaderOrDeputy ? ' and guild settings' : ''}
        </p>
      </div>

      {/* Personal API Key */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="h-5 w-5" />
            Your IdleMMO API Key
          </CardTitle>
          <CardDescription>
            Required for processing activity logs and managing challenges. Each member uses their own API key.
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
              Get your personal API key from{' '}
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
              <p className="text-xs text-green-600">
                ✓ You have an API key configured
              </p>
            )}
          </div>

          <Button onClick={handleSaveApiKey} disabled={saving} className="w-full">
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              hasExistingKey ? 'Update API Key' : 'Save API Key'
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Guild Settings - Only for LEADER/DEPUTY */}
      {isLeaderOrDeputy && (
        <Card>
          <CardHeader>
            <CardTitle>Guild Settings</CardTitle>
            <CardDescription>Configure guild-wide settings (DEPUTY/LEADER only)</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="donation_req">Daily Gold Requirement</Label>
              <Input
                id="donation_req"
                type="number"
                min="0"
                value={donationReq}
                onChange={(e) => setDonationReq(parseInt(e.target.value) || 0)}
              />
              <p className="text-xs text-muted-foreground">
                Total gold from challenge donations + valid guild hall deposits needed to meet requirement
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <input
                  id="allow_challenge_qty"
                  type="checkbox"
                  checked={allowChallengeQty}
                  onChange={(e) => setAllowChallengeQty(e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300"
                />
                <Label htmlFor="allow_challenge_qty" className="cursor-pointer">
                  Allow 50% Challenge Item Quantity Requirement
                </Label>
              </div>
              <p className="text-xs text-muted-foreground">
                When enabled, members can meet requirement by donating 50% of any challenge item's initial quantity
              </p>
            </div>

            <div className="space-y-2">
              <Label>Active Guild Buildings (for Deposit Verification)</Label>
              <p className="text-xs text-muted-foreground mb-2">
                Select which building(s) you're working on. Only deposits of resources needed for these buildings will count toward the gold requirement.
              </p>
                <div className="space-y-2 max-h-64 overflow-y-auto border rounded p-3">
                  {availableBuildings.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Loading buildings...</p>
                  ) : (
                    availableBuildings.map((building) => (
                      <div key={building.id} className="flex items-start gap-2">
                        <input
                          id={`building_${building.id}`}
                          type="checkbox"
                          checked={activeBuildings.includes(building.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setActiveBuildings([...activeBuildings, building.id]);
                            } else {
                              setActiveBuildings(activeBuildings.filter(id => id !== building.id));
                            }
                          }}
                          className="w-4 h-4 rounded border-gray-300 mt-0.5"
                        />
                        <Label htmlFor={`building_${building.id}`} className="cursor-pointer flex-1">
                          <div className="font-medium">{building.name}</div>
                          <div className="text-xs text-muted-foreground">
                            Level {building.guild_level_required} • {building.mark_cost} Marks • {building.resources?.length || 0} resources
                          </div>
                        </Label>
                      </div>
                    ))
                  )}
                </div>
                {activeBuildings.length === 0 && (
                  <p className="text-xs text-amber-600">
                    ⚠️ No buildings selected. Guild hall deposits will not count toward the gold requirement.
                  </p>
                )}
              </div>

            <Button onClick={handleSaveGuildConfig} disabled={savingConfig} className="w-full">
              {savingConfig ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save Guild Settings'
              )}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Info Card */}
      <Card className="bg-muted/50">
        <CardContent className="pt-6 space-y-2">
          <p className="text-sm font-medium">About API Keys:</p>
          <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
            <li>Each member needs their own IdleMMO API key</li>
            <li>You can view guild data without an API key</li>
            <li>API key is required for processing activity logs and managing challenges</li>
            <li>Your API key is never shared with other members</li>
          </ul>
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
        <Button variant="outline" onClick={() => router.push('/')} className="flex-1">
          Back to Dashboard
        </Button>
      </div>
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
