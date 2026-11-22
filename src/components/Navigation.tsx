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
import {
  ChevronDown, User, LogOut, Users, Shield, Crown, Gauge, Castle, Activity, Trophy, Swords, Globe, BarChart3, Medal,
  BookOpen, MapPin, CheckSquare, FlaskConical, Calculator,
  KeyRound, UserCircle, type LucideIcon,
} from 'lucide-react';
import { DreamWordmark } from '@/components/brand/DreamMark';

type NavItem = { href: string; label: string; desc?: string; icon: LucideIcon };
type NavSection = { title?: string; items: NavItem[] };
type NavEntry =
  | { kind: 'link'; href: string; label: string; icon: LucideIcon; show: boolean; also?: string[] }
  | { kind: 'menu'; key: string; label: string; icon: LucideIcon; show: boolean; matchPrefix?: string; sections: NavSection[] };

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
  if (pathname === '/login' || pathname === '/signup') {
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

  // Highest role across all guilds, same rule as the admin hub: an officer of any guild is staff
  // even while another guild is selected. Each page/API still enforces its own checks.
  const LEVEL: Record<string, number> = { MEMBER: 0, OFFICER: 1, DEPUTY: 2, LEADER: 3 };
  const maxLevel = isAwaitingAssignment ? -1 : guilds.reduce((m, g) => Math.max(m, LEVEL[g.role] ?? 0), -1);
  const atLeast = (r: 'MEMBER' | 'OFFICER' | 'DEPUTY' | 'LEADER' | 'SUPER') =>
    isSuperAdmin || (r !== 'SUPER' && maxLevel >= LEVEL[r]);
  const isStaff = atLeast('OFFICER');
  const signedIn = !!user && !isGuest;
  const member = signedIn && (isSuperAdmin || hasRole('MEMBER'));

  // Top bar: plain links for the pages members use daily, a dropdown only where a page
  // family needs one (Assault's sub-pages, staff tools). Avatar menu holds account things.
  const entries: NavEntry[] = [
    { kind: 'link', href: '/me', label: 'Me', icon: Gauge, show: signedIn },
    { kind: 'link', href: '/guilds', label: 'Guilds', icon: Castle, show: true },
    { kind: 'link', href: '/overview', label: 'Activity', icon: Activity, show: member },
    { kind: 'link', href: '/leaderboard', label: 'Leaderboard', icon: Trophy, show: member },
    {
      kind: 'menu', key: 'assault', label: 'Assault', icon: Swords, show: member, matchPrefix: '/assault',
      sections: [
        {
          title: 'Live',
          items: [
            { href: '/assault', label: 'Assault hub', desc: 'Next launch, guild status', icon: Swords },
            { href: '/assault/conquest', label: 'Conquest', desc: 'Every location, every guild', icon: Globe },
            { href: '/assault/stats', label: 'Season stats', desc: 'Standing and waves this season', icon: BarChart3 },
          ],
        },
        {
          title: 'Rankings',
          items: [
            { href: '/assault/leaderboard', label: 'Leaderboard', desc: 'Member assault rankings', icon: Medal },
            { href: '/assault/hall-of-fame', label: 'Hall of fame', desc: 'Best finishes, all-time top', icon: Crown },
          ],
        },
        {
          title: 'Prep',
          items: [
            { href: '/assault/guide', label: 'Guide', desc: 'Zones, 5Ps, hits-to-kill, gear', icon: BookOpen },
            { href: '/assault/locations', label: 'Locations', desc: 'Enemies, drops, gold per hour', icon: MapPin },
            { href: '/assault/checklist', label: 'Checklist', desc: 'Track your prep each launch', icon: CheckSquare },
            { href: '/assault/potions', label: 'Potions', desc: 'Stacks, costs, restacks', icon: FlaskConical },
          ],
        },
      ],
    },
    { kind: 'link', href: '/combat', label: 'Combat', icon: Calculator, show: member },
    { kind: 'link', href: '/guide', label: 'Guide', icon: BookOpen, show: member },
    // Staff get one entry: the admin hub. Guild tools (dashboard, reports, roster ...) are linked from inside it.
    { kind: 'link', href: '/admin', label: 'Admin', icon: Shield, show: isStaff, also: ['/network', '/reports', '/members', '/activity', '/challenges'] },
  ];

  const isActive = (href: string) => pathname === href || (href !== '/' && pathname.startsWith(href + '/'));
  // Exact match for links whose sub-pages live in the same menu (e.g. /assault vs /assault/stats).
  const isExact = (href: string) => pathname === href;
  const visibleEntries = entries.filter((e) => e.show);

  return (
    <header className="border-b border-crystal/10 sticky top-0 z-50 w-full max-w-[100vw] overflow-x-clip bg-background/80 backdrop-blur-md">
      <div className="container mx-auto px-4 max-w-full">
        <nav className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2 lg:min-h-14 lg:flex-nowrap lg:py-0">
          <Link href={!signedIn ? '/' : isStaff ? '/admin' : '/me'} className="shrink-0" aria-label="Dream Guilds home">
            <DreamWordmark />
          </Link>

          <div className="contents lg:flex lg:items-center lg:gap-4">
            {/* Main navigation */}
            {visibleEntries.length > 0 && (
              <div className="order-last flex w-full min-w-0 max-w-full items-center gap-0.5 overflow-x-auto whitespace-nowrap text-sm lg:order-none lg:w-auto lg:overflow-visible">
                {visibleEntries.map((entry) => {
                  const base = 'shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-md transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring';
                  const on = 'bg-crystal/10 text-crystal-light font-medium';
                  const off = 'text-muted-foreground hover:text-foreground hover:bg-muted';

                  if (entry.kind === 'link') {
                    return (
                      <Link key={entry.href} href={entry.href} className={`${base} ${isActive(entry.href) || entry.also?.some(isActive) ? on : off}`}>
                        <entry.icon className="h-4 w-4" />
                        {entry.label}
                      </Link>
                    );
                  }

                  const menuActive = entry.matchPrefix
                    ? isActive(entry.matchPrefix)
                    : entry.sections.some((sec) => sec.items.some((i) => isExact(i.href)));
                  return (
                    <DropdownMenu key={entry.key}>
                      <DropdownMenuTrigger asChild>
                        <button className={`${base} ${menuActive ? on : off}`}>
                          <entry.icon className="h-4 w-4" />
                          {entry.label}
                          <ChevronDown className="h-3 w-3 opacity-60" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="w-64 max-h-[75vh] overflow-y-auto p-1.5">
                        {entry.sections.map((sec, si) => (
                          <div key={si}>
                            {si > 0 && <DropdownMenuSeparator />}
                            {sec.title && (
                              <DropdownMenuLabel className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
                                {sec.title}
                              </DropdownMenuLabel>
                            )}
                            {sec.items.map((item) => {
                              const active = isExact(item.href);
                              return (
                                <DropdownMenuItem key={item.href} asChild className={active ? 'bg-crystal/10' : ''}>
                                  <Link href={item.href} className="flex items-start gap-3 py-1.5 cursor-pointer">
                                    <item.icon className={`h-4 w-4 mt-0.5 shrink-0 ${active ? 'text-crystal' : 'text-muted-foreground'}`} />
                                    <span className="min-w-0">
                                      <span className={`block ${active ? 'text-crystal-light font-medium' : ''}`}>{item.label}</span>
                                      {item.desc && <span className="block text-xs text-muted-foreground truncate">{item.desc}</span>}
                                    </span>
                                  </Link>
                                </DropdownMenuItem>
                              );
                            })}
                          </div>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
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
                          {currentCharacter.total_level != null && (
                            <span className="hidden sm:inline text-xs text-amber-400">Lv {currentCharacter.total_level}</span>
                          )}
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
                        <Link href="/account" className="cursor-pointer">
                          <UserCircle className="h-4 w-4 mr-2" />
                          My characters
                        </Link>
                      </DropdownMenuItem>
                      {isSuperAdmin && (
                        <DropdownMenuItem asChild>
                          <Link href="/setup" className="cursor-pointer">
                            <KeyRound className="h-4 w-4 mr-2" />
                            API key
                          </Link>
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
