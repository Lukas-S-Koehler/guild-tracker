import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';
import { verifyAdminOrLeader, isErrorResponse } from '@/lib/auth-helpers';
import { checkGuildKey } from '@/lib/guild-key-check';

export const dynamic = 'force-dynamic';

const DEFAULT_DONATION_REQUIREMENT = 5000;

// GET CONFIG
export async function GET(req: NextRequest) {
  const auth = await verifyAdminOrLeader(req);
  if (isErrorResponse(auth)) return auth;

  try {
    // Leader of this guild is already verified above; guild_config RLS is legacy and can block silently.
    const supabase = createAdminClient();

    const { data, error } = await supabase
      .from('guild_config')
      .select('id, guild_name, guild_id, api_key, settings, updated_at')
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
      updated_at: data.updated_at ?? null,
      donation_requirement:
        data.settings?.donation_requirement ?? DEFAULT_DONATION_REQUIREMENT,
      settings: data.settings || {},
    });

  } catch (err) {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// SAVE CONFIG
export async function POST(req: NextRequest) {
  const auth = await verifyAdminOrLeader(req);
  if (isErrorResponse(auth)) return auth;

  try {
    // Leader of this guild is already verified above; guild_config RLS is legacy and can block silently.
    const supabase = createAdminClient();
    const body = await req.json();

    const { guild_name, guild_id, api_key, donation_requirement, settings } = body;

    if (!guild_name || !guild_id || !api_key) {
      return NextResponse.json(
        { error: 'Guild Name, Guild ID, and API Key are required' },
        { status: 400 }
      );
    }

    if (!auth.isSuperAdmin && guild_id !== auth.guildId) {
      return NextResponse.json(
        { error: 'You can only update your own guild config' },
        { status: 403 }
      );
    }

    const { data: existing } = await supabase
      .from('guild_config')
      .select('id, settings, api_key')
      .eq('guild_id', guild_id)
      .maybeSingle();

    // A new key is checked before it replaces the old one, so a key on the wrong character
    // is refused here instead of failing the daily fetch with 403.
    let keyOwner: string | null = null;
    if (api_key !== 'placeholder' && api_key !== existing?.api_key) {
      const check = await checkGuildKey(api_key, String(guild_id), guild_name);
      if (!check.ok) return NextResponse.json({ error: check.reason, key_owner: check.character }, { status: 400 });
      keyOwner = check.character;
    }

    // Merge settings from request body with existing settings
    const newSettings = {
      ...(existing?.settings || {}),
      ...(settings || {}),
      donation_requirement: donation_requirement ?? DEFAULT_DONATION_REQUIREMENT,
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
      updated_at: result.data?.updated_at ?? null,
      key_owner: keyOwner,
    });

  } catch (err) {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
