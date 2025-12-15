'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Users, Shield, Crown } from 'lucide-react';

export default function GuildsPage() {
  const { user, loading, guilds, currentGuild, setCurrentGuild } = useAuth();
  const router = useRouter();

  useEffect(() => {
    // If not logged in, redirect to login
    if (!loading && !user) {
      router.push('/login');
    }

    // If user has a current guild selected, redirect to home
    if (!loading && currentGuild) {
      router.push('/');
    }
  }, [loading, user, currentGuild, router]);

  const getRoleIcon = (role: string) => {
    switch (role) {
      case 'LEADER':
        return <Crown className="h-4 w-4" />;
      case 'OFFICER':
        return <Shield className="h-4 w-4" />;
      default:
        return <Users className="h-4 w-4" />;
    }
  };

  const getRoleBadgeColor = (role: string) => {
    switch (role) {
      case 'LEADER':
        return 'bg-yellow-500/20 text-yellow-500 border-yellow-500/50';
      case 'OFFICER':
        return 'bg-blue-500/20 text-blue-500 border-blue-500/50';
      default:
        return 'bg-gray-500/20 text-gray-500 border-gray-500/50';
    }
  };

  const handleSelectGuild = (guild: typeof guilds[0]) => {
    setCurrentGuild(guild);
    router.push('/');
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) {
    return null; // Will redirect
  }

  if (guilds.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background to-muted p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="space-y-1">
            <CardTitle className="text-2xl font-bold text-center">No Guilds Found</CardTitle>
            <CardDescription className="text-center">
              You&apos;re not a member of any guilds yet
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="p-4 bg-muted rounded-md text-center">
              <p className="text-sm text-muted-foreground">
                Contact your guild leader to get invited to a guild.
              </p>
            </div>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => router.push('/login')}
            >
              Sign Out
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background to-muted p-4">
      <Card className="w-full max-w-2xl">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold text-center">Select a Guild</CardTitle>
          <CardDescription className="text-center">
            Choose which guild you want to view
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4">
            {guilds.map((guild) => (
              <Card
                key={guild.guild_id}
                className="cursor-pointer hover:bg-accent/50 transition-colors"
                onClick={() => handleSelectGuild(guild)}
              >
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <h3 className="font-semibold text-lg">{guild.guild_name}</h3>
                      <p className="text-sm text-muted-foreground">
                        Member since {new Date(guild.joined_at).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className={getRoleBadgeColor(guild.role)}>
                        <span className="mr-1">{getRoleIcon(guild.role)}</span>
                        {guild.role}
                      </Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="mt-6 pt-6 border-t">
            <p className="text-sm text-muted-foreground text-center mb-3">
              Logged in as {user.email}
            </p>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => router.push('/login')}
            >
              Sign Out
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
