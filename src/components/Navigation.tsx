'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { ChevronDown, User, LogOut, Users, Shield, Crown } from 'lucide-react';

export default function Navigation() {
  const pathname = usePathname();
  const { user, currentGuild, guilds, signOut, hasRole, isSuperAdmin, isGuest, setCurrentGuild } = useAuth();

  // Don't show navigation on auth pages
  if (pathname === '/login' || pathname === '/signup' || pathname === '/guilds') {
    return null;
  }

  const getRoleIcon = (role: string) => {
    switch (role) {
      case 'LEADER':
        return <Crown className="h-3 w-3" />;
      case 'OFFICER':
        return <Shield className="h-3 w-3" />;
      default:
        return <Users className="h-3 w-3" />;
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

  const navLinks: { href: string; label: string; requiresRole?: 'MEMBER' | 'OFFICER' | 'DEPUTY' | 'LEADER'; requiresSuperAdmin?: boolean }[] = [
    { href: '/', label: 'Dashboard' },
    { href: '/activity', label: 'Activity' },
    { href: '/reports', label: 'Discord Output' },
    { href: '/warnings', label: 'Warnings' },
    { href: '/members', label: 'Members' },
    { href: '/leaderboard', label: 'Leaderboard' },
    { href: '/challenges', label: 'Challenges', requiresRole: 'OFFICER' },
    { href: '/data-management', label: 'Manage Data', requiresSuperAdmin: true },
    { href: '/admin', label: 'Admin', requiresRole: 'LEADER' },
  ];

  return (
    <header className="border-b sticky top-0 z-50 bg-background/95 backdrop-blur">
      <div className="container mx-auto px-4">
        <nav className="flex items-center justify-between h-14">
          <Link href="/" className="font-bold text-lg">
            ⚔️ Guild Tracker
          </Link>

          <div className="flex items-center gap-4">
            {/* Navigation Links */}
            {currentGuild && (
              <div className="flex items-center gap-1 text-sm">
                {navLinks.map((link) => {
                  if (link.requiresSuperAdmin && !isSuperAdmin) return null;
                  if (!isSuperAdmin && link.requiresRole && !hasRole(link.requiresRole)) return null;

                  const isActive = pathname === link.href;
                  return (
                    <Link
                      key={link.href}
                      href={link.href}
                      className={`px-3 py-2 rounded-md transition-colors ${
                        isActive
                          ? 'bg-muted font-medium'
                          : 'hover:bg-muted'
                      }`}
                    >
                      {link.label}
                    </Link>
                  );
                })}
              </div>
            )}

            {/* Guild Indicator & User Menu */}
            {currentGuild ? (
              <div className="flex items-center gap-2">
                {/* Guild selector */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="gap-2">
                      <span className="font-medium">{currentGuild.guild_name}</span>
                      {!isGuest && (
                        <Badge variant="outline" className={`${getRoleBadgeColor(currentGuild.role)} text-xs`}>
                          {getRoleIcon(currentGuild.role)}
                        </Badge>
                      )}
                      {guilds.length > 1 && <ChevronDown className="h-3 w-3" />}
                    </Button>
                  </DropdownMenuTrigger>
                  {guilds.length > 1 && (
                    <DropdownMenuContent align="end" className="w-56">
                      <DropdownMenuLabel>{isGuest ? 'Select Guild' : 'My Guilds'}</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      {guilds.map((guild) => (
                        <DropdownMenuItem
                          key={guild.guild_id}
                          className={guild.guild_id === currentGuild.guild_id ? 'bg-accent' : ''}
                          onClick={isGuest ? () => setCurrentGuild(guild) : undefined}
                          disabled={!isGuest}
                        >
                          <div className="flex items-center justify-between w-full">
                            <span>{guild.guild_name}</span>
                            {!isGuest && (
                              <Badge variant="outline" className={getRoleBadgeColor(guild.role)}>
                                <span className="mr-1">{getRoleIcon(guild.role)}</span>
                                {guild.role}
                              </Badge>
                            )}
                          </div>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  )}
                </DropdownMenu>

                {/* User menu or Sign In */}
                {isGuest ? (
                  <Link href="/login">
                    <Button size="sm">Sign In</Button>
                  </Link>
                ) : (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" className="gap-2">
                        <User className="h-4 w-4" />
                        <ChevronDown className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                      <DropdownMenuLabel>
                        <div className="flex flex-col gap-1">
                          <span className="text-sm">{user?.email}</span>
                          <Badge
                            variant="outline"
                            className={`w-fit ${getRoleBadgeColor(currentGuild.role)}`}
                          >
                            <span className="mr-1">{getRoleIcon(currentGuild.role)}</span>
                            {currentGuild.role}
                          </Badge>
                        </div>
                      </DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => signOut()}>
                        <LogOut className="h-4 w-4 mr-2" />
                        Sign Out
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            ) : !user && pathname !== '/login' && pathname !== '/signup' ? (
              <div className="flex items-center gap-2">
                <Link href="/login">
                  <Button variant="ghost" size="sm">
                    Sign In
                  </Button>
                </Link>
                <Link href="/signup">
                  <Button size="sm">Sign Up</Button>
                </Link>
              </div>
            ) : null}
          </div>
        </nav>
      </div>
    </header>
  );
}
