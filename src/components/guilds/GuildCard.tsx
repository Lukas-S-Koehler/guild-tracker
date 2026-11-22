import Link from 'next/link';
import { ASSAULT_TOP_GUILD_ID, ASSAULT_TOP_MIN_CL, raidLabel } from '@/lib/raids';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Swords, Users, Coins } from 'lucide-react';
import { formatGold } from '@/lib/utils';
import type { DirectoryGuild } from '@/lib/guild-directory';

export function requirementLabel(g: Pick<DirectoryGuild, 'requirement'>): string {
  if (!g.requirement.amount) return 'No donation requirement';
  return `${formatGold(g.requirement.amount)} gold / ${g.requirement.period === 'weekly' ? 'week' : 'day'}`;
}

export function levelLabel(g: Pick<DirectoryGuild, 'id' | 'is_assault' | 'min_level'>): string {
  if (g.is_assault) return g.id === ASSAULT_TOP_GUILD_ID ? `Assaults · CL ${ASSAULT_TOP_MIN_CL}+` : 'Pools · all levels';
  return g.min_level > 1 ? `CL ${g.min_level}+` : 'All levels';
}

export default function GuildCard({ guild }: { guild: DirectoryGuild }) {
  return (
    <Link href={`/guilds/${guild.tag.toLowerCase()}`} className="block group">
      <Card className="h-full transition-colors group-hover:border-crystal/50 group-hover:bg-accent/30">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="font-semibold text-lg leading-tight truncate">{guild.name}</h3>
              <p className="text-xs text-muted-foreground">[{guild.tag}]</p>
            </div>
            <Badge variant="outline" className={guild.is_assault ? 'border-red-500/50 text-red-400 shrink-0' : 'border-crystal/50 text-crystal shrink-0'}>
              {levelLabel(guild)}
            </Badge>
          </div>
          <div className="text-sm text-muted-foreground space-y-1">
            <p className="flex items-center gap-2">
              <Swords className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{guild.is_assault ? (guild.id === ASSAULT_TOP_GUILD_ID ? 'Hardcore assaults' : 'Energizing Pools, casual assaults') : guild.raids.map(raidLabel).join(', ') || 'Raids'}</span>
            </p>
            <p className="flex items-center gap-2"><Coins className="h-3.5 w-3.5 shrink-0" />{requirementLabel(guild)}</p>
            <p className="flex items-center gap-2"><Users className="h-3.5 w-3.5 shrink-0" />{guild.member_count} members</p>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
