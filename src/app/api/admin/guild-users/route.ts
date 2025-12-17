import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { verifyAuth, isErrorResponse } from '@/lib/auth-helpers';

/**
 * GET /api/admin/guild-users
 * List all users who have access to the current guild
 */
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req, 'LEADER');
  if (isErrorResponse(auth)) return auth;

  const { guildId } = auth;
  const supabase = createServerClient(req);

  // Get all users in this guild with their details
  const { data: guildUsers, error } = await supabase
    .from('guild_members')
    .select(`
      user_id,
      role,
      joined_at,
      users:user_id (
        email,
        raw_user_meta_data
      )
    `)
    .eq('guild_id', guildId)
    .order('joined_at', { ascending: true });

  if (error) {
    console.error('[Admin] Error fetching guild users:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Format the response
  const formattedUsers = guildUsers?.map((gu: any) => ({
    user_id: gu.user_id,
    email: gu.users?.email || 'Unknown',
    display_name: gu.users?.raw_user_meta_data?.display_name || gu.users?.email?.split('@')[0] || 'Unknown',
    role: gu.role,
    joined_at: gu.joined_at,
  })) || [];

  return NextResponse.json(formattedUsers);
}

/**
 * POST /api/admin/guild-users
 * Add a user to any guild (by email)
 * Requires target_guild_id in body to specify which guild to add to
 */
export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req, 'LEADER');
  if (isErrorResponse(auth)) return auth;

  const supabase = createServerClient(req);

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

    let userId: string;

    if (user_id) {
      // If user_id is provided directly, use it
      userId = user_id;
    } else {
      // Try to find user by email using auth.users (requires RPC or service role)
      // For now, we'll use a workaround with a database function
      const { data: foundUsers, error: rpcError } = await supabase
        .rpc('find_user_by_email', { search_email: email.toLowerCase() });

      if (rpcError) {
        console.error('[Admin] Error finding user:', rpcError);
        return NextResponse.json({
          error: 'Could not find user. Please ask them to provide their user ID from their profile, or contact support.'
        }, { status: 500 });
      }

      if (!foundUsers || foundUsers.length === 0) {
        return NextResponse.json({
          error: 'User not found. They need to sign up first at /signup'
        }, { status: 404 });
      }

      userId = foundUsers[0].id;
    }

    // Check if user is already in this guild
    const { data: existing } = await supabase
      .from('guild_members')
      .select('id')
      .eq('guild_id', target_guild_id)
      .eq('user_id', userId)
      .limit(1);

    if (existing && existing.length > 0) {
      return NextResponse.json({
        error: 'User is already a member of this guild'
      }, { status: 400 });
    }

    // Add user to guild
    const { error: insertError } = await supabase
      .from('guild_members')
      .insert({
        guild_id: target_guild_id,
        user_id: userId,
        role: role,
      });

    if (insertError) {
      console.error('[Admin] Error adding user to guild:', insertError);
      return NextResponse.json({ error: 'Failed to add user to guild' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: `User ${email} added to guild with role ${role}`
    });
  } catch (error) {
    console.error('[Admin] Error processing request:', error);
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
}

/**
 * PATCH /api/admin/guild-users
 * Update a user's role in any guild
 * Requires target_guild_id in body
 */
export async function PATCH(req: NextRequest) {
  const auth = await verifyAuth(req, 'LEADER');
  if (isErrorResponse(auth)) return auth;

  const supabase = createServerClient(req);

  try {
    const body = await req.json();
    const { user_id, role, target_guild_id } = body;

    if (!user_id || !role || !target_guild_id) {
      return NextResponse.json({ error: 'user_id, role, and target_guild_id are required' }, { status: 400 });
    }

    if (!['MEMBER', 'OFFICER', 'DEPUTY', 'LEADER'].includes(role)) {
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
    }

    // Update user's role
    const { error: updateError } = await supabase
      .from('guild_members')
      .update({ role })
      .eq('guild_id', target_guild_id)
      .eq('user_id', user_id);

    if (updateError) {
      console.error('[Admin] Error updating user role:', updateError);
      return NextResponse.json({ error: 'Failed to update user role' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: `User role updated to ${role}`
    });
  } catch (error) {
    console.error('[Admin] Error processing request:', error);
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
}

/**
 * DELETE /api/admin/guild-users
 * Remove a user from any guild
 * Query params: user_id, target_guild_id
 */
export async function DELETE(req: NextRequest) {
  const auth = await verifyAuth(req, 'LEADER');
  if (isErrorResponse(auth)) return auth;

  const { user } = auth;
  const supabase = createServerClient(req);

  try {
    const { searchParams } = new URL(req.url);
    const userIdToRemove = searchParams.get('user_id');
    const targetGuildId = searchParams.get('target_guild_id');

    if (!userIdToRemove || !targetGuildId) {
      return NextResponse.json({ error: 'user_id and target_guild_id are required' }, { status: 400 });
    }

    // Prevent removing yourself
    if (userIdToRemove === user.id) {
      return NextResponse.json({
        error: 'Cannot remove yourself from the guild'
      }, { status: 400 });
    }

    // Remove user from guild
    const { error: deleteError } = await supabase
      .from('guild_members')
      .delete()
      .eq('guild_id', targetGuildId)
      .eq('user_id', userIdToRemove);

    if (deleteError) {
      console.error('[Admin] Error removing user from guild:', deleteError);
      return NextResponse.json({ error: 'Failed to remove user from guild' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: 'User removed from guild'
    });
  } catch (error) {
    console.error('[Admin] Error processing request:', error);
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
}
