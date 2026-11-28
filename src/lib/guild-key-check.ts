/**
 * Checks a guild API key the way the daily fetch uses it: the key must authenticate, and its
 * character must be allowed to read the guild activity log (leader/officer of that guild).
 * A key made on another character logs in fine and even reads the member list, but gets 403 on
 * /activity, which is what stops tracking.
 */
export type GuildKeyCheck =
  | { ok: true; character: string | null; keyName: string | null }
  | { ok: false; reason: string; character: string | null; keyName: string | null };

const H = (key: string) => ({ headers: { Authorization: `Bearer ${key}`, 'User-Agent': 'GuildTracker/1.0' } });

export async function checkGuildKey(apiKey: string, guildId: string, guildName?: string | null): Promise<GuildKeyCheck> {
  const auth = await fetch('https://api.idle-mmo.com/v1/auth/check', H(apiKey)).catch(() => null);
  if (!auth) return { ok: false, reason: 'Could not reach IdleMMO, try again in a minute.', character: null, keyName: null };
  if (!auth.ok) {
    return { ok: false, reason: `IdleMMO rejected this key (${auth.status}). Copy it again from the IdleMMO API page.`, character: null, keyName: null };
  }
  const info = await auth.json().catch(() => null) as { character?: { name?: string }; api_key?: { name?: string } } | null;
  const character = info?.character?.name ?? null;
  const keyName = info?.api_key?.name ?? null;

  const act = await fetch(`https://api.idle-mmo.com/v1/guild/${guildId}/activity?page=1`, H(apiKey)).catch(() => null);
  if (!act) return { ok: false, reason: 'Could not reach IdleMMO, try again in a minute.', character, keyName };
  if (act.status === 401 || act.status === 403) {
    return {
      ok: false,
      reason: `This key belongs to ${character ?? 'a character'} who cannot read the activity log of ${guildName ?? 'this guild'}. `
        + 'Switch to the guild leader or an officer in IdleMMO, create the key there, and paste that one.',
      character,
      keyName,
    };
  }
  if (!act.ok) return { ok: false, reason: `IdleMMO error ${act.status} on the activity log, try again later.`, character, keyName };
  return { ok: true, character, keyName };
}
