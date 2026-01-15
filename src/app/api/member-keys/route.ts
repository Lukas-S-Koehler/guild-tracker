import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';

/**
 * GET /api/member-keys
 * Get the current user's API key (account-based, shared across all guilds)
 */
export async function GET(req: NextRequest) {
  const supabase = createServerClient(req);

  // Check if user is authenticated
  const { data: { user }, error: userError } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Get API key for this user (account-based, not guild-based)
    const { data: keyData, error: keyError } = await supabase
      .from('user_api_keys')
      .select('api_key, created_at, updated_at')
      .eq('user_id', user.id)
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
 * Create or update the current user's API key (account-based, shared across all guilds)
 */
export async function POST(req: NextRequest) {
  const supabase = createServerClient(req);

  // Check if user is authenticated
  const { data: { user }, error: userError } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { api_key } = body;

    if (!api_key) {
      return NextResponse.json({ error: 'API key is required' }, { status: 400 });
    }

    // Check if key already exists for this user
    const { data: existing } = await supabase
      .from('user_api_keys')
      .select('id')
      .eq('user_id', user.id)
      .single();

    if (existing) {
      // Update existing key
      const { error: updateError } = await supabase
        .from('user_api_keys')
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
        .from('user_api_keys')
        .insert({
          user_id: user.id,
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
 * Delete the current user's API key
 */
export async function DELETE(req: NextRequest) {
  const supabase = createServerClient(req);

  // Check if user is authenticated
  const { data: { user }, error: userError } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Delete API key for this user
    const { error: deleteError } = await supabase
      .from('user_api_keys')
      .delete()
      .eq('user_id', user.id);

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
