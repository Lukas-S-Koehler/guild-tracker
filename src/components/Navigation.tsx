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
  const { user, currentGuild, guilds, setCurrentGuild, signOut, hasRole } = useAuth();

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

  const navLinks = [
    { href: '/', label: 'Dashboard' },
    { href: '/members', label: 'Members' },
    { href: '/activity', label: 'Activity Log', requiresRole: 'OFFICER' as const },
    { href: '/challenges', label: 'Challenges', requiresRole: 'OFFICER' as const },
    { href: '/leaderboard', label: 'Leaderboard' },
    { href: '/reports', label: 'Reports' },
    { href: '/setup', label: 'Settings' },
    { href: '/admin', label: 'Admin', requiresRole: 'LEADER' as const },
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
            {user && currentGuild && (
              <div className="flex items-center gap-1 text-sm">
                {navLinks.map((link) => {
                  // Hide links if user doesn't have required role
                  if (link.requiresRole && !hasRole(link.requiresRole)) {
                    return null;
                  }

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

            {/* Guild Switcher & User Menu */}
            {user && currentGuild ? (
              <div className="flex items-center gap-2">
                {/* Guild Switcher */}
                {guilds.length > 1 && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm" className="gap-2">
                        <span className="font-medium">{currentGuild.guild_name}</span>
                        <ChevronDown className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                      <DropdownMenuLabel>Switch Guild</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      {guilds.map((guild) => (
                        <DropdownMenuItem
                          key={guild.guild_id}
                          onClick={() => setCurrentGuild(guild)}
                          className={
                            guild.guild_id === currentGuild.guild_id
                              ? 'bg-accent'
                              : ''
                          }
                        >
                          <div className="flex items-center justify-between w-full">
                            <span>{guild.guild_name}</span>
                            <Badge
                              variant="outline"
                              className={getRoleBadgeColor(guild.role)}
                            >
                              <span className="mr-1">{getRoleIcon(guild.role)}</span>
                              {guild.role}
                            </Badge>
                          </div>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}

                {/* User Menu */}
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
                        <span className="text-sm">{user.email}</span>
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
