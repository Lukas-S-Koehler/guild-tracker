import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { verifyAuth, isErrorResponse } from '@/lib/auth-helpers';

/**
 * GET /api/admin/all-guilds
 * Get overview of all guilds with their leadership
 * Only accessible to LEADER role
 */
export async function GET(req: NextRequest) {
  // Verify user has LEADER role in at least one guild
  const auth = await verifyAuth(req, 'LEADER');
  if (isErrorResponse(auth)) return auth;

  const supabase = createServerClient(req);

  try {
    // Get all guilds
    const { data: guilds, error: guildsError } = await supabase
      .from('guilds')
      .select('*')
      .order('display_order', { ascending: true });

    if (guildsError) {
      console.error('[Admin] Error fetching guilds:', guildsError);
      return NextResponse.json({ error: 'Failed to fetch guilds' }, { status: 500 });
    }

    // Get all guild members with user details
    const { data: guildMembers, error: membersError } = await supabase
      .from('guild_members')
      .select(`
        guild_id,
        user_id,
        role,
        joined_at,
        users:user_id (
          email,
          raw_user_meta_data
        )
      `)
      .order('role', { ascending: false });

    if (membersError) {
      console.error('[Admin] Error fetching members:', membersError);
      return NextResponse.json({ error: 'Failed to fetch members' }, { status: 500 });
    }

    // Group members by guild
    const guildMemberMap = new Map<string, any[]>();
    guildMembers?.forEach((member: any) => {
      if (!guildMemberMap.has(member.guild_id)) {
        guildMemberMap.set(member.guild_id, []);
      }
      guildMemberMap.get(member.guild_id)!.push({
        user_id: member.user_id,
        email: member.users?.email || 'Unknown',
        display_name: member.users?.raw_user_meta_data?.display_name || member.users?.email?.split('@')[0] || 'Unknown',
        role: member.role,
        joined_at: member.joined_at,
      });
    });

    // Combine guilds with their members
    const guildsWithMembers = guilds?.map((guild) => ({
      ...guild,
      members: guildMemberMap.get(guild.id) || [],
      leader: guildMemberMap.get(guild.id)?.find(m => m.role === 'LEADER'),
      officers: guildMemberMap.get(guild.id)?.filter(m => m.role === 'OFFICER') || [],
      member_count: guildMemberMap.get(guild.id)?.length || 0,
    }));

    return NextResponse.json(guildsWithMembers || []);
  } catch (error) {
    console.error('[Admin] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
