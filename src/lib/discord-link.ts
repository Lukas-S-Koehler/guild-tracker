/**
 * Website user ↔ Discord account (Dream Hub step 8, A5).
 *
 * Flow: `/claim` (or the "Claim your character" button in #introductions) replies with a signed,
 * 30-minute link to /account/discord. Opening it while signed in stores the link in
 * `user_discord_links`. If staff already mapped this Discord to characters (`members.discord_id`,
 * via /map or Admin → Discord → Member mapping), that account is claimed and approved right away.
 * Otherwise the user claims on the site as usual and an officer approves it.
 */
import { createHmac, createHash, timingSafeEqual } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getAccountMemberIds } from '@/lib/alt-graph';
import { findBundleLocks, getActiveClaim, recomputeUserGuildAccess } from '@/lib/account-service';
import { syncDiscordUser } from '@/lib/discord-roles';
import { GUIDE_SITE_URL } from '@/lib/game-guide';
import { activeJoins, withJoining } from '@/lib/guild-joining';

const TOKEN_TTL_MS = 30 * 60_000;

function secret(): Buffer {
  const base = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base) throw new Error('SUPABASE_SERVICE_ROLE_KEY not configured');
  return createHash('sha256').update(`discord-link:${base}`).digest();
}

const b64 = (s: string) => Buffer.from(s).toString('base64url');
const unb64 = (s: string) => Buffer.from(s, 'base64url').toString();

export function signLinkToken(discordId: string, username: string): string {
  const body = b64(JSON.stringify({ d: discordId, u: username, e: Date.now() + TOKEN_TTL_MS }));
  const sig = createHmac('sha256', secret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyLinkToken(token: string): { discordId: string; username: string } | { error: string } {
  const [body, sig] = token.split('.');
  if (!body || !sig) return { error: 'Invalid link' };
  const expected = createHmac('sha256', secret()).update(body).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { error: 'Invalid link' };
  try {
    const p = JSON.parse(unb64(body)) as { d: string; u: string; e: number };
    if (Date.now() > p.e) return { error: 'This link expired. Run /claim in Discord again.' };
    return { discordId: p.d, username: p.u };
  } catch {
    return { error: 'Invalid link' };
  }
}

export const linkUrl = (discordId: string, username: string) =>
  `${GUIDE_SITE_URL}/account/discord?t=${signLinkToken(discordId, username)}`;

export async function getLinkByDiscord(supabase: SupabaseClient, discordId: string) {
  const { data } = await supabase.from('user_discord_links').select('user_id, discord_id, discord_username').eq('discord_id', discordId).maybeSingle();
  return data as { user_id: string; discord_id: string; discord_username: string | null } | null;
}

export async function getLinkByUser(supabase: SupabaseClient, userId: string) {
  const { data } = await supabase.from('user_discord_links').select('user_id, discord_id, discord_username, linked_at').eq('user_id', userId).maybeSingle();
  return data as { user_id: string; discord_id: string; discord_username: string | null; linked_at: string } | null;
}

/** Active characters staff mapped to this Discord that sit in a Dream guild (joining counts). */
async function mappedDreamCharacters(supabase: SupabaseClient, discordId: string) {
  const [{ data: chars }, { data: guilds }] = await Promise.all([
    supabase.from('members').select('id, ign, current_guild_id, is_active, character_id, total_level').eq('discord_id', discordId),
    supabase.from('guilds').select('id'),
  ]);
  const dream = new Set((guilds ?? []).map((g) => g.id as string));
  const joins = await activeJoins(supabase, (chars ?? []).map((c) => c.id as string));
  return (chars ?? [])
    .map((c) => withJoining(c, joins))
    .filter((c) => c.is_active !== false && c.current_guild_id && dream.has(c.current_guild_id))
    .sort((a, b) => (b.total_level ?? 0) - (a.total_level ?? 0));
}

/** IGNs we already know for this Discord (for the /claim reply). */
export async function mappedIgns(supabase: SupabaseClient, discordId: string): Promise<string[]> {
  return (await mappedDreamCharacters(supabase, discordId)).map((c) => c.ign);
}

/**
 * Fill members.discord_id on the user's approved bundle where it's still empty, so role sync
 * and DMs reach characters claimed on the site. Never overwrites a different mapping.
 */
export async function propagateDiscordToBundle(supabase: SupabaseClient, userId: string): Promise<number> {
  const link = await getLinkByUser(supabase, userId);
  if (!link) return 0;
  const { data: claims } = await supabase.from('user_characters').select('member_id').eq('user_id', userId).eq('status', 'approved');
  const seeds = (claims ?? []).map((c) => c.member_id as string);
  if (!seeds.length) return 0;
  const ids = Array.from(await getAccountMemberIds(supabase, seeds));
  const { data } = await supabase
    .from('members')
    .update({ discord_id: link.discord_id, discord_username: link.discord_username })
    .in('id', ids)
    .is('discord_id', null)
    .select('id');
  return data?.length ?? 0;
}

/** After a claim is approved (admin, assign, auto): copy the Discord link onto the bundle and sync roles. */
export async function afterClaimApproved(supabase: SupabaseClient, userId: string) {
  try {
    await propagateDiscordToBundle(supabase, userId);
    const link = await getLinkByUser(supabase, userId);
    if (link) await syncDiscordUser(supabase, link.discord_id);
  } catch (err) {
    console.error('[discord-link] afterClaimApproved:', err);
  }
}

export interface LinkResult {
  ok: boolean;
  error?: string;
  /** What happened to the claim. */
  claim?: { ign: string; status: 'approved' | 'pending'; auto: boolean } | null;
  /** Mapped characters exist but the account is claimed by someone else. */
  conflict?: string;
}

export async function linkDiscordToUser(
  supabase: SupabaseClient,
  userId: string,
  discordId: string,
  username: string
): Promise<LinkResult> {
  const other = await getLinkByDiscord(supabase, discordId);
  if (other && other.user_id !== userId) {
    return { ok: false, error: 'This Discord account is already linked to a different site account. Ask an officer if that is wrong.' };
  }
  const { error } = await supabase
    .from('user_discord_links')
    .upsert({ user_id: userId, discord_id: discordId, discord_username: username, linked_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (error) {
    if (error.code === '23505') return { ok: false, error: 'This Discord account is already linked to a different site account.' };
    return { ok: false, error: error.message };
  }

  // A5: auto-approve when staff already mapped this Discord to a character.
  const mapped = await mappedDreamCharacters(supabase, discordId);
  const active = await getActiveClaim(userId, supabase);
  let claim: LinkResult['claim'] = active ? { ign: active.ign, status: active.status as 'approved' | 'pending', auto: false } : null;
  let conflict: string | undefined;

  if (mapped.length) {
    const mappedIds = new Set(mapped.map((m) => m.id));
    if (active?.status === 'pending') {
      const bundle = await getAccountMemberIds(supabase, [active.member_id]);
      if (Array.from(bundle).some((id) => mappedIds.has(id))) {
        await supabase
          .from('user_characters')
          .update({ status: 'approved', note: 'Auto-approved: Discord matches the staff mapping', reviewed_at: new Date().toISOString() })
          .eq('id', active.id);
        claim = { ign: active.ign, status: 'approved', auto: true };
      }
    } else if (!active) {
      const main = mapped[0];
      const { locks } = await findBundleLocks(main.id, supabase);
      if (locks.length) {
        conflict = `${main.ign}'s account already has a claim by another site account. Ask an officer.`;
      } else {
        const { error: insErr } = await supabase.from('user_characters').upsert(
          {
            user_id: userId,
            member_id: main.id,
            status: 'approved',
            note: 'Auto-approved: Discord matches the staff mapping',
            requested_at: new Date().toISOString(),
            reviewed_by: null,
            reviewed_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,member_id' }
        );
        if (insErr) conflict = insErr.code === '23505' ? 'That account was just claimed by someone else.' : insErr.message;
        else claim = { ign: main.ign, status: 'approved', auto: true };
      }
    }
  }

  await recomputeUserGuildAccess(userId, supabase);
  if (claim?.status === 'approved') await afterClaimApproved(supabase, userId);
  return { ok: true, claim, conflict };
}

export async function unlinkDiscord(supabase: SupabaseClient, userId: string) {
  await supabase.from('user_discord_links').delete().eq('user_id', userId);
}

/**
 * Website link for a Discord user, creating it when it's unambiguous: staff mapped this Discord to
 * characters (`members.discord_id`) and exactly one site user already holds an approved claim on that
 * account. Same trust as A5 auto-approve, the other way round. Saves "/claim knows me but /me doesn't".
 */
export async function resolveDiscordLink(supabase: SupabaseClient, discordId: string, username: string) {
  const existing = await getLinkByDiscord(supabase, discordId);
  if (existing) return existing;

  const { data: mapped } = await supabase.from('members').select('id').eq('discord_id', discordId);
  if (!mapped?.length) return null;
  const bundle = Array.from(await getAccountMemberIds(supabase, mapped.map((m) => m.id as string)));
  const { data: claims } = await supabase.from('user_characters').select('user_id').eq('status', 'approved').in('member_id', bundle);
  const users = Array.from(new Set((claims ?? []).map((c) => c.user_id as string)));
  if (users.length !== 1) return null;
  if (await getLinkByUser(supabase, users[0]!)) return null; // that site account is linked to another Discord

  const res = await linkDiscordToUser(supabase, users[0]!, discordId, username);
  return res.ok ? getLinkByDiscord(supabase, discordId) : null;
}
