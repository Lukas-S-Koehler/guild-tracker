import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';
import { verifyAuth, verifyAuthOrPublic, isErrorResponse } from '@/lib/auth-helpers';
import { sendDirectMessage } from '@/lib/discord-api';

// GET /api/warnings — list warnings for a guild
export async function GET(req: NextRequest) {
  const auth = await verifyAuthOrPublic(req);
  if (isErrorResponse(auth)) return auth;

  const supabase = createAdminClient();
  const { searchParams } = new URL(req.url);

  const guildId = req.headers.get('x-guild-id') || '';
  const memberId = searchParams.get('member_id');
  const level = searchParams.get('level');
  const page = parseInt(searchParams.get('page') || '1');
  const limit = 50;

  let query = supabase
    .from('warnings')
    .select(
      `id, member_id, guild_id, warning_level, reason, is_auto, discord_dm_sent,
       discord_dm_error, warned_by_discord_id, warned_by_ign, created_at,
       members(ign, discord_id),
       guilds(name, nickname)`,
      { count: 'exact' }
    )
    .order('created_at', { ascending: false })
    .range((page - 1) * limit, page * limit - 1);

  if (guildId) query = query.eq('guild_id', guildId);
  if (memberId) query = query.eq('member_id', memberId);
  if (level) query = query.eq('warning_level', level);

  const { data, error, count } = await query;

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ warnings: data ?? [], total: count ?? 0 });
}

// POST /api/warnings — manually warn a member
export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req, 'OFFICER');
  if (isErrorResponse(auth)) return auth;

  const supabase = createAdminClient();
  const { guildId } = auth;
  const body = await req.json();
  const { member_id, warning_level, reason } = body;

  if (!member_id || !warning_level) {
    return NextResponse.json({ error: 'member_id and warning_level required' }, { status: 400 });
  }

  const { data: member } = await supabase
    .from('members')
    .select('id, ign, discord_id')
    .eq('id', member_id)
    .single();

  if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 });

  let dmSent = false;
  let dmError: string | null = null;

  if (member.discord_id) {
    const guildName = guildId;
    const { data: config } = await supabase
      .from('guild_config')
      .select('guild_name')
      .eq('guild_id', guildId)
      .single();

    const name = config?.guild_name ?? guildId;
    const levelLabel = warning_level === 'warn1' ? '⚠️ Warning' : warning_level === 'warn2' ? '⚠️⚠️ Final Warning' : '🚫 Kick Notice';
    const reasonText = reason ? `\nReason: ${reason}` : '';
    const msg = `${levelLabel}\nYou have received a warning in **${name}** for inactivity.${reasonText}\nPlease ensure you meet the activity requirements to remain in the guild.`;

    const result = await sendDirectMessage(member.discord_id, msg);
    dmSent = result.ok;
    dmError = result.error ?? null;
  }

  const { data: warning, error: insertError } = await supabase
    .from('warnings')
    .insert({
      member_id,
      guild_id: guildId,
      warning_level,
      reason: reason || null,
      is_auto: false,
      discord_dm_sent: dmSent,
      discord_dm_error: dmError,
      warned_by_ign: body.warned_by_ign || null,
    })
    .select()
    .single();

  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });

  return NextResponse.json({ warning, dm_sent: dmSent });
}
