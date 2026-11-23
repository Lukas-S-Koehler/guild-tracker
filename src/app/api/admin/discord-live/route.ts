import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';
import { verifySuperAdmin, isErrorResponse } from '@/lib/auth-helpers';
import { bindLive, listLiveRows, messageLink, setLiveEnabled, unbindLive } from '@/lib/discord-live';
import { adoptLegacyGuildHalls, allDefs, canBuild, payloadsFor, publishKey, refreshBuiltLive } from '@/lib/live-messages';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// GET /api/admin/discord-live            → every live message definition with its binding state
// GET /api/admin/discord-live?preview=KEY → payloads that would be posted (built fresh, or last stored)
export async function GET(req: NextRequest) {
  const auth = await verifySuperAdmin(req);
  if (isErrorResponse(auth)) return auth;
  const supabase = createAdminClient();

  const preview = new URL(req.url).searchParams.get('preview');
  if (preview) {
    try {
      return NextResponse.json({ ok: true, payloads: (await payloadsFor(supabase, preview)) ?? [] });
    } catch (err) {
      return NextResponse.json({ error: String(err) }, { status: 500 });
    }
  }

  let rows;
  try {
    await adoptLegacyGuildHalls(supabase);
    rows = await listLiveRows(supabase);
  } catch (err) {
    return NextResponse.json({ error: `${err} (run database/discord-live-messages.sql?)` }, { status: 500 });
  }
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const defs = await allDefs(supabase);
  return NextResponse.json({
    ok: true,
    items: defs.map((d) => {
      const r = byKey.get(d.key);
      return {
        ...d,
        buildable: canBuild(d.key),
        bound: !!r,
        channel_id: r?.channel_id ?? null,
        enabled: r?.enabled ?? false,
        message_count: r?.message_ids.length ?? 0,
        link: r?.message_ids[0] ? messageLink(r.channel_id, r.message_ids[0]) : null,
        last_published_at: r?.last_published_at ?? null,
        last_error: r?.last_error ?? null,
      };
    }),
  });
}

// POST /api/admin/discord-live
//   { action: 'bind', key, channel_id }   → bind (or move) and publish when there is content
//   { action: 'publish', key, force? }    → update now (force = rewrite even if unchanged)
//   { action: 'toggle', key, enabled }    → pause / resume
//   { action: 'unbind', key, delete_messages? }
//   { action: 'pings', key: 'inactivity:<guild>', enabled } → @mention flagged members in that report
//   { action: 'refresh-all' }             → rebuild every bound buildable message
export async function POST(req: NextRequest) {
  const auth = await verifySuperAdmin(req);
  if (isErrorResponse(auth)) return auth;
  const supabase = createAdminClient();
  const body = (await req.json().catch(() => ({}))) as {
    action?: string; key?: string; channel_id?: string; force?: boolean; enabled?: boolean; delete_messages?: boolean;
  };
  const { action, key } = body;

  try {
    if (action === 'refresh-all') {
      return NextResponse.json({ ok: true, results: await refreshBuiltLive(supabase, !!body.force) });
    }
    if (!key || !(await allDefs(supabase)).some((d) => d.key === key)) {
      return NextResponse.json({ error: 'Unknown key' }, { status: 400 });
    }
    if (action === 'bind') {
      const channel = body.channel_id?.trim();
      if (!channel || !/^\d{17,20}$/.test(channel)) return NextResponse.json({ error: 'Channel id must be a Discord snowflake' }, { status: 400 });
      await bindLive(supabase, key, channel);
      if (!canBuild(key)) {
        const note = key.startsWith('guild-hall:') ? 'Bound. First post comes with the next guild hall run (15:50 UTC).' : 'Bound. First post comes with the next daily activity check (11:48 UTC).';
        return NextResponse.json({ ok: true, status: 'bound', note });
      }
      return NextResponse.json(await publishKey(supabase, key, true));
    }
    if (action === 'publish') return NextResponse.json(await publishKey(supabase, key, !!body.force));
    if (action === 'toggle') {
      await setLiveEnabled(supabase, key, !!body.enabled);
      return NextResponse.json({ ok: true });
    }
    if (action === 'pings') {
      const guildId = key.startsWith('inactivity:') ? key.slice('inactivity:'.length) : null;
      if (!guildId) return NextResponse.json({ error: 'Pings only apply to inactivity reports' }, { status: 400 });
      const { data: cfg } = await supabase.from('guild_config').select('settings').eq('guild_id', guildId).maybeSingle();
      const { error } = await supabase
        .from('guild_config')
        .update({ settings: { ...(cfg?.settings ?? {}), disable_pings: !body.enabled } })
        .eq('guild_id', guildId);
      if (error) throw new Error(error.message);
      return NextResponse.json({ ok: true });
    }
    if (action === 'unbind') {
      await unbindLive(supabase, key, !!body.delete_messages);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 500 });
  }
}
