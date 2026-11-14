import { NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import {
  listAssaultConfigs,
  getAssaultConfig,
  upsertAssaultConfig,
  listSteps,
  getGuildName,
  isAlreadySent,
  markSent,
  inferGuildFromRoles,
  isAssaultDay,
  nextAssaultLaunchUnix,
  GUILD_BY_MEMBER_ROLE,
  type AssaultConfig,
} from '@/lib/assault-service';
import {
  listPotions,
  getLoadoutForDiscordUser,
  listLoadoutsForDiscordUser,
  saveDiscordLoadout,
  setDiscordLoadoutDefault,
  type Preset,
  type SavedLoadout,
} from '@/lib/potions-service';
import { getSlotState, loadoutCost, type CombatPotion, type XpPotion } from '@/lib/potion-rules';
import { buildTemplateVars, renderTemplate, todayLaunchUnix, utcDateString } from '@/lib/assault-template';
import { postToChannelReturnId, editOriginalInteractionResponse } from '@/lib/discord-api';
import { createAdminClient } from '@/lib/supabase-server';
import { getZonePlan, listZones, shrineInfoFor } from '@/lib/assault-plan';
import { FIVE_PS, HITS_TO_KILL, GEAR_LINK, POTION_SLOTS, TERRITORY_BOOSTS, EXP_REWARDS, KILL_REWARDS, EXP_SPLIT } from '@/lib/assault-plan-static';
import { computeLaunchDate, getChecklistTemplate, buildTimedChecklist, type ChecklistItem } from '@/lib/assault-checklist-service';
import { getDiscordChecked, toggleDiscordItem, resetDiscord } from '@/lib/assault-checklist-discord';

interface Option {
  name: string;
  type: number;
  value?: string | number | boolean;
  options?: Option[];
}

interface Interaction {
  token: string;
  application_id: string;
  member?: { user?: { id: string; username: string }; roles?: string[] };
  data: {
    name: string;
    options?: Option[];
  };
}

function findOption(opts: Option[] | undefined, name: string): Option | undefined {
  return opts?.find(o => o.name === name);
}

function ephemeral(content: string) {
  return NextResponse.json({ type: 4, data: { content, flags: 64 } });
}

/** Autocomplete handler for assault subcommands (guild + step). */
export async function handleAssaultAutocomplete(interaction: Interaction) {
  const sub = interaction.data.options?.[0];
  const focused = sub?.options?.find(o => (o as Option & { focused?: boolean }).focused);
  if (!focused) {
    return NextResponse.json({ type: 8, data: { choices: [] } });
  }

  if (focused.name === 'guild') {
    // Show all configs (active + paused) for every subcommand; paused ones are labelled.
    const configs = await listAssaultConfigs();
    const q = String(focused.value ?? '').toLowerCase();
    const choices = await Promise.all(
      configs.map(async c => ({
        name: `${await getGuildName(c.guild_id)}${!c.active ? ' (paused)' : ''}`,
        value: c.guild_id,
      }))
    );
    const filtered = choices
      .filter(c => c.name.toLowerCase().includes(q) || c.value.includes(q))
      .slice(0, 25);
    return NextResponse.json({ type: 8, data: { choices: filtered } });
  }

  if (focused.name === 'zone') {
    const zones = await listZones();
    const q = String(focused.value ?? '').toLowerCase();
    const filtered = zones
      .filter((z) => z.toLowerCase().includes(q))
      .slice(0, 25)
      .map((z) => ({ name: z, value: z }));
    return NextResponse.json({ type: 8, data: { choices: filtered } });
  }

  if (focused.name === 'preset') {
    const { presets } = await listPotions();
    const q = String(focused.value ?? '').toLowerCase();
    const filtered = presets
      .filter((p) => p.id.toLowerCase().includes(q) || p.label.toLowerCase().includes(q))
      .slice(0, 25)
      .map((p) => ({ name: p.label, value: p.id }));
    return NextResponse.json({ type: 8, data: { choices: filtered } });
  }

  if (focused.name === 'name') {
    const user = interaction.member?.user;
    if (!user) return NextResponse.json({ type: 8, data: { choices: [] } });
    const loadouts = await listLoadoutsForDiscordUser(user.id);
    const q = String(focused.value ?? '').toLowerCase();
    const filtered = loadouts
      .filter((l) => l.name.toLowerCase().includes(q))
      .slice(0, 25)
      .map((l) => ({ name: `${l.name}${l.is_default ? ' ★' : ''}`, value: l.name }));
    return NextResponse.json({ type: 8, data: { choices: filtered } });
  }

  if (focused.name === 'step') {
    const guildId = String(findOption(sub?.options, 'guild')?.value ?? '');
    if (!guildId) return NextResponse.json({ type: 8, data: { choices: [] } });
    const steps = await listSteps(guildId);
    const q = String(focused.value ?? '').toLowerCase();
    const filtered = steps
      .filter(s => s.step_key.toLowerCase().includes(q) || s.label.toLowerCase().includes(q))
      .slice(0, 25)
      .map(s => ({ name: `${s.step_key} — ${s.label}`, value: s.step_key }));
    return NextResponse.json({ type: 8, data: { choices: filtered } });
  }

  return NextResponse.json({ type: 8, data: { choices: [] } });
}

/** Per-guild staff role gate. Returns NextResponse if denied, null if ok. */
async function gateStaffRole(interaction: Interaction, guildId: string) {
  const config = await getAssaultConfig(guildId);
  if (!config) return ephemeral(`No assault config for guild \`${guildId}\`.`);
  if (!config.staff_role_id) return null; // no role configured = allow (relies on Discord command permission)
  const roles = interaction.member?.roles ?? [];
  if (!roles.includes(config.staff_role_id)) {
    return ephemeral(`You lack permission. Requires <@&${config.staff_role_id}>.`);
  }
  return null;
}

/** Main dispatcher for /assault subcommands. */
export async function handleAssaultCommand(interaction: Interaction) {
  const sub = interaction.data.options?.[0];
  if (!sub) return ephemeral('Missing subcommand.');

  switch (sub.name) {
    case 'status':
      return handleStatus();
    case 'toggle':
      return handleToggle(interaction, sub);
    case 'set-time':
      return handleSetTime(interaction, sub);
    case 'set-zone':
      return handleSetZone(interaction, sub);
    case 'ping-now':
      return handlePingNow(interaction, sub);
    case 'skip-today':
      return handleSkipToday(interaction, sub);
    case 'lb':
      return handleLb(sub);
    case 'last':
      return handleLast(sub);
    case 'checklist':
      return handleChecklist(interaction, sub);
    case 'plan':
      return handlePlan(interaction, sub);
    case 'conquest':
      return handleConquest();
    case 'potions':
      return handlePotions(sub);
    case 'loadout':
      return handleLoadout(interaction, sub);
    default:
      return ephemeral(`Unknown subcommand: ${sub.name}`);
  }
}

interface RunRow {
  id: string;
  guild_id: string;
  zone_name: string;
  starts_at: string;
  total_kills: number;
  total_experience: number;
  season_number: number | null;
}

interface ContribRow {
  character_name: string;
  total_level: number | null;
  kills: number;
  experience: number;
  run_id: string;
}

async function handleLb(sub: Option) {
  const guildId = String(findOption(sub.options, 'guild')?.value ?? '');
  const season = findOption(sub.options, 'season')?.value as number | undefined;
  const supabase = createAdminClient();

  let q = supabase.from('assault_runs').select('*').eq('status', 'finalized');
  if (guildId) q = q.eq('guild_id', guildId);
  if (season) q = q.eq('season_number', season);
  const { data: runs } = await q;
  const runList = (runs as RunRow[]) ?? [];
  const runIds = runList.map((r) => r.id);
  if (runIds.length === 0) return ephemeral('No finalized runs yet.');

  const { data: contribs } = await supabase
    .from('assault_contributions')
    .select('character_name, total_level, kills, experience, run_id')
    .in('run_id', runIds);

  const byName = new Map<string, { name: string; lvl: number | null; kills: number; xp: number; runs: number }>();
  for (const c of (contribs as ContribRow[]) ?? []) {
    const key = c.character_name.toLowerCase();
    const cur = byName.get(key);
    if (cur) {
      cur.kills += c.kills;
      cur.xp += c.experience;
      cur.runs += 1;
    } else {
      byName.set(key, { name: c.character_name, lvl: c.total_level, kills: c.kills, xp: c.experience, runs: 1 });
    }
  }
  const top = Array.from(byName.values()).sort((a, b) => b.kills - a.kills).slice(0, 10);
  const header = `🏆 **Assault Leaderboard**${guildId ? ` — ${await getGuildName(guildId)}` : ''}${season ? ` · Season ${season}` : ''}`;
  const lines = top.map((e, i) => `**${i + 1}.** ${e.name}${e.lvl ? ` (Lv ${e.lvl})` : ''} — ${e.kills.toLocaleString()} kills · ${e.xp.toLocaleString()} XP · ${e.runs} runs`);
  return NextResponse.json({ type: 4, data: { content: [header, ...lines].join('\n'), flags: 64 } });
}

async function handleLast(sub: Option) {
  const guildId = String(findOption(sub.options, 'guild')?.value ?? '');
  if (!guildId) return ephemeral('Missing guild.');
  const supabase = createAdminClient();
  const { data } = await supabase
    .from('assault_runs')
    .select('*')
    .eq('guild_id', guildId)
    .eq('status', 'finalized')
    .order('starts_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const run = data as RunRow | null;
  if (!run) return ephemeral('No finalized runs yet.');
  const { data: contribs } = await supabase
    .from('assault_contributions')
    .select('character_name, total_level, kills, experience, run_id')
    .eq('run_id', run.id)
    .order('kills', { ascending: false })
    .limit(5);
  const name = await getGuildName(guildId);
  const top = ((contribs as ContribRow[]) ?? []).map((c, i) => `  ${i + 1}. ${c.character_name} — ${c.kills.toLocaleString()} kills`);
  const content =
    `⚔️ **Last Assault — ${name}** (${run.zone_name})\n` +
    `Started: <t:${Math.floor(new Date(run.starts_at).getTime() / 1000)}:f>\n` +
    `Total: **${run.total_kills.toLocaleString()} kills** · **${run.total_experience.toLocaleString()} XP**\n` +
    (top.length ? `Top 5:\n${top.join('\n')}` : '');
  return NextResponse.json({ type: 4, data: { content, flags: 64 } });
}

/** Resolve a launch context for the personal checklist.
 *  - If user has exactly one guild member role AND today is an assault day → use that guild's launch time.
 *  - Otherwise → personal mode: launch_date = today, no absolute timestamps.
 */
async function resolveLaunchContext(interaction: Interaction): Promise<{
  launchDate: string;
  launchTimeUtc: string | null;
  guildLabel: string | null;
  config: AssaultConfig | null;
  mode: 'guild' | 'personal' | 'ambiguous';
  matchedLabels: string[];
}> {
  const roles = interaction.member?.roles;
  const inferred = inferGuildFromRoles(roles);
  const today = new Date().toISOString().slice(0, 10);
  if (!inferred.ok) {
    return {
      launchDate: today,
      launchTimeUtc: null,
      guildLabel: null,
      config: null,
      mode: inferred.reason === 'ambiguous' ? 'ambiguous' : 'personal',
      matchedLabels: inferred.reason === 'ambiguous' ? inferred.matchedLabels : [],
    };
  }
  // Infer guild_id from guild name (label). We assume guild_config.guild_name matches.
  const supabase = createAdminClient();
  const { data: gc } = await supabase
    .from('guild_config')
    .select('guild_id')
    .ilike('guild_name', inferred.guildLabel)
    .maybeSingle();
  const guildId = gc?.guild_id as string | undefined;
  if (!guildId) {
    return { launchDate: today, launchTimeUtc: null, guildLabel: inferred.guildLabel, config: null, mode: 'personal', matchedLabels: [] };
  }
  const config = await getAssaultConfig(guildId);
  if (!config || !isAssaultDay(config)) {
    return { launchDate: today, launchTimeUtc: null, guildLabel: inferred.guildLabel, config, mode: 'personal', matchedLabels: [] };
  }
  const launchDate = computeLaunchDate(config.launch_time_utc);
  return {
    launchDate,
    launchTimeUtc: config.launch_time_utc,
    guildLabel: inferred.guildLabel,
    config,
    mode: 'guild',
    matchedLabels: [],
  };
}

async function handleChecklist(interaction: Interaction, _sub: Option) {
  const user = interaction.member?.user;
  if (!user) return ephemeral('No user context.');

  const ctx = await resolveLaunchContext(interaction);
  if (ctx.mode === 'ambiguous') {
    return ephemeral(
      `You have both guild member roles (${ctx.matchedLabels.join(', ')}). Can't infer a single guild. Pick a loadout tied to a specific guild config, or remove one role.`,
    );
  }

  const [template, { combat, xp }, loadout] = await Promise.all([
    getChecklistTemplate(),
    listPotions(),
    getLoadoutForDiscordUser(user.id),
  ]);
  if (template.length === 0) return ephemeral('No checklist template configured.');

  const items = buildTimedChecklist(template, loadout, combat, xp, ctx.launchTimeUtc);
  const checked = await getDiscordChecked(user.id, ctx.launchDate);

  const { content, components } = buildChecklistPayload({
    launchDate: ctx.launchDate,
    guildLabel: ctx.guildLabel,
    mode: ctx.mode,
    loadoutName: loadout?.name ?? null,
    items,
    checked,
  });
  return NextResponse.json({
    type: 4,
    data: { content, components, flags: 64 },
  });
}

/** Build the checklist message payload (content + components). Used by both initial render and UPDATE_MESSAGE. */
export function buildChecklistPayload(opts: {
  launchDate: string;
  guildLabel: string | null;
  mode: 'guild' | 'personal';
  loadoutName: string | null;
  items: ChecklistItem[];
  checked: Set<string>;
}): { content: string; components: unknown[] } {
  const { launchDate, guildLabel, mode, loadoutName, items, checked } = opts;
  const total = items.length;
  const done = items.filter((i) => checked.has(i.item_key)).length;
  const header = mode === 'guild'
    ? `✅ **Assault Checklist** — ${guildLabel ?? 'personal'} · ${launchDate}`
    : `✅ **Assault Checklist** — personal${guildLabel ? ` (${guildLabel}, no assault today)` : ''}`;
  const loadoutLine = loadoutName ? `Loadout: **${loadoutName}**` : 'No loadout linked (run `/assault potions` to pick one — timed rows hidden).';
  const content = `${header}\nProgress: **${done}/${total}** · ${loadoutLine}`;

  // 5 rows × 5 buttons = 25 max; reserve last row for Reset. 4 rows × 5 = 20 item buttons.
  const rendered = items.slice(0, 20);
  const rows: unknown[] = [];
  let row: unknown[] = [];
  for (const it of rendered) {
    const isDone = checked.has(it.item_key);
    const timeBit = it.time_label ? `[${it.time_label}] ` : '';
    row.push({
      type: 2, // Button
      style: isDone ? 3 /* success */ : 2 /* secondary */,
      label: `${isDone ? '✅' : '⬜'} ${timeBit}${it.label}`.slice(0, 80),
      custom_id: `assault_check:${launchDate}:${it.item_key}`.slice(0, 100),
    });
    if (row.length === 5) {
      rows.push({ type: 1, components: row });
      row = [];
    }
  }
  if (row.length > 0 && rows.length < 4) {
    rows.push({ type: 1, components: row });
    row = [];
  }
  // Reset button on its own row
  rows.push({
    type: 1,
    components: [
      {
        type: 2,
        style: 4, // danger
        label: '🔄 Reset',
        custom_id: `assault_check_reset:${launchDate}`.slice(0, 100),
      },
    ],
  });
  return { content, components: rows };
}

async function handleStatus() {
  const configs = await listAssaultConfigs();
  if (configs.length === 0) return ephemeral('No assault configs exist.');
  const lines: string[] = [];
  const now = new Date();
  for (const c of configs) {
    const name = await getGuildName(c.guild_id);
    const state = c.active ? '🟢 Active' : '⏸️ Paused';
    const skip = c.skip_date === utcDateString(now) ? ' (today skipped)' : '';
    const nextUnix = nextAssaultLaunchUnix(c, now);
    const launchLine = nextUnix
      ? `Next launch: <t:${nextUnix}:F> (<t:${nextUnix}:R>)`
      : `Next launch: — (no assault day scheduled)`;
    lines.push(
      `**${name}** — ${state}${skip}\n` +
        `${launchLine} • Zone: ${c.zone_name} • Shrine: ${c.shrine_info}`
    );
  }
  return NextResponse.json({ type: 4, data: { content: lines.join('\n\n'), flags: 64 } });
}

async function handleToggle(interaction: Interaction, sub: Option) {
  const guildId = String(findOption(sub.options, 'guild')?.value ?? '');
  const state = String(findOption(sub.options, 'state')?.value ?? '');
  if (!guildId || !state) return ephemeral('Missing guild or state.');
  const denied = await gateStaffRole(interaction, guildId);
  if (denied) return denied;
  await upsertAssaultConfig(guildId, { active: state === 'active' });
  return ephemeral(`Set \`${guildId}\` to **${state}**.`);
}

async function handleSetTime(interaction: Interaction, sub: Option) {
  const guildId = String(findOption(sub.options, 'guild')?.value ?? '');
  const time = String(findOption(sub.options, 'time')?.value ?? '');
  if (!guildId || !time) return ephemeral('Missing guild or time.');
  if (!/^\d{2}:\d{2}$/.test(time)) return ephemeral('Time must be `HH:MM` 24h UTC.');
  const denied = await gateStaffRole(interaction, guildId);
  if (denied) return denied;
  await upsertAssaultConfig(guildId, { launch_time_utc: `${time}:00` });
  const launchUnix = todayLaunchUnix(`${time}:00`);
  return ephemeral(`Launch for \`${guildId}\` set to **${time} UTC** (<t:${launchUnix}:t> / <t:${launchUnix}:R>).`);
}

async function handleSetZone(interaction: Interaction, sub: Option) {
  const guildId = String(findOption(sub.options, 'guild')?.value ?? '');
  if (!guildId) return ephemeral('Missing guild.');
  const denied = await gateStaffRole(interaction, guildId);
  if (denied) return denied;
  const zone = findOption(sub.options, 'zone')?.value as string | undefined;
  const shrine = findOption(sub.options, 'shrine')?.value as string | undefined;
  const mobOrder = findOption(sub.options, 'mob_order')?.value as string | undefined;
  const patch: Record<string, unknown> = {};
  if (zone) patch.zone_name = zone;
  if (shrine) patch.shrine_info = shrine;
  if (mobOrder) {
    // store as single synthetic enemy entry to override formatted mob_order
    patch.enemy_priority = [{ name: mobOrder, level: 0, gold_per_hr: 0 }];
  }
  if (Object.keys(patch).length === 0) return ephemeral('Provide at least one of zone / shrine / mob_order.');
  await upsertAssaultConfig(guildId, patch);
  return ephemeral(`Updated \`${guildId}\`: ${Object.keys(patch).join(', ')}.`);
}

async function handleSkipToday(interaction: Interaction, sub: Option) {
  const guildId = String(findOption(sub.options, 'guild')?.value ?? '');
  if (!guildId) return ephemeral('Missing guild.');
  const denied = await gateStaffRole(interaction, guildId);
  if (denied) return denied;
  await upsertAssaultConfig(guildId, { skip_date: utcDateString() });
  return ephemeral(`Today's pings for \`${guildId}\` skipped. Tomorrow's schedule unaffected.`);
}

async function handlePingNow(interaction: Interaction, sub: Option) {
  const guildId = String(findOption(sub.options, 'guild')?.value ?? '');
  const stepKey = String(findOption(sub.options, 'step')?.value ?? '');
  if (!guildId || !stepKey) return ephemeral('Missing guild or step.');
  const denied = await gateStaffRole(interaction, guildId);
  if (denied) return denied;

  // Defer, then fire asynchronously.
  waitUntil(firePingNow(interaction, guildId, stepKey));
  return NextResponse.json({ type: 5, data: { flags: 64 } });
}

async function firePingNow(interaction: Interaction, guildId: string, stepKey: string) {
  try {
    const config = await getAssaultConfig(guildId);
    if (!config?.announcement_channel_id) {
      await editOriginalInteractionResponse(interaction.application_id, interaction.token, {
        content: 'No announcement_channel_id configured.',
      });
      return;
    }
    const steps = await listSteps(guildId);
    const step = steps.find(s => s.step_key === stepKey);
    if (!step) {
      await editOriginalInteractionResponse(interaction.application_id, interaction.token, {
        content: `Step \`${stepKey}\` not found.`,
      });
      return;
    }
    const guildName = await getGuildName(guildId);
    const launchUnix = todayLaunchUnix(config.launch_time_utc);
    const vars = buildTemplateVars(config, guildName, launchUnix);
    const rolePrefix = step.mention_roles.length
      ? step.mention_roles.map(r => `<@&${r}>`).join(' ') + ' '
      : '';
    const content = rolePrefix + renderTemplate(step.message_template, vars);
    const res = await postToChannelReturnId(config.announcement_channel_id, content);
    if (!res.ok) {
      await editOriginalInteractionResponse(interaction.application_id, interaction.token, {
        content: `Post failed: ${res.error}`,
      });
      return;
    }
    // Record as sent so scheduler won't double-fire the same step today
    const launchDate = utcDateString();
    if (!(await isAlreadySent(guildId, step.id, launchDate))) {
      await markSent(guildId, step.id, launchDate, res.messageId);
    }
    await editOriginalInteractionResponse(interaction.application_id, interaction.token, {
      content: `✅ Fired \`${stepKey}\` for \`${guildId}\`.`,
    });
  } catch (err) {
    await editOriginalInteractionResponse(interaction.application_id, interaction.token, {
      content: `Error: ${String(err)}`,
    });
  }
}

async function handlePlan(interaction: Interaction, sub: Option) {
  const guildId = String(findOption(sub.options, 'guild')?.value ?? '');
  if (!guildId) return ephemeral('Missing guild.');
  const denied = await gateStaffRole(interaction, guildId);
  if (denied) return denied;

  const zoneOverride = findOption(sub.options, 'zone')?.value as string | undefined;
  const config = await getAssaultConfig(guildId);
  const zone = zoneOverride || config?.zone_name;
  if (!zone) return ephemeral('No zone configured for this guild and no override provided.');

  const plan = await getZonePlan(zone);
  if (plan.enemies.length === 0) {
    return ephemeral(`No enemies cached for zone **${zone}**. Run combat-enemies-sync first.`);
  }

  const shrine =
    shrineInfoFor(plan.zone) === 'On-site Shrine'
      ? '🛐 On-site Shrine'
      : (config?.shrine_info ?? 'No on-site shrine');
  const levelRange =
    plan.level_min === plan.level_max ? `Lv ${plan.level_min}` : `Lv ${plan.level_min}–${plan.level_max}`;
  const guildName = await getGuildName(guildId);
  const launchUnix = config ? todayLaunchUnix(config.launch_time_utc) : null;
  const targetMobs = config?.target_mob_count ?? '4,000–10,000+';

  const descLines = [
    `**${guildName}** — ${levelRange} · ${shrine}`,
    `💰 Best: **${plan.total_gph.toLocaleString()} g/h** · 🎯 Target: **${targetMobs}** mobs (+10–20% flee)`,
    launchUnix ? `⏰ Launch: <t:${launchUnix}:t> (<t:${launchUnix}:R>)` : null,
  ].filter(Boolean);

  const killPriority = plan.enemies.slice(0, 10).map((e, i) =>
    `**${i + 1}.** ${e.name} (Lv ${e.level}) — ${e.gph.toLocaleString()} g/h · ${e.drop_count} drops`
  ).join('\n').slice(0, 1024);

  const prep = FIVE_PS.map((p, i) => `**${i + 1}. ${p.when}** — ${p.text}`).join('\n').slice(0, 1024);

  const potions = POTION_SLOTS.map((s) => `**${s.slot}:** ${s.examples}`).join('\n').slice(0, 1024);

  const hitsTable =
    '```\nHits  Time/Kill  Kills/9h\n' +
    HITS_TO_KILL.map((h) => `${String(h.hits).padEnd(5)} ${h.time.padEnd(10)} ${h.kills}`).join('\n') +
    '\n```';

  const embed = {
    title: `🗺️ Assault Plan — ${plan.zone}`,
    description: descLines.join('\n'),
    color: 0xf59e0b,
    fields: [
      { name: '🎯 Kill Priority (gold/hr)', value: killPriority, inline: false },
      { name: '⚡ Prep Sequence', value: prep, inline: false },
      { name: '🧪 Potions (4 slots)', value: potions, inline: false },
      { name: '⚔️ Hits-to-Kill (target 2–3)', value: hitsTable.slice(0, 1024), inline: false },
      { name: '🛡️ Gear', value: `[Gear tiers & upgrades](${GEAR_LINK}) — BiS3+ legendary rec. for Isle of Whispers`, inline: false },
    ],
  };

  return NextResponse.json({ type: 4, data: { embeds: [embed] } });
}

async function handleConquest() {
  const expSplit = EXP_SPLIT.map((x) => `**${x.pct}** ${x.label}`).join(' · ');
  const notes = [
    '• Rounded down per enemy. Potions/buffs boost all three.',
    '• Min guild EXP ignores negative class effects (e.g. Forsaken −50%).',
    '• Higher-level / scaled enemies yield more EXP.',
    '• Only battles started *after* assault launch count.',
  ].join('\n');

  const territory =
    '```\nRank   EXP/MF   Primary Skill Eff\n' +
    TERRITORY_BOOSTS.map((b) =>
      `${b.place.padEnd(6)} +${String(b.expMf).padStart(2)}%     +${b.eff}%`
    ).join('\n') + '\n```';

  const fmtRewards = (rows: typeof EXP_REWARDS) =>
    '```\n' +
    rows.map((r) => `${r.place.padEnd(10)} ${r.shards.toLocaleString().padStart(7)} shards`).join('\n') +
    '\n```';

  const embed = {
    title: '⚔️ Conquest Mechanics',
    description: 'How EXP, territory, and shard rewards work.',
    color: 0x8b5cf6,
    fields: [
      { name: '⚡ EXP split per kill', value: `${expSplit}\n\n${notes}`, inline: false },
      { name: '⏳ Waves & cost', value: 'Wave length: **1 hour** · Cost: **1 mark / wave**', inline: false },
      {
        name: '👑 Territory boosts (next season, top 10)',
        value:
          territory +
          '\nApplies to Primary Skill EXP, Dungeon/World Boss/Combat/Hunting/Slayer EXP, and Dungeon/World Boss MF. Combat EXP bonus applies only during 14-day assault cooldown (seasons from 2026-06-01).',
        inline: false,
      },
      { name: '🏆 EXP leaderboard rewards', value: fmtRewards(EXP_REWARDS), inline: true },
      { name: '🎯 Kills leaderboard rewards', value: fmtRewards(KILL_REWARDS), inline: true },
      { name: '💡 Note', value: 'You can place on both leaderboards per zone. Rewards stack across zones.', inline: false },
    ],
  };

  return NextResponse.json({ type: 4, data: { embeds: [embed], flags: 64 } });
}

function qualityEmoji(q: string | null | undefined): string {
  switch ((q ?? '').toUpperCase()) {
    case 'MYTHIC': return '🔴';
    case 'LEGENDARY': return '🟡';
    case 'EPIC': return '🟣';
    case 'PREMIUM': return '⚪';
    case 'STANDARD': return '⚫';
    default: return '·';
  }
}

function formatCombatBonus(p: CombatPotion): string {
  const parts: string[] = [];
  if (p.attack_power_bonus > 0) {
    parts.push(`+${p.attack_power_bonus}${p.attack_power_is_percentage ? '%' : ''} ATK`);
  }
  if (p.protection_bonus > 0) {
    parts.push(`+${p.protection_bonus}${p.protection_is_percentage ? '%' : ''} PROT`);
  }
  return parts.join(' · ');
}

function formatXpBonus(p: XpPotion): string {
  const parts: string[] = [];
  if (p.xp_value > 0) parts.push(`+${p.xp_value}% XP`);
  if (p.efficiency_value > 0) parts.push(`+${p.efficiency_value}% eff`);
  return parts.join(' · ');
}

function formatDuration(mins: number | null | undefined): string {
  if (!mins) return '';
  if (mins >= 60) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m ? `${h}h${m}m` : `${h}h`;
  }
  return `${mins}m`;
}

function renderPresetField(preset: Preset, combat: CombatPotion[], xp: XpPotion[]): { name: string; value: string; inline?: boolean } {
  const cById = new Map(combat.map((p) => [p.id, p]));
  const xById = new Map(xp.map((p) => [p.id, p]));
  const lines: string[] = [];
  for (const id of preset.combat_potion_ids) {
    const p = cById.get(id);
    if (!p) continue;
    const bits = [qualityEmoji(p.quality), `**${p.name}**`, formatCombatBonus(p), formatDuration(p.duration_minutes)].filter(Boolean);
    lines.push(bits.join(' '));
  }
  for (const id of preset.xp_potion_ids) {
    const p = xById.get(id);
    if (!p) continue;
    const bits = [qualityEmoji(p.quality), `**${p.name}**`, formatXpBonus(p), formatDuration(p.duration_minutes)].filter(Boolean);
    lines.push(bits.join(' '));
  }
  const cost = loadoutCost(
    { combat_potion_ids: preset.combat_potion_ids, xp_potion_ids: preset.xp_potion_ids },
    combat,
    xp,
  );
  lines.push(`— ≈ **${cost.tradeable.toLocaleString()}g**${cost.hasUnpriced ? ' + free/unpriced' : ''}`);
  const value = lines.join('\n').slice(0, 1024) || '(empty)';
  return { name: `${preset.label}`, value };
}

// --------------------------------------------------------------------------
// Interactive potion picker
// --------------------------------------------------------------------------
// State is encoded in a hidden "state code" shown in the embed description that
// the user never has to see interactively — all mutation happens via custom_ids
// which carry only the delta. We store the working loadout in memory: we re-parse
// it back out of the embed content by reading the component values in the last
// interaction. To avoid that fragility we instead include a compact encoded
// state in a hidden footer line: `state=cc:<id>,cx:<id>,bx:<id>` which the
// message update preserves.

interface WorkingLoadout {
  combatCombinedId: number | null; // primary combat potion (combined or single-slot)
  combatSecondaryId: number | null; // optional second combat potion (e.g. protection when primary = attack)
  combatXpId: number | null;
  battleXpId: number | null;
}

function encodeState(w: WorkingLoadout): string {
  const bits: string[] = [];
  bits.push(`cc:${w.combatCombinedId ?? ''}`);
  bits.push(`c2:${w.combatSecondaryId ?? ''}`);
  bits.push(`cx:${w.combatXpId ?? ''}`);
  bits.push(`bx:${w.battleXpId ?? ''}`);
  return bits.join(',');
}

function decodeState(s: string): WorkingLoadout {
  const w: WorkingLoadout = { combatCombinedId: null, combatSecondaryId: null, combatXpId: null, battleXpId: null };
  for (const part of s.split(',')) {
    const [k, v] = part.split(':');
    if (!v) continue;
    const id = parseInt(v, 10);
    if (Number.isNaN(id)) continue;
    if (k === 'cc') w.combatCombinedId = id;
    else if (k === 'c2') w.combatSecondaryId = id;
    else if (k === 'cx') w.combatXpId = id;
    else if (k === 'bx') w.battleXpId = id;
  }
  return w;
}

function emptyWorking(): WorkingLoadout {
  return { combatCombinedId: null, combatSecondaryId: null, combatXpId: null, battleXpId: null };
}

function extractStateFromContent(content: string | undefined): WorkingLoadout {
  if (!content) return emptyWorking();
  const m = content.match(/state=([^\s`]+)/);
  if (!m) return emptyWorking();
  return decodeState(m[1]);
}

function presetToWorking(preset: Preset, combat: CombatPotion[], _xp: XpPotion[]): WorkingLoadout {
  // Prefer combined potion as primary; otherwise first combat → primary, second → secondary.
  const combatIds = preset.combat_potion_ids;
  const cById = new Map(combat.map((p) => [p.id, p]));
  let primaryId: number | null = null;
  let secondaryId: number | null = null;
  for (const id of combatIds) {
    const p = cById.get(id);
    if (!p) continue;
    if (p.attack_power_bonus > 0 && p.protection_bonus > 0) { primaryId = p.id; break; }
  }
  if (primaryId == null) {
    const remaining = combatIds.filter((id) => cById.has(id));
    primaryId = remaining[0] ?? null;
    secondaryId = remaining[1] ?? null;
  } else {
    secondaryId = combatIds.find((id) => id !== primaryId && cById.has(id)) ?? null;
  }
  const cxId = preset.xp_potion_ids.find((id) => id >= 100 && id < 200) ?? null;
  const bxId = preset.xp_potion_ids.find((id) => id >= 200) ?? null;
  return { combatCombinedId: primaryId, combatSecondaryId: secondaryId, combatXpId: cxId, battleXpId: bxId };
}

function loadoutToWorking(l: SavedLoadout, combat: CombatPotion[]): WorkingLoadout {
  const cById = new Map(combat.map((p) => [p.id, p]));
  let primaryId: number | null = null;
  let secondaryId: number | null = null;
  for (const id of l.combat_potion_ids) {
    const p = cById.get(id);
    if (!p) continue;
    if (p.attack_power_bonus > 0 && p.protection_bonus > 0) { primaryId = p.id; break; }
  }
  if (primaryId == null) {
    const remaining = l.combat_potion_ids.filter((id) => cById.has(id));
    primaryId = remaining[0] ?? null;
    secondaryId = remaining[1] ?? null;
  } else {
    secondaryId = l.combat_potion_ids.find((id) => id !== primaryId && cById.has(id)) ?? null;
  }
  const cxId = l.xp_potion_ids.find((id) => id >= 100 && id < 200) ?? null;
  const bxId = l.xp_potion_ids.find((id) => id >= 200) ?? null;
  return { combatCombinedId: primaryId, combatSecondaryId: secondaryId, combatXpId: cxId, battleXpId: bxId };
}

function workingToIds(w: WorkingLoadout): { combat_potion_ids: number[]; xp_potion_ids: number[] } {
  const combat: number[] = [];
  if (w.combatCombinedId != null) combat.push(w.combatCombinedId);
  if (w.combatSecondaryId != null && w.combatSecondaryId !== w.combatCombinedId) combat.push(w.combatSecondaryId);
  const xp: number[] = [];
  if (w.combatXpId != null) xp.push(w.combatXpId);
  if (w.battleXpId != null) xp.push(w.battleXpId);
  return { combat_potion_ids: combat, xp_potion_ids: xp };
}

function renderPicker(opts: {
  working: WorkingLoadout;
  combat: CombatPotion[];
  xp: XpPotion[];
  presets: Preset[];
  savedLoadouts: SavedLoadout[];
  title: string;
}): { content: string; components: unknown[] } {
  const { working, combat, xp, presets, savedLoadouts, title } = opts;
  const cById = new Map(combat.map((p) => [p.id, p]));
  const xById = new Map(xp.map((p) => [p.id, p]));

  const cc = working.combatCombinedId != null ? cById.get(working.combatCombinedId) : null;
  const c2 = working.combatSecondaryId != null ? cById.get(working.combatSecondaryId) : null;
  const cx = working.combatXpId != null ? xById.get(working.combatXpId) : null;
  const bx = working.battleXpId != null ? xById.get(working.battleXpId) : null;

  const lines: string[] = [`🧪 **${title}**`];
  const fmtCombat = (p: CombatPotion | null | undefined) =>
    p ? `${qualityEmoji(p.quality)} **${p.name}** — ${formatCombatBonus(p)}${formatDuration(p.duration_minutes) ? ` · ${formatDuration(p.duration_minutes)}` : ''}` : '— empty';
  const fmtXp = (p: XpPotion | null | undefined) =>
    p ? `${qualityEmoji(p.quality)} **${p.name}** — ${formatXpBonus(p)}${formatDuration(p.duration_minutes) ? ` · ${formatDuration(p.duration_minutes)}` : ''}` : '— empty';
  lines.push(`**Combat #1:** ${fmtCombat(cc)}`);
  lines.push(`**Combat #2:** ${fmtCombat(c2)}`);
  lines.push(`**Combat XP:** ${fmtXp(cx)}`);
  lines.push(`**Battle XP:** ${fmtXp(bx)}`);

  const cost = loadoutCost(workingToIds(working), combat, xp);
  lines.push(`**Cost:** ≈ **${cost.tradeable.toLocaleString()}g**${cost.hasUnpriced ? ' + free/unpriced' : ''}`);
  lines.push(`\`state=${encodeState(working)}\``);

  // Presets + saved loadouts select
  const presetOptions = [
    ...presets.map((p) => ({ label: `Preset: ${p.label}`.slice(0, 100), value: `preset:${p.id}`, description: (p.description ?? '').slice(0, 100) || undefined })),
    ...savedLoadouts.slice(0, 15).map((l) => ({ label: `Mine: ${l.name}${l.is_default ? ' ★' : ''}`.slice(0, 100), value: `saved:${l.id}` })),
  ].slice(0, 25);

  const combatPool = combat.filter((p) => (p.attack_power_bonus ?? 0) + (p.protection_bonus ?? 0) > 0).slice(0, 25);

  const cxChoices = xp
    .filter((p) => p.category === 'combat_xp')
    .slice(0, 25)
    .map((p) => ({
      label: `${qualityEmoji(p.quality)} ${p.name}`.slice(0, 100),
      value: String(p.id),
      description: `${formatXpBonus(p)}${formatDuration(p.duration_minutes) ? ` · ${formatDuration(p.duration_minutes)}` : ''}`.slice(0, 100),
      default: working.combatXpId === p.id,
    }));

  const bxChoices = xp
    .filter((p) => p.category === 'battle_xp')
    .slice(0, 25)
    .map((p) => ({
      label: `${qualityEmoji(p.quality)} ${p.name}`.slice(0, 100),
      value: String(p.id),
      description: `${formatXpBonus(p)}${formatDuration(p.duration_minutes) ? ` · ${formatDuration(p.duration_minutes)}` : ''}`.slice(0, 100),
      default: working.battleXpId === p.id,
    }));

  const components: unknown[] = [];
  if (presetOptions.length > 0) {
    components.push({
      type: 1,
      components: [{
        type: 3, // string select
        custom_id: 'pots_preset',
        placeholder: 'Load preset or saved loadout…',
        min_values: 1,
        max_values: 1,
        options: presetOptions,
      }],
    });
  }
  const combatMulti = combatPool.map((p) => ({
    label: `${qualityEmoji(p.quality)} ${p.name}`.slice(0, 100),
    value: String(p.id),
    description: `${formatCombatBonus(p)}${formatDuration(p.duration_minutes) ? ` · ${formatDuration(p.duration_minutes)}` : ''}`.slice(0, 100),
    default: working.combatCombinedId === p.id || working.combatSecondaryId === p.id,
  }));
  components.push({
    type: 1,
    components: [{
      type: 3,
      custom_id: 'pots_combat',
      placeholder: 'Combat potions (pick up to 2)…',
      min_values: 0,
      max_values: 2,
      options: combatMulti,
    }],
  });
  components.push({
    type: 1,
    components: [{
      type: 3,
      custom_id: 'pots_combat_xp',
      placeholder: 'Combat XP potion…',
      min_values: 0,
      max_values: 1,
      options: cxChoices,
    }],
  });
  components.push({
    type: 1,
    components: [{
      type: 3,
      custom_id: 'pots_battle_xp',
      placeholder: 'Battle XP potion…',
      min_values: 0,
      max_values: 1,
      options: bxChoices,
    }],
  });
  components.push({
    type: 1,
    components: [
      { type: 2, style: 3, label: '💾 Save as…', custom_id: 'pots_save' },
      { type: 2, style: 1, label: '⭐ Set as default', custom_id: 'pots_default' },
      { type: 2, style: 2, label: '🗑️ Clear', custom_id: 'pots_clear' },
    ],
  });

  return { content: lines.join('\n'), components };
}

async function handlePotions(_sub: Option) {
  // Can't get member.user here — handled at top level; use anonymous initial state.
  // Caller will supply user via interaction router; we build initial picker with default preset = free.
  const { combat, xp, presets } = await listPotions();
  const base = presets.find((p) => p.id === 'free') ?? presets[0];
  const working = base ? presetToWorking(base, combat, xp) : emptyWorking();
  const { content, components } = renderPicker({
    working, combat, xp, presets, savedLoadouts: [], title: 'Assault Potions — pick & save',
  });
  return NextResponse.json({ type: 4, data: { content, components, flags: 64 } });
}

/** Handle select-menu + button interactions for the potion picker.
 *  custom_ids: pots_preset | pots_combat | pots_combat_xp | pots_battle_xp | pots_save | pots_default | pots_clear
 *  Also handles the pots_save_modal_submit.
 */
export async function handleAssaultPotionsComponent(interaction: {
  token: string;
  application_id: string;
  member?: { user?: { id: string; username: string }; roles?: string[] };
  user?: { id: string; username: string };
  message?: { content?: string };
  data: {
    custom_id: string;
    values?: string[];
    components?: Array<{ components: Array<{ custom_id: string; value: string }> }>;
  };
}) {
  const user = interaction.member?.user ?? interaction.user;
  if (!user) return ephemeral('No user context.');
  const customId = interaction.data.custom_id;

  // Modal submit for Save-as — state is carried in custom_id suffix
  if (customId.startsWith('pots_save_modal:')) {
    const encodedState = customId.slice('pots_save_modal:'.length);
    const name = interaction.data.components?.[0]?.components?.[0]?.value?.trim();
    if (!name) return ephemeral('Name required.');
    const working = decodeState(encodedState);
    const ids = workingToIds(working);
    if (ids.combat_potion_ids.length === 0 && ids.xp_potion_ids.length === 0) {
      return ephemeral('Nothing to save — pick at least one potion.');
    }
    const saved = await saveDiscordLoadout(user.id, { name, ...ids });
    return NextResponse.json({ type: 4, data: { content: `💾 Saved loadout **${saved.name}**. Run \`/assault potions\` again or \`/assault loadout name:${saved.name}\` to view.`, flags: 64 } });
  }

  const { combat, xp, presets } = await listPotions();
  const savedLoadouts = await listLoadoutsForDiscordUser(user.id);
  let working = extractStateFromContent(interaction.message?.content);

  if (customId === 'pots_preset') {
    const v = interaction.data.values?.[0] ?? '';
    if (v.startsWith('preset:')) {
      const pid = v.slice('preset:'.length);
      const p = presets.find((x) => x.id === pid);
      if (p) working = presetToWorking(p, combat, xp);
    } else if (v.startsWith('saved:')) {
      const lid = v.slice('saved:'.length);
      const l = savedLoadouts.find((x) => x.id === lid);
      if (l) working = loadoutToWorking(l, combat);
    }
  } else if (customId === 'pots_combat') {
    const vs = interaction.data.values ?? [];
    working.combatCombinedId = vs[0] ? parseInt(vs[0], 10) : null;
    working.combatSecondaryId = vs[1] ? parseInt(vs[1], 10) : null;
  } else if (customId === 'pots_combat_xp') {
    const v = interaction.data.values?.[0];
    working.combatXpId = v ? parseInt(v, 10) : null;
  } else if (customId === 'pots_battle_xp') {
    const v = interaction.data.values?.[0];
    working.battleXpId = v ? parseInt(v, 10) : null;
  } else if (customId === 'pots_clear') {
    working = emptyWorking();
  } else if (customId === 'pots_default') {
    // Promote user's most recent saved loadout matching current state. If no match, hint to save first.
    const ids = workingToIds(working);
    const match = savedLoadouts.find((l) =>
      JSON.stringify([...l.combat_potion_ids].sort()) === JSON.stringify([...ids.combat_potion_ids].sort()) &&
      JSON.stringify([...l.xp_potion_ids].sort()) === JSON.stringify([...ids.xp_potion_ids].sort()),
    );
    if (!match) {
      return ephemeral('Save the current selection first (💾 Save as…), then click ⭐ Set as default.');
    }
    await setDiscordLoadoutDefault(user.id, match.id);
    return ephemeral(`⭐ **${match.name}** is now your default loadout.`);
  } else if (customId === 'pots_save') {
    // Open modal — carry working state in custom_id
    return NextResponse.json({
      type: 9, // MODAL
      data: {
        custom_id: `pots_save_modal:${encodeState(working)}`.slice(0, 100),
        title: 'Save loadout',
        components: [{
          type: 1,
          components: [{
            type: 4, // text input
            custom_id: 'pots_save_name',
            style: 1,
            label: 'Name',
            min_length: 1,
            max_length: 40,
            required: true,
            placeholder: 'e.g. my-mid',
          }],
        }],
      },
    });
  } else {
    return ephemeral(`Unknown action: ${customId}`);
  }

  const { content, components } = renderPicker({
    working, combat, xp, presets, savedLoadouts, title: 'Assault Potions — pick & save',
  });
  return NextResponse.json({ type: 7, data: { content, components, flags: 64 } });
}

function renderLoadoutEmbed(opts: {
  title: string;
  description: string;
  combatIds: number[];
  xpIds: number[];
  combat: CombatPotion[];
  xp: XpPotion[];
}): unknown {
  const { title, description, combatIds, xpIds, combat, xp } = opts;
  const state = getSlotState({ combat_potion_ids: combatIds, xp_potion_ids: xpIds }, combat, xp);
  const cost = loadoutCost({ combat_potion_ids: combatIds, xp_potion_ids: xpIds }, combat, xp);
  const line = (label: string, p: CombatPotion | XpPotion | null, bonus: string) =>
    `**${label}:** ${p ? `${qualityEmoji(p.quality)} ${p.name}${bonus ? ` — ${bonus}` : ''}${formatDuration(p.duration_minutes) ? ` · ${formatDuration(p.duration_minutes)}` : ''}` : '— (empty)'}`;
  const fields = [
    { name: 'Slots', value: [
      line('Battle XP', state.battle_xp, state.battle_xp ? formatXpBonus(state.battle_xp) : ''),
      line('Combat XP', state.combat_xp, state.combat_xp ? formatXpBonus(state.combat_xp) : ''),
      line('Attack', state.attack, state.attack ? formatCombatBonus(state.attack) : ''),
      line('Protection', state.protection, state.protection ? formatCombatBonus(state.protection) : ''),
    ].join('\n').slice(0, 1024), inline: false },
    { name: 'Cost', value: `≈ **${cost.tradeable.toLocaleString()}g**${cost.hasUnpriced ? ' + free/unpriced' : ''}`, inline: false },
  ];
  return { title, description, color: 0x10b981, fields };
}

async function handleLoadout(interaction: Interaction, sub: Option) {
  const user = interaction.member?.user;
  if (!user) return ephemeral('No user context.');
  const name = (findOption(sub.options, 'name')?.value as string | undefined)?.trim();
  const loadout = await getLoadoutForDiscordUser(user.id, name);
  if (!loadout) {
    const hint = 'No saved loadout yet. Run `/assault potions` to pick + save one.';
    return ephemeral(name ? `No loadout named \`${name}\`.\n${hint}` : hint);
  }
  const { combat, xp } = await listPotions();
  const embed = renderLoadoutEmbed({
    title: `🎒 ${loadout.name}${loadout.is_default ? ' ★ (default)' : ''}`,
    description: `Loadout for <@${user.id}>`,
    combatIds: loadout.combat_potion_ids,
    xpIds: loadout.xp_potion_ids,
    combat,
    xp,
  });
  return NextResponse.json({ type: 4, data: { embeds: [embed], flags: 64 } });
}

interface ComponentInteraction {
  token: string;
  application_id: string;
  member?: { user?: { id: string; username: string } };
  user?: { id: string; username: string };
  data: { custom_id: string };
}

/** Handle button clicks for the /assault checklist message. Returns UPDATE_MESSAGE (type 7). */
export async function handleAssaultChecklistComponent(interaction: ComponentInteraction & { member?: { roles?: string[] } }) {
  const customId = interaction.data.custom_id;
  const user = interaction.member?.user ?? interaction.user;
  if (!user) return ephemeral('No user context.');

  const toggleMatch = customId.match(/^assault_check:([^:]+):(.+)$/);
  const resetMatch = customId.match(/^assault_check_reset:([^:]+)$/);

  let launchDate: string;
  if (toggleMatch) {
    launchDate = toggleMatch[1];
    const itemKey = toggleMatch[2];
    await toggleDiscordItem(user.id, launchDate, itemKey);
  } else if (resetMatch) {
    launchDate = resetMatch[1];
    await resetDiscord(user.id, launchDate);
  } else {
    return ephemeral(`Unknown checklist action: ${customId}`);
  }

  // Re-resolve context exactly like the initial render so timed labels stay consistent
  // (user may now have a loadout linked between clicks).
  const ctx = await resolveLaunchContext(interaction as unknown as Interaction);
  const [template, { combat, xp }, loadout] = await Promise.all([
    getChecklistTemplate(),
    listPotions(),
    getLoadoutForDiscordUser(user.id),
  ]);
  const items = buildTimedChecklist(template, loadout, combat, xp, ctx.launchTimeUtc);
  const checked = await getDiscordChecked(user.id, launchDate);
  const { content, components } = buildChecklistPayload({
    launchDate,
    guildLabel: ctx.guildLabel,
    mode: ctx.mode === 'guild' ? 'guild' : 'personal',
    loadoutName: loadout?.name ?? null,
    items,
    checked,
  });

  return NextResponse.json({ type: 7, data: { content, components, flags: 64 } });
}
