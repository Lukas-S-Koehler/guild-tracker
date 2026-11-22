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
  const { user, currentGuild, guilds, signOut, hasRole, isSuperAdmin, isGuest, setCurrentGuild, isAwaitingAssignment, myGuildIds, myCharacters, currentCharacter, setCurrentCharacter } = useAuth();

  // Characters you can "play as": on your account, in a Dream guild you have access to.
  const switchableCharacters = isGuest || isAwaitingAssignment
    ? []
    : myCharacters.filter((c) => c.in_dream_guild && c.guild_id && guilds.some((g) => g.guild_id === c.guild_id));
  // Guild access not covered by a character (manual overrides, super admin, guests).
  const otherGuilds = guilds.filter((g) => !switchableCharacters.some((c) => c.guild_id === g.guild_id));

  // Don't show navigation on auth pages
  if (pathname === '/login' || pathname === '/signup' || pathname === '/guilds') {
    return null;
  }

  const prettyRole = (r: string) => r.charAt(0) + r.slice(1).toLowerCase();

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
    { href: '/overview', label: 'Overview' },
    { href: '/leaderboard', label: 'Leaderboard' },
    { href: '/assault', label: 'Assault' },
    { href: '/combat', label: 'Combat', requiresRole: 'MEMBER' },
    { href: '/guide', label: 'Guide' },
    { href: '/data-management', label: 'Manage Data', requiresSuperAdmin: true },
    { href: '/admin', label: 'Admin', requiresRole: 'LEADER' },
  ];

  return (
    <header className="border-b sticky top-0 z-50 w-full max-w-[100vw] overflow-x-clip bg-background/95 backdrop-blur">
      <div className="container mx-auto px-4 max-w-full">
        <nav className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2 lg:min-h-14 lg:flex-nowrap lg:py-0">
          <Link href="/" className="font-bold text-lg whitespace-nowrap shrink-0">
            ⚔️ Guild Tracker
          </Link>

          <div className="contents lg:flex lg:items-center lg:gap-4">
            {/* Navigation Links */}
            {currentGuild && (
              <div className="order-last flex w-full min-w-0 max-w-full items-center gap-1 overflow-x-auto whitespace-nowrap text-sm lg:order-none lg:w-auto lg:overflow-visible">
                {navLinks.map((link) => {
                  if (link.requiresSuperAdmin && !isSuperAdmin) return null;
                  if (!isSuperAdmin && link.requiresRole && !hasRole(link.requiresRole)) return null;

                  const isActive = pathname === link.href;
                  return (
                    <Link
                      key={link.href}
                      href={link.href}
                      className={`shrink-0 px-3 py-2 rounded-md transition-colors ${
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
              <div className="flex min-w-0 items-center gap-2">
                {/* Guild / character selector */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="gap-2 max-w-[14rem] sm:max-w-none">
                      {currentCharacter ? (
                        <>
                          {currentCharacter.avatar_url && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={currentCharacter.avatar_url} alt="" className="h-4 w-4 rounded" />
                          )}
                          <span className="font-medium truncate">{currentCharacter.ign}</span>
                          <span className="text-muted-foreground text-xs">{currentCharacter.guild_nickname ?? currentGuild.guild_name}</span>
                        </>
                      ) : (
                        <span className="font-medium truncate">{currentGuild.guild_name}</span>
                      )}
                      {!isGuest && !isAwaitingAssignment && (
                        <Badge variant="outline" className={`${getRoleBadgeColor(currentGuild.role)} text-xs gap-1`}>
                          {getRoleIcon(currentGuild.role)}
                          <span className="hidden sm:inline">{prettyRole(currentGuild.role)}</span>
                        </Badge>
                      )}
                      <ChevronDown className="h-3 w-3" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-72 max-h-[70vh] overflow-y-auto">
                    {switchableCharacters.length > 0 && (
                      <>
                        <DropdownMenuLabel>My characters</DropdownMenuLabel>
                        {switchableCharacters.map((c) => {
                          const g = guilds.find((x) => x.guild_id === c.guild_id)!;
                          const active = currentCharacter?.member_id === c.member_id;
                          return (
                            <DropdownMenuItem key={c.member_id} className={active ? 'bg-accent' : ''} onClick={() => setCurrentCharacter(c)}>
                              <div className="flex items-center gap-2 w-full">
                                {c.avatar_url && (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img src={c.avatar_url} alt="" className="h-5 w-5 rounded" />
                                )}
                                <span className="truncate">{c.ign}</span>
                                {!c.claimed && <span className="text-[10px] text-muted-foreground">alt</span>}
                                <span className="text-xs text-muted-foreground ml-auto">{c.guild_nickname}</span>
                                <Badge variant="outline" className={`${getRoleBadgeColor(g.role)} gap-1`}>
                                  {getRoleIcon(g.role)}
                                  {prettyRole(c.position ?? g.role)}
                                </Badge>
                              </div>
                            </DropdownMenuItem>
                          );
                        })}
                      </>
                    )}
                    {otherGuilds.length > 0 && (
                      <>
                        {switchableCharacters.length > 0 && <DropdownMenuSeparator />}
                        <DropdownMenuLabel>
                          {isGuest || isAwaitingAssignment ? 'Select guild' : switchableCharacters.length > 0 ? 'Other guild access' : 'My guilds'}
                        </DropdownMenuLabel>
                        {otherGuilds.map((guild) => (
                          <DropdownMenuItem
                            key={guild.guild_id}
                            className={!currentCharacter && guild.guild_id === currentGuild.guild_id ? 'bg-accent' : ''}
                            onClick={() => setCurrentGuild(guild)}
                          >
                            <div className="flex items-center justify-between w-full">
                              <span className="flex items-center gap-1.5">
                                {myGuildIds.has(guild.guild_id) && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
                                {guild.guild_name}
                              </span>
                              {!isGuest && !isAwaitingAssignment && (
                                <Badge variant="outline" className={getRoleBadgeColor(guild.role)}>
                                  <span className="mr-1">{getRoleIcon(guild.role)}</span>
                                  {prettyRole(guild.role)}
                                </Badge>
                              )}
                            </div>
                          </DropdownMenuItem>
                        ))}
                      </>
                    )}
                  </DropdownMenuContent>
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
                          {isAwaitingAssignment ? (
                            <Badge variant="outline" className="w-fit">Awaiting assignment</Badge>
                          ) : (
                            <Badge
                              variant="outline"
                              className={`w-fit ${getRoleBadgeColor(currentGuild.role)}`}
                            >
                              <span className="mr-1">{getRoleIcon(currentGuild.role)}</span>
                              {currentGuild.role}
                            </Badge>
                          )}
                        </div>
                      </DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem asChild>
                        <Link href="/account">My characters</Link>
                      </DropdownMenuItem>
                      {(isSuperAdmin || guilds.some((g) => !isAwaitingAssignment && g.role !== 'MEMBER')) && (
                        <DropdownMenuItem asChild>
                          <Link href="/admin/claims">Character claims</Link>
                        </DropdownMenuItem>
                      )}
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
