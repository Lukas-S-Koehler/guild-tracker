import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, isErrorResponse } from '@/lib/auth-helpers';
import { getAssaultConfig, upsertAssaultConfig } from '@/lib/assault-service';
import { applyZoneSelection } from '@/lib/assault-plan';

export const dynamic = 'force-dynamic';

const EDITABLE_KEYS = [
  'active',
  'launch_time_utc',
  'zone_name',
  'level_range',
  'shrine_info',
  'target_mob_count',
  'enemy_priority',
  'discord_guild_id',
  'announcement_channel_id',
  'member_role_id',
  'staff_role_id',
  'skip_date',
  'paused_until',
  'weekdays',
  'season_start',
  'season_end',
] as const;

export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req, 'OFFICER');
  if (isErrorResponse(auth)) return auth;
  try {
    const config = await getAssaultConfig(auth.guildId);
    return NextResponse.json({ config });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const auth = await verifyAuth(req, 'OFFICER');
  if (isErrorResponse(auth)) return auth;
  try {
    const body = await req.json();
    const patch: Record<string, unknown> = {};
    for (const key of EDITABLE_KEYS) {
      if (key in body) patch[key] = body[key];
    }
    // Picking a location derives zone name/id/key, level range, shrine and gold-ranked enemies.
    if (body.zone_id != null) {
      await applyZoneSelection(auth.guildId, Number(body.zone_id));
    }
    if (Object.keys(patch).length === 0 && body.zone_id != null) {
      return NextResponse.json({ config: await getAssaultConfig(auth.guildId) });
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'No editable fields in body' }, { status: 400 });
    }
    if (body.zone_id != null) {
      for (const k of ['zone_name', 'level_range', 'shrine_info', 'enemy_priority']) delete patch[k];
    }
    const config = await upsertAssaultConfig(auth.guildId, patch);
    return NextResponse.json({ config });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
