import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, createAdminClient } from '@/lib/supabase-server';
import { verifyAdminOrLeader, isErrorResponse } from '@/lib/auth-helpers';

/**
 * POST /api/admin/guild-users
 * Add a user to a guild by email or user_id.
 * Super admin: can assign any role including LEADER.
 * Guild leader: can only assign DEPUTY or OFFICER to their own guild.
 */
export async function POST(req: NextRequest) {
  const auth = await verifyAdminOrLeader(req);
  if (isErrorResponse(auth)) return auth;

  const supabase = createServerClient(req);
  const db = auth.isSuperAdmin ? createAdminClient() : supabase;

  try {
    const body = await req.json();
    const { email, user_id, role = 'MEMBER', target_guild_id } = body;

    if (!target_guild_id) {
      return NextResponse.json({ error: 'target_guild_id is required' }, { status: 400 });
    }

    if (!email && !user_id) {
      return NextResponse.json({ error: 'Email or user_id is required' }, { status: 400 });
    }

    if (!['MEMBER', 'OFFICER', 'DEPUTY', 'LEADER'].includes(role)) {
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
    }

    // Non-super-admin leaders can only manage their own guild and cannot assign LEADER
    if (!auth.isSuperAdmin) {
      if (target_guild_id !== auth.guildId) {
        return NextResponse.json({ error: 'Forbidden - You can only manage your own guild' }, { status: 403 });
      }
      if (role === 'LEADER') {
        return NextResponse.json({ error: 'Forbidden - Only super admin can assign LEADER role' }, { status: 403 });
      }
    }

    let userId: string;

    if (user_id) {
      userId = user_id;
    } else {
      const { data: foundUsers, error: rpcError } = await supabase
        .rpc('find_user_by_email', { search_email: email.toLowerCase() });

      if (rpcError) {
        console.error('[Admin] Error finding user:', rpcError);
        return NextResponse.json({
          error: 'Could not search for user. Please ask them to provide their user ID from their profile.',
        }, { status: 500 });
      }

      if (!foundUsers || foundUsers.length === 0) {
        return NextResponse.json({
          error: 'User not found. They need to sign up first at /signup',
        }, { status: 404 });
      }

      userId = foundUsers[0].id;
    }

    const { data: existing } = await db
      .from('guild_leaders')
      .select('id')
      .eq('guild_id', target_guild_id)
      .eq('user_id', userId)
      .limit(1);

    if (existing && existing.length > 0) {
      return NextResponse.json({ error: 'User is already a member of this guild' }, { status: 400 });
    }

    const { error: insertError } = await db
      .from('guild_leaders')
      .insert({ guild_id: target_guild_id, user_id: userId, role });

    if (insertError) {
      console.error('[Admin] Error adding user to guild:', insertError);
      return NextResponse.json({ error: 'Failed to add user to guild' }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: `User added to guild with role ${role}` });
  } catch (error) {
    console.error('[Admin] Error processing request:', error);
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
}

/**
 * PATCH /api/admin/guild-users
 * Update a user's role.
 * Super admin: any role. Guild leader: DEPUTY/OFFICER only, own guild only.
 */
export async function PATCH(req: NextRequest) {
  const auth = await verifyAdminOrLeader(req);
  if (isErrorResponse(auth)) return auth;

  const supabase = createServerClient(req);
  const db = auth.isSuperAdmin ? createAdminClient() : supabase;

  try {
    const body = await req.json();
    const { user_id, role, target_guild_id } = body;

    if (!user_id || !role || !target_guild_id) {
      return NextResponse.json({ error: 'user_id, role, and target_guild_id are required' }, { status: 400 });
    }

    if (!['MEMBER', 'OFFICER', 'DEPUTY', 'LEADER'].includes(role)) {
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
    }

    if (!auth.isSuperAdmin) {
      if (target_guild_id !== auth.guildId) {
        return NextResponse.json({ error: 'Forbidden - You can only manage your own guild' }, { status: 403 });
      }
      if (role === 'LEADER') {
        return NextResponse.json({ error: 'Forbidden - Only super admin can assign LEADER role' }, { status: 403 });
      }
    }

    const { error: updateError } = await db
      .from('guild_leaders')
      .update({ role })
      .eq('guild_id', target_guild_id)
      .eq('user_id', user_id);

    if (updateError) {
      console.error('[Admin] Error updating user role:', updateError);
      return NextResponse.json({ error: 'Failed to update user role' }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: `User role updated to ${role}` });
  } catch (error) {
    console.error('[Admin] Error processing request:', error);
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
}

/**
 * DELETE /api/admin/guild-users
 * Remove a user from a guild.
 * Super admin: any guild. Guild leader: own guild only.
 */
export async function DELETE(req: NextRequest) {
  const auth = await verifyAdminOrLeader(req);
  if (isErrorResponse(auth)) return auth;

  const supabase = createServerClient(req);
  const db = auth.isSuperAdmin ? createAdminClient() : supabase;

  try {
    const { searchParams } = new URL(req.url);
    const userIdToRemove = searchParams.get('user_id');
    const targetGuildId = searchParams.get('target_guild_id');

    if (!userIdToRemove || !targetGuildId) {
      return NextResponse.json({ error: 'user_id and target_guild_id are required' }, { status: 400 });
    }

    if (!auth.isSuperAdmin && targetGuildId !== auth.guildId) {
      return NextResponse.json({ error: 'Forbidden - You can only manage your own guild' }, { status: 403 });
    }

    if (userIdToRemove === auth.user.id && !auth.isSuperAdmin) {
      return NextResponse.json({ error: 'Cannot remove yourself from the guild' }, { status: 400 });
    }

    const { error: deleteError } = await db
      .from('guild_leaders')
      .delete()
      .eq('guild_id', targetGuildId)
      .eq('user_id', userIdToRemove);

    if (deleteError) {
      console.error('[Admin] Error removing user from guild:', deleteError);
      return NextResponse.json({ error: 'Failed to remove user from guild' }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: 'User removed from guild' });
  } catch (error) {
    console.error('[Admin] Error processing request:', error);
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
}
