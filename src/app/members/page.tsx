'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, Users, Settings } from 'lucide-react';
import { useApiClient } from '@/lib/api-client';

interface GuildMember {
  idlemmo_id: string;
  ign: string;
  position: 'LEADER' | 'DEPUTY' | 'OFFICER' | 'RECRUIT';
  avatar_url: string | null;
  total_level: number;
}

export default function MembersPage() {
  const [members, setMembers] = useState<GuildMember[]>([]);
  const [guildName, setGuildName] = useState<string>('Guild');
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const api = useApiClient();

  async function loadMembers() {
    try {
      setLoading(true);

      // Load config
      const configRes = await api.get('/api/config');
      const config = await configRes.json();
      console.log('CONFIG RESPONSE:', config);

      if (!config.guild_id) {
        setError('Missing guild ID. Please configure your settings.');
        setLoading(false);
        return;
      }

      setGuildName(config.guild_name || 'Guild');

      // Load members
      const res = await api.get('/api/members/list');
      const raw = await res.text();
      console.log('RAW /api/members/list RESPONSE:', raw);

      let data;
      try {
        data = JSON.parse(raw);
      } catch (err) {
        console.error('❌ Failed to parse JSON from /api/members/list:', err);
        setError('Invalid JSON from members API');
        setLoading(false);
        return;
      }

      console.log('PARSED DATA TYPE:', Array.isArray(data) ? 'array' : typeof data);
      console.log('PARSED DATA CONTENT:', data);

      // Handle wrapped shape { data: [...] }
      if (!Array.isArray(data) && Array.isArray(data?.data)) {
        console.log('Detected wrapped { data: [...] } shape, unwrapping...');
        data = data.data;
      }

      if (!Array.isArray(data)) {
        setError('Failed to load members from database.');
        setLoading(false);
        return;
      }

      const roleOrder: Record<string, number> = {
        LEADER: 1,
        DEPUTY: 2,
        OFFICER: 3,
        RECRUIT: 4,
      };

      data.sort((a: GuildMember, b: GuildMember) => {
        const roleDiff = roleOrder[a.position] - roleOrder[b.position];
        if (roleDiff !== 0) return roleDiff;
        return b.total_level - a.total_level;
      });

      console.log('SORTED MEMBERS:', data);
      setMembers(data);
      console.log('STATE SET: members length =', data.length);
    } catch (err: any) {
      console.error('❌ loadMembers error:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function syncMembers() {
    try {
      setSyncing(true);
      const res = await api.post('/api/members/sync');
      console.log('SYNC RESPONSE STATUS:', res.status);
      const syncText = await res.text();
      console.log('SYNC RAW RESPONSE:', syncText);
      await loadMembers();
    } catch (err: any) {
      console.error('❌ syncMembers error:', err);
      setError('Failed to sync members.');
    } finally {
      setSyncing(false);
    }
  }

  useEffect(() => {
    loadMembers();
  }, []);



  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-md mx-auto mt-20">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Members
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-red-500">{error}</p>
            <Button asChild className="w-full">
              <Link href="/setup">Configure Settings</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{guildName} Members</h1>
          <p className="text-muted-foreground">
            View and manage your guild roster
          </p>
        </div>

        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link href="/setup">
              <Settings className="h-4 w-4 mr-2" />
              Settings
            </Link>
          </Button>

          <Button onClick={syncMembers} disabled={syncing}>
            {syncing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Syncing...
              </>
            ) : (
              <>🔄 Sync Members</>
            )}
          </Button>
        </div>
      </div>

      {/* Members List */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Guild Members ({members.length})
          </CardTitle>
        </CardHeader>

        <CardContent>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-gray-700 text-left">
                  <th className="py-2 px-3">Avatar</th>
                  <th className="py-2 px-3">IGN</th>
                  <th className="py-2 px-3">Level</th>
                  <th className="py-2 px-3">Role</th>
                </tr>
              </thead>

              <tbody>
                {members.map(member => (
                  <tr key={member.idlemmo_id} className="border-b border-gray-800">
                    <td className="py-2 px-3">
                      {member.avatar_url ? (
                        <img
                          src={member.avatar_url}
                          alt={member.ign}
                          className="w-10 h-10 rounded"
                        />
                      ) : (
                        <div className="w-10 h-10 bg-gray-700 rounded" />
                      )}
                    </td>

                    <td className="py-2 px-3 font-medium">{member.ign}</td>
                    <td className="py-2 px-3">{member.total_level}</td>
                    <td className="py-2 px-3">{member.position}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
