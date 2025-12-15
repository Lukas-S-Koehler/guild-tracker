import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { verifyAuth, isErrorResponse } from '@/lib/auth-helpers';

const DEFAULT_DONATION_REQUIREMENT = 5000;

// GET CONFIG
export async function GET(req: NextRequest) {
  // Verify authentication (members can view config)
  const auth = await verifyAuth(req, 'MEMBER');
  if (isErrorResponse(auth)) return auth;

  try {
    const supabase = createServerClient();

    const { data, error } = await supabase
      .from('guild_config')
      .select('id, guild_name, guild_id, api_key, settings')
      .eq('guild_id', auth.guildId)
      .single();

    if (error && error.code !== 'PGRST116') {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json({
        guild_name: '',
        guild_id: '',
        api_key: '',
        donation_requirement: DEFAULT_DONATION_REQUIREMENT,
      });
    }

    return NextResponse.json({
      guild_name: data.guild_name,
      guild_id: data.guild_id,
      api_key: data.api_key,
      donation_requirement:
        data.settings?.donation_requirement || DEFAULT_DONATION_REQUIREMENT,
    });

  } catch (err) {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// SAVE CONFIG
export async function POST(req: NextRequest) {
  // Verify authentication (only leaders can update config)
  const auth = await verifyAuth(req, 'LEADER');
  if (isErrorResponse(auth)) return auth;

  try {
    const supabase = createServerClient();
    const body = await req.json();

    const { guild_name, guild_id, api_key, donation_requirement } = body;

    if (!guild_name || !guild_id || !api_key) {
      return NextResponse.json(
        { error: 'Guild Name, Guild ID, and API Key are required' },
        { status: 400 }
      );
    }

    // Ensure user can only update their own guild
    if (guild_id !== auth.guildId) {
      return NextResponse.json(
        { error: 'You can only update your own guild config' },
        { status: 403 }
      );
    }

    const { data: existing } = await supabase
      .from('guild_config')
      .select('id, settings')
      .eq('guild_id', guild_id)
      .single();

    const newSettings = {
      ...(existing?.settings || {}),
      donation_requirement: donation_requirement || DEFAULT_DONATION_REQUIREMENT,
    };

    const saveData = {
      guild_name,
      guild_id,
      api_key,
      settings: newSettings,
    };

    let result;

    if (existing) {
      result = await supabase
        .from('guild_config')
        .update({ ...saveData, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
        .select()
        .single();
    } else {
      result = await supabase
        .from('guild_config')
        .insert(saveData)
        .select()
        .single();
    }

    if (result.error) {
      return NextResponse.json({ error: result.error.message }, { status: 500 });
    }

    return NextResponse.json({
      guild_name,
      guild_id,
      api_key,
      donation_requirement: newSettings.donation_requirement,
    });

  } catch (err) {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
