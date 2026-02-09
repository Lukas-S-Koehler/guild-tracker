import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, createAdminClient } from '@/lib/supabase-server';
import { verifyGuildLeader, isErrorResponse } from '@/lib/auth-helpers';

/**
 * GET /api/admin/all-guilds
 * Get overview of all guilds with their leadership
 * Only accessible to Dream Bandits leader
 */
export async function GET(req: NextRequest) {
  // Verify user is the Dream Bandits leader
  const auth = await verifyGuildLeader(req, 'Dream Bandits');
  if (isErrorResponse(auth)) return auth;

  const supabase = createServerClient(req);
  const adminClient = createAdminClient(); // Use admin client for auth.admin operations

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

    // Get all guild leaders - we'll fetch user details separately
    const { data: guildMembersRaw, error: membersError } = await supabase
      .from('guild_leaders')
      .select('guild_id, user_id, role, joined_at');

    if (membersError) {
      console.error('[Admin] Error fetching guild members:', membersError);
      return NextResponse.json({ error: 'Failed to fetch members' }, { status: 500 });
    }

    // Get unique user IDs
    const userIds = Array.from(new Set(guildMembersRaw?.map(m => m.user_id) || []));

    // Fetch user details from auth.users using ADMIN CLIENT
    const { data: { users }, error: usersError } = await adminClient.auth.admin.listUsers();

    if (usersError) {
      console.error('[Admin] Error fetching users:', usersError);
      console.error('[Admin] Error details:', usersError);
      // Continue without user details rather than failing completely
    } else {
      console.log('[Admin] Successfully fetched', users?.length || 0, 'users');
    }

    // Create user lookup map
    const userMap = new Map<string, any>();
    users?.forEach(user => {
      userMap.set(user.id, {
        email: user.email,
        display_name: user.user_metadata?.display_name || user.email?.split('@')[0] || 'Unknown',
      });
    });

    // Combine guild members with user details
    const guildMembers = guildMembersRaw?.map(member => {
      const userDetails = userMap.get(member.user_id);
      return {
        guild_id: member.guild_id,
        user_id: member.user_id,
        role: member.role,
        joined_at: member.joined_at,
        email: userDetails?.email || 'unknown@email.com',
        display_name: userDetails?.display_name || 'Unknown User',
      };
    });

    // Group members by guild
    const guildMemberMap = new Map<string, any[]>();
    guildMembers?.forEach((member: any) => {
      if (!guildMemberMap.has(member.guild_id)) {
        guildMemberMap.set(member.guild_id, []);
      }
      guildMemberMap.get(member.guild_id)!.push({
        user_id: member.user_id,
        email: member.email,
        display_name: member.display_name,
        role: member.role,
        joined_at: member.joined_at,
      });
    });

    // Combine guilds with their members
    const guildsWithMembers = guilds?.map((guild) => ({
      ...guild,
      members: guildMemberMap.get(guild.id) || [],
      leader: guildMemberMap.get(guild.id)?.find(m => m.role === 'LEADER'),
      deputy: guildMemberMap.get(guild.id)?.find(m => m.role === 'DEPUTY'),
      officers: guildMemberMap.get(guild.id)?.filter(m => m.role === 'OFFICER') || [],
      member_count: guildMemberMap.get(guild.id)?.length || 0,
    }));

    return NextResponse.json(guildsWithMembers || []);
  } catch (error) {
    console.error('[Admin] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
