import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, createAdminClient } from '@/lib/supabase-server';
import { verifyAdminOrLeader, isErrorResponse } from '@/lib/auth-helpers';

/**
 * GET /api/admin/all-guilds
 * Super admin: returns all guilds.
 * Guild leader: returns only guilds where they are LEADER.
 */
export async function GET(req: NextRequest) {
  const auth = await verifyAdminOrLeader(req);
  if (isErrorResponse(auth)) return auth;

  const supabase = createServerClient(req);
  const adminClient = createAdminClient();

  try {
    let guildsQuery = supabase.from('guilds').select('*').order('display_order', { ascending: true });

    let guildMembersQuery = supabase.from('guild_leaders').select('guild_id, user_id, role, joined_at');

    // Non-super-admin leaders only see guilds where they are LEADER
    if (!auth.isSuperAdmin) {
      const { data: leaderGuilds } = await supabase
        .from('guild_leaders')
        .select('guild_id')
        .eq('user_id', auth.user.id)
        .eq('role', 'LEADER');

      const leaderGuildIds = leaderGuilds?.map((g: any) => g.guild_id) || [];
      if (leaderGuildIds.length === 0) {
        return NextResponse.json([]);
      }
      guildsQuery = guildsQuery.in('id', leaderGuildIds);
      guildMembersQuery = guildMembersQuery.in('guild_id', leaderGuildIds);
    }

    const { data: guilds, error: guildsError } = await guildsQuery;
    if (guildsError) {
      return NextResponse.json({ error: 'Failed to fetch guilds' }, { status: 500 });
    }

    const { data: guildMembersRaw, error: membersError } = await guildMembersQuery;
    if (membersError) {
      return NextResponse.json({ error: 'Failed to fetch members' }, { status: 500 });
    }

    const { data: { users }, error: usersError } = await adminClient.auth.admin.listUsers();
    const userMap = new Map<string, any>();
    if (!usersError) {
      users?.forEach(user => {
        userMap.set(user.id, {
          email: user.email,
          display_name: user.user_metadata?.display_name || user.email?.split('@')[0] || 'Unknown',
        });
      });
    }

    const guildMembers = guildMembersRaw?.map((member: any) => {
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

    const guildsWithMembers = guilds?.map((guild: any) => ({
      ...guild,
      members: guildMemberMap.get(guild.id) || [],
      leader: guildMemberMap.get(guild.id)?.find((m: any) => m.role === 'LEADER'),
      deputy: guildMemberMap.get(guild.id)?.find((m: any) => m.role === 'DEPUTY'),
      officers: guildMemberMap.get(guild.id)?.filter((m: any) => m.role === 'OFFICER') || [],
      member_count: guildMemberMap.get(guild.id)?.length || 0,
    }));

    return NextResponse.json(guildsWithMembers || []);
  } catch (error) {
    console.error('[Admin] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
