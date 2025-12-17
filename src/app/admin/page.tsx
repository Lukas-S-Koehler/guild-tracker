'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, UserPlus, Trash2, Shield, Crown, Users, AlertCircle, Check, ChevronDown, ChevronRight } from 'lucide-react';
import { useApiClient } from '@/lib/api-client';
import ProtectedRoute from '@/components/ProtectedRoute';

interface GuildMember {
  user_id: string;
  email: string;
  display_name: string;
  role: 'MEMBER' | 'OFFICER' | 'DEPUTY' | 'LEADER';
  joined_at: string;
}

interface Guild {
  id: string;
  name: string;
  nickname: string;
  min_level: number;
  display_order: number;
  members: GuildMember[];
  leader?: GuildMember;
  deputy?: GuildMember;
  officers: GuildMember[];
  member_count: number;
}

function AdminPageContent() {
  const api = useApiClient();
  const [guilds, setGuilds] = useState<Guild[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [expandedGuild, setExpandedGuild] = useState<string | null>(null);

  // Add user form state
  const [addingToGuild, setAddingToGuild] = useState<string | null>(null);
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserRole, setNewUserRole] = useState<'MEMBER' | 'OFFICER' | 'DEPUTY' | 'LEADER'>('MEMBER');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchGuilds();
  }, [api]);

  async function fetchGuilds() {
    setLoading(true);
    try {
      const res = await api.get('/api/admin/all-guilds');
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to fetch guilds');
      }
      const data = await res.json();
      setGuilds(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to fetch guilds:', err);
      setError(err instanceof Error ? err.message : 'Failed to load guilds');
    } finally {
      setLoading(false);
    }
  }

  const handleAddUser = async (guildId: string) => {
    if (!newUserEmail) {
      setError('Please enter an email address');
      return;
    }

    setSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await api.post('/api/admin/guild-users', {
        email: newUserEmail,
        role: newUserRole,
        target_guild_id: guildId,
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to add user');
      }

      setSuccess(`Successfully added ${newUserEmail} to guild`);
      setNewUserEmail('');
      setNewUserRole('MEMBER');
      setAddingToGuild(null);

      // Refresh guilds
      await fetchGuilds();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add user');
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdateRole = async (guildId: string, userId: string, newRole: 'MEMBER' | 'OFFICER' | 'DEPUTY' | 'LEADER') => {
    setError(null);
    setSuccess(null);

    try {
      const res = await api.patch('/api/admin/guild-users', {
        user_id: userId,
        role: newRole,
        target_guild_id: guildId,
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to update role');
      }

      setSuccess('Role updated successfully');
      await fetchGuilds();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update role');
    }
  };

  const handleRemoveUser = async (guildId: string, userId: string, email: string) => {
    if (!confirm(`Remove ${email} from this guild?`)) {
      return;
    }

    setError(null);
    setSuccess(null);

    try {
      const res = await api.delete(`/api/admin/guild-users?user_id=${userId}&target_guild_id=${guildId}`);
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to remove user');
      }

      setSuccess(`Removed ${email} from guild`);
      await fetchGuilds();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove user');
    }
  };

  const getRoleIcon = (role: string) => {
    switch (role) {
      case 'LEADER': return <Crown className="h-4 w-4 text-yellow-500" />;
      case 'DEPUTY': return <Shield className="h-4 w-4 text-purple-500" />;
      case 'OFFICER': return <Shield className="h-4 w-4 text-blue-500" />;
      default: return <Users className="h-4 w-4 text-gray-500" />;
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
    <div className="max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Leadership Management</h1>
        <p className="text-muted-foreground">
          Manage leadership across all Dream guilds
        </p>
      </div>

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

      <div className="grid gap-4">
        {guilds.map((guild) => (
          <Card key={guild.id}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setExpandedGuild(expandedGuild === guild.id ? null : guild.id)}
                  >
                    {expandedGuild === guild.id ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                  </Button>
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <span className="font-mono font-bold text-primary">{guild.nickname}</span>
                      <span>-</span>
                      <span>{guild.name}</span>
                      <span className="text-sm text-muted-foreground font-normal">(Level {guild.min_level}+)</span>
                    </CardTitle>
                    <CardDescription>
                      {guild.member_count} member{guild.member_count !== 1 ? 's' : ''}
                    </CardDescription>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  {/* Leader */}
                  <div className="text-right">
                    <p className="text-xs text-muted-foreground">Leader</p>
                    {guild.leader ? (
                      <p className="text-sm font-medium flex items-center gap-1 justify-end">
                        <Crown className="h-3 w-3 text-yellow-500" />
                        {guild.leader.display_name}
                      </p>
                    ) : (
                      <p className="text-sm text-muted-foreground italic">None</p>
                    )}
                  </div>

                  {/* Deputy */}
                  <div className="text-right">
                    <p className="text-xs text-muted-foreground">Deputy</p>
                    {guild.deputy ? (
                      <p className="text-sm font-medium flex items-center gap-1 justify-end">
                        <Shield className="h-3 w-3 text-purple-500" />
                        {guild.deputy.display_name}
                      </p>
                    ) : (
                      <p className="text-sm text-muted-foreground italic">None</p>
                    )}
                  </div>

                  {/* Officers */}
                  <div className="text-right">
                    <p className="text-xs text-muted-foreground">Officers</p>
                    <p className="text-sm font-medium">{guild.officers.length}</p>
                  </div>

                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setAddingToGuild(addingToGuild === guild.id ? null : guild.id)}
                  >
                    <UserPlus className="h-4 w-4 mr-2" />
                    Add User
                  </Button>
                </div>
              </div>

              {/* Add User Form */}
              {addingToGuild === guild.id && (
                <div className="mt-4 p-4 border rounded-lg bg-muted/50">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="md:col-span-2">
                      <Label htmlFor={`email-${guild.id}`}>Email Address</Label>
                      <Input
                        id={`email-${guild.id}`}
                        type="email"
                        placeholder="user@example.com"
                        value={newUserEmail}
                        onChange={(e) => setNewUserEmail(e.target.value)}
                        disabled={submitting}
                      />
                    </div>
                    <div>
                      <Label htmlFor={`role-${guild.id}`}>Role</Label>
                      <Select
                        value={newUserRole}
                        onValueChange={(value) => setNewUserRole(value as any)}
                        disabled={submitting}
                      >
                        <SelectTrigger id={`role-${guild.id}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="MEMBER">Member</SelectItem>
                          <SelectItem value="OFFICER">Officer</SelectItem>
                          <SelectItem value="DEPUTY">Deputy</SelectItem>
                          <SelectItem value="LEADER">Leader</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="flex gap-2 mt-3">
                    <Button
                      size="sm"
                      onClick={() => handleAddUser(guild.id)}
                      disabled={submitting}
                    >
                      {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Add'}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setAddingToGuild(null);
                        setNewUserEmail('');
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </CardHeader>

            {/* Expanded Member List */}
            {expandedGuild === guild.id && (
              <CardContent>
                {guild.members.length === 0 ? (
                  <p className="text-muted-foreground text-sm">No members in this guild.</p>
                ) : (
                  <div className="space-y-2">
                    {guild.members.map((member) => (
                      <div
                        key={member.user_id}
                        className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50"
                      >
                        <div className="flex-1">
                          <p className="font-medium">{member.display_name}</p>
                          <p className="text-xs text-muted-foreground">{member.email}</p>
                        </div>

                        <div className="flex items-center gap-3">
                          <Select
                            value={member.role}
                            onValueChange={(value) => handleUpdateRole(guild.id, member.user_id, value as any)}
                          >
                            <SelectTrigger className="w-[140px]">
                              <div className="flex items-center gap-2">
                                {getRoleIcon(member.role)}
                                <SelectValue />
                              </div>
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="MEMBER">
                                <div className="flex items-center gap-2">
                                  <Users className="h-4 w-4" />
                                  Member
                                </div>
                              </SelectItem>
                              <SelectItem value="OFFICER">
                                <div className="flex items-center gap-2">
                                  <Shield className="h-4 w-4 text-blue-500" />
                                  Officer
                                </div>
                              </SelectItem>
                              <SelectItem value="DEPUTY">
                                <div className="flex items-center gap-2">
                                  <Shield className="h-4 w-4 text-purple-500" />
                                  Deputy
                                </div>
                              </SelectItem>
                              <SelectItem value="LEADER">
                                <div className="flex items-center gap-2">
                                  <Crown className="h-4 w-4 text-yellow-500" />
                                  Leader
                                </div>
                              </SelectItem>
                            </SelectContent>
                          </Select>

                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleRemoveUser(guild.id, member.user_id, member.email)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            )}
          </Card>
        ))}
      </div>

      {/* Role Descriptions */}
      <Card>
        <CardHeader>
          <CardTitle>Role Permissions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-start gap-2">
            <Crown className="h-5 w-5 text-yellow-500 mt-0.5" />
            <div>
              <p className="font-medium">Leader</p>
              <p className="text-sm text-muted-foreground">
                Full access - can manage settings, members, leadership, and all guild features
              </p>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <Shield className="h-5 w-5 text-purple-500 mt-0.5" />
            <div>
              <p className="font-medium">Deputy</p>
              <p className="text-sm text-muted-foreground">
                Can process activity logs, manage challenges, configure settings, and view reports (cannot manage leadership)
              </p>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <Shield className="h-5 w-5 text-blue-500 mt-0.5" />
            <div>
              <p className="font-medium">Officer</p>
              <p className="text-sm text-muted-foreground">
                Can process activity logs, manage challenges, and view reports
              </p>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <Users className="h-5 w-5 text-gray-500 mt-0.5" />
            <div>
              <p className="font-medium">Member</p>
              <p className="text-sm text-muted-foreground">
                Can view leaderboard, members, and reports
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function AdminPage() {
  return (
    <ProtectedRoute requiredRole="LEADER">
      <AdminPageContent />
    </ProtectedRoute>
  );
}
