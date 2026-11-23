import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';
import { requireUser, isResponse } from '@/lib/user-auth';
import { RANK, rankInGuild } from '@/lib/role-hierarchy';
import { SUPER_ADMIN_EMAIL } from '@/lib/auth-helpers';
import { CUSTOM_KINDS, loadCustomEvents, type CustomEventRow } from '@/lib/calendar';

export const dynamic = 'force-dynamic';

/**
 * Staff calendar events (Dream Hub step 14).
 * Guild events: officer+ of that guild. Network-wide events (guild_id null): super admin.
 *   GET                 → { events, manageable_guild_ids, can_network }
 *   POST   {event}      → create
 *   PATCH  {id, ...}    → update
 *   DELETE ?id=         → delete
 */

type User = { id: string; email?: string };

async function manageableGuilds(supabase: ReturnType<typeof createAdminClient>, user: User): Promise<{ all: boolean; ids: Set<string> }> {
  if (user.email === SUPER_ADMIN_EMAIL) return { all: true, ids: new Set() };
  const { data } = await supabase.from('guild_leaders').select('guild_id, role').eq('user_id', user.id);
  return { all: false, ids: new Set((data ?? []).filter((r) => ['OFFICER', 'DEPUTY', 'LEADER'].includes(String(r.role).toUpperCase())).map((r) => String(r.guild_id))) };
}

async function canManage(supabase: ReturnType<typeof createAdminClient>, user: User, guildId: string | null) {
  const rank = await rankInGuild(supabase, user, guildId);
  return guildId ? rank >= RANK.OFFICER : rank === RANK.SUPER;
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Validated row fields from a request body, or an error string. */
function parse(body: Record<string, unknown>): Partial<CustomEventRow> | string {
  const title = String(body.title ?? '').trim();
  if (!title || title.length > 80) return 'Title is required (max 80 characters).';
  const description = body.description ? String(body.description).trim().slice(0, 500) : null;
  const kind = String(body.kind ?? 'event');
  if (!(CUSTOM_KINDS as readonly string[]).includes(kind)) return 'Unknown type.';
  const guild_id = body.guild_id ? String(body.guild_id) : null;
  const duration = body.duration_minutes == null || body.duration_minutes === '' ? null : Number(body.duration_minutes);
  if (duration != null && (!Number.isInteger(duration) || duration < 1 || duration > 10080)) return 'Duration must be 1–10080 minutes.';
  const base = { title, description: description || null, kind: kind as CustomEventRow['kind'], guild_id, duration_minutes: duration };

  if (body.repeat === 'weekly') {
    const weekdays = Array.isArray(body.weekdays) ? Array.from(new Set(body.weekdays.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))).sort() : [];
    if (!weekdays.length) return 'Pick at least one weekday.';
    const time = String(body.time_utc ?? '');
    if (!TIME.test(time)) return 'Time must be HH:MM (UTC).';
    const from = body.active_from ? String(body.active_from) : null;
    const until = body.active_until ? String(body.active_until) : null;
    if ((from && !DATE.test(from)) || (until && !DATE.test(until))) return 'Dates must be YYYY-MM-DD.';
    if (from && until && until < from) return 'End date is before the start date.';
    return { ...base, weekdays, time_utc: time, active_from: from, active_until: until, starts_at: null };
  }
  const starts = new Date(String(body.starts_at ?? ''));
  if (Number.isNaN(starts.getTime())) return 'Pick a start date and time.';
  return { ...base, starts_at: starts.toISOString(), weekdays: null, time_utc: null, active_from: null, active_until: null };
}

export async function GET(req: NextRequest) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;
  const supabase = createAdminClient();
  const m = await manageableGuilds(supabase, user);
  if (!m.all && !m.ids.size) return NextResponse.json({ error: 'Staff only' }, { status: 403 });
  const events = await loadCustomEvents(supabase);
  return NextResponse.json({ events, manageable_guild_ids: m.all ? null : Array.from(m.ids), can_network: m.all });
}

export async function POST(req: NextRequest) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;
  const supabase = createAdminClient();
  const row = parse(await req.json().catch(() => ({})));
  if (typeof row === 'string') return NextResponse.json({ error: row }, { status: 400 });
  if (!(await canManage(supabase, user, row.guild_id ?? null)))
    return NextResponse.json({ error: row.guild_id ? 'Officer+ of that guild only' : 'Network-wide events: super admin only' }, { status: 403 });
  const { data, error } = await supabase.from('calendar_events').insert({ ...row, created_by: user.id }).select('*').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ event: data });
}

export async function PATCH(req: NextRequest) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;
  const supabase = createAdminClient();
  const body = await req.json().catch(() => ({}));
  const id = String(body.id ?? '');
  const { data: existing } = await supabase.from('calendar_events').select('guild_id').eq('id', id).maybeSingle();
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const row = parse(body);
  if (typeof row === 'string') return NextResponse.json({ error: row }, { status: 400 });
  // Must be allowed on both the old and the new guild.
  if (!(await canManage(supabase, user, existing.guild_id)) || !(await canManage(supabase, user, row.guild_id ?? null)))
    return NextResponse.json({ error: 'Not allowed to edit this event' }, { status: 403 });
  const { data, error } = await supabase.from('calendar_events').update({ ...row, updated_at: new Date().toISOString() }).eq('id', id).select('*').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ event: data });
}

export async function DELETE(req: NextRequest) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;
  const supabase = createAdminClient();
  const id = new URL(req.url).searchParams.get('id') ?? '';
  const { data: existing } = await supabase.from('calendar_events').select('guild_id').eq('id', id).maybeSingle();
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!(await canManage(supabase, user, existing.guild_id))) return NextResponse.json({ error: 'Not allowed to delete this event' }, { status: 403 });
  const { error } = await supabase.from('calendar_events').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
