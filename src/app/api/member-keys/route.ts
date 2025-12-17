import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { verifyAuth, isErrorResponse } from '@/lib/auth-helpers';

/**
 * GET /api/member-keys
 * Get the current user's API key for their current guild
 */
export async function GET(req: NextRequest) {
  const supabase = createServerClient(req);

  // Check if user is authenticated
  const { data: { user }, error: userError } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Get guild ID from header (optional - might not have guild yet)
  const guildId = req.headers.get('x-guild-id');

  if (!guildId) {
    // User has no guild selected - return empty response
    return NextResponse.json({
      has_key: false,
      api_key: null,
      created_at: null,
      updated_at: null,
    });
  }

  try {
    // Get guild_member record
    const { data: guildMember, error: memberError } = await supabase
      .from('guild_members')
      .select('id')
      .eq('user_id', user.id)
      .eq('guild_id', guildId)
      .single();

    if (memberError || !guildMember) {
      console.log('[MemberKeys] No guild membership found - user not in guild yet');
      return NextResponse.json({
        has_key: false,
        api_key: null,
        created_at: null,
        updated_at: null,
      });
    }

    // Get API key for this guild member
    const { data: keyData, error: keyError } = await supabase
      .from('member_keys')
      .select('api_key, created_at, updated_at')
      .eq('guild_member_id', guildMember.id)
      .single();

    if (keyError && keyError.code !== 'PGRST116') {
      console.error('[MemberKeys] Error fetching API key:', keyError);
      return NextResponse.json({ error: 'Failed to fetch API key' }, { status: 500 });
    }

    return NextResponse.json({
      has_key: !!keyData,
      api_key: keyData?.api_key || null,
      created_at: keyData?.created_at || null,
      updated_at: keyData?.updated_at || null,
    });
  } catch (error) {
    console.error('[MemberKeys] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/member-keys
 * Create or update the current user's API key for their current guild
 */
export async function POST(req: NextRequest) {
  const supabase = createServerClient(req);

  // Check if user is authenticated
  const { data: { user }, error: userError } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Get guild ID from header (optional - might not have guild yet)
  const guildId = req.headers.get('x-guild-id');

  if (!guildId) {
    return NextResponse.json({ error: 'No guild selected. Please join a guild first.' }, { status: 400 });
  }

  try {
    const body = await req.json();
    const { api_key } = body;

    if (!api_key) {
      return NextResponse.json({ error: 'API key is required' }, { status: 400 });
    }

    // Get guild_member record
    const { data: guildMember, error: memberError } = await supabase
      .from('guild_members')
      .select('id')
      .eq('user_id', user.id)
      .eq('guild_id', guildId)
      .single();

    if (memberError || !guildMember) {
      console.log('[MemberKeys POST] User not a member of this guild yet');
      return NextResponse.json({
        error: 'You must be added to this guild before you can save an API key. Contact your guild leader.'
      }, { status: 403 });
    }

    // Check if key already exists
    const { data: existing } = await supabase
      .from('member_keys')
      .select('id')
      .eq('guild_member_id', guildMember.id)
      .single();

    if (existing) {
      // Update existing key
      const { error: updateError } = await supabase
        .from('member_keys')
        .update({
          api_key,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id);

      if (updateError) {
        console.error('[MemberKeys] Error updating API key:', updateError);
        return NextResponse.json({ error: 'Failed to update API key' }, { status: 500 });
      }

      return NextResponse.json({ success: true, message: 'API key updated' });
    } else {
      // Insert new key
      const { error: insertError } = await supabase
        .from('member_keys')
        .insert({
          guild_member_id: guildMember.id,
          api_key,
        });

      if (insertError) {
        console.error('[MemberKeys] Error creating API key:', insertError);
        return NextResponse.json({ error: 'Failed to create API key' }, { status: 500 });
      }

      return NextResponse.json({ success: true, message: 'API key saved' });
    }
  } catch (error) {
    console.error('[MemberKeys] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * DELETE /api/member-keys
 * Delete the current user's API key for their current guild
 */
export async function DELETE(req: NextRequest) {
  const auth = await verifyAuth(req, 'MEMBER');
  if (isErrorResponse(auth)) return auth;

  const { user, guildId } = auth;
  const supabase = createServerClient(req);

  try {
    // Get guild_member record
    const { data: guildMember, error: memberError } = await supabase
      .from('guild_members')
      .select('id')
      .eq('user_id', user.id)
      .eq('guild_id', guildId)
      .single();

    if (memberError || !guildMember) {
      console.error('[MemberKeys] Error fetching guild member:', memberError);
      return NextResponse.json({ error: 'Guild membership not found' }, { status: 404 });
    }

    // Delete API key
    const { error: deleteError } = await supabase
      .from('member_keys')
      .delete()
      .eq('guild_member_id', guildMember.id);

    if (deleteError) {
      console.error('[MemberKeys] Error deleting API key:', deleteError);
      return NextResponse.json({ error: 'Failed to delete API key' }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: 'API key deleted' });
  } catch (error) {
    console.error('[MemberKeys] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
