import type { Metadata } from 'next';
import { createAdminClient } from '@/lib/supabase-server';
import { loadGuildDirectory } from '@/lib/guild-directory';
import GuildCard from '@/components/guilds/GuildCard';
import PickerSection from '@/components/guilds/PickerSection';
import ChooseCurrentGuild from '@/components/guilds/ChooseCurrentGuild';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Guild directory',
  description: 'Every Dream guild in IdleMMO: level, raids, requirements and leadership. Find the one that fits you.',
};

export default async function GuildsPage() {
  const { guilds } = await loadGuildDirectory(createAdminClient());
  const active = guilds.filter((g) => g.is_active);
  const raid = active.filter((g) => !g.is_assault).sort((a, b) => b.min_level - a.min_level || a.display_order - b.display_order);
  const assault = active.filter((g) => g.is_assault).sort((a, b) => a.display_order - b.display_order);

  return (
    <div className="space-y-8">
      <ChooseCurrentGuild />
      <div>
        <h1 className="text-3xl font-bold">Dream Guilds</h1>
        <p className="text-muted-foreground mt-1">
          {active.length} active guilds. Raid guilds go by combat level (CL); the pool and assault guilds run no raids.
        </p>
      </div>

      <div id="fit" className="scroll-mt-20"><PickerSection guilds={active} /></div>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Raid guilds</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {raid.map((g) => <GuildCard key={g.id} guild={g} />)}
        </div>
      </section>

      {assault.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Pool &amp; assault guilds</h2>
          <p className="text-sm text-muted-foreground">No raids. Dream Engineers is the Energizing Pools guild (every level, casual assaults); Dream Invaders is hardcore assaults at CL 88+.</p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {assault.map((g) => <GuildCard key={g.id} guild={g} />)}
          </div>
        </section>
      )}
    </div>
  );
}
