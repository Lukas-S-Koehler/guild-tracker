import type { ParsedActivity } from '@/types';

export interface ParseResult {
  members: Record<string, ParsedActivity>;
  memberStatusChanges: Array<{ ign: string; action: 'joined' | 'left' | 'kicked' }>;
}

/**
 * Parse Discord-style activity log
 * Format:
 * * Username
 * Participated in a raid.
 * 1d
 * * Username
 * Contributed 100 Item Name
 * 2h
 */
export function parseActivityLog(text: string): ParseResult {
  const rawLines = text.split(/\r?\n/);
  const lines = rawLines.map(l => l.trim()).filter(l => l !== '');
  const members: Record<string, ParsedActivity> = {};
  const memberStatusChanges: Array<{ ign: string; action: 'joined' | 'left' | 'kicked' }> = [];

  let currentMember: string | null = null;
  const raidRe = /participated in a raid/i;
  const contributedRe = /contributed\s+([\d,]+)\s+(.+)/i;
  const timeRe = /^\d+[smhdw]$/i;
  const joinedRe = /joined the guild/i;
  const leftRe = /left the guild/i;
  const kickedRe = /kicked from the guild/i;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // strip markdown formatting
    line = line.replace(/__|[*]{1,2}/g, '').trim();

    // skip pure timestamps
    if (!line || timeRe.test(line)) continue;

    // If the original raw line started with '*' treat as username
    const raw = rawLines[i] ?? '';
    const looksLikeStarUser = raw.trim().startsWith('*');

    // Heuristic: if line is followed by an action, treat it as username
    const next = (lines[i + 1] ?? '').trim();
    const nextIsAction = raidRe.test(next) || contributedRe.test(next);

    if (looksLikeStarUser || nextIsAction) {
      // username line
      const ign = line.replace(/^\*\s*/, '').trim();
      currentMember = ign;
      if (ign && !members[ign]) {
        members[ign] = { ign, raids: 0, donations: [] };
      }
      continue;
    }

    // If we reach here and currentMember is null, try to infer: if line itself is an action, skip
    if (!currentMember) {
      // If this line itself is an action but no username above, skip
      if (raidRe.test(line) || contributedRe.test(line)) continue;
      // Otherwise treat as a username fallback
      currentMember = line;
      if (!members[currentMember]) members[currentMember] = { ign: currentMember, raids: 0, donations: [] };
      continue;
    }

    // handle raid
    if (raidRe.test(line)) {
      members[currentMember].raids++;
      continue;
    }

    // handle contribution
    const m = line.match(contributedRe);
    if (m) {
      const qty = parseInt(m[1].replace(/,/g, ''), 10) || 0;
      let item = m[2].trim();
      item = item.replace(/__|[*]{1,2}/g, '').trim();
      members[currentMember].donations.push({ item, quantity: qty });
      continue;
    }

    // detect member status changes
    if (joinedRe.test(line)) {
      memberStatusChanges.push({ ign: currentMember, action: 'joined' });
      continue;
    }
    if (leftRe.test(line)) {
      memberStatusChanges.push({ ign: currentMember, action: 'left' });
      continue;
    }
    if (kickedRe.test(line)) {
      memberStatusChanges.push({ ign: currentMember, action: 'kicked' });
      continue;
    }
  }

  return { members, memberStatusChanges };
}


/**
 * Get unique item names from parsed activity data
 */
export function getUniqueItems(parsedData: ParseResult): string[] {
  const items = new Set<string>();

  for (const member in parsedData.members) {
    parsedData.members[member].donations.forEach(donation => {
      items.add(donation.item);
    });
  }

  return Array.from(items);
}

/**
 * Parse challenge data
 * Format:
 * 35
 * Siren's Soulstone21h
 * 0
 * Minotaur Hide21h
 * 
 * Quantity on one line, item name (with optional timestamp suffix) on next
 */
export function parseChallengeData(text: string): Array<{ name: string; quantity: number }> {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l);
  const items: Array<{ name: string; quantity: number }> = [];

  for (let i = 0; i < lines.length; i++) {
    let cell = lines[i];

    // Remove whitespace and normalize
    cell = cell.replace(/\s+/g, '');

    // Check if this line contains ONLY digits and commas (quantity)
    if (/^[\d,]+$/.test(cell)) {
      const quantity = parseInt(cell.replace(/,/g, ''));

      // Look ahead for item name on next line
      if (i + 1 < lines.length) {
        let nextCell = lines[i + 1].trim();

        // Remove timestamp suffix (23h, 1d, 2h, etc.)
        const itemName = nextCell.replace(/\d+[hHdDmMsS]+$/, '').trim();

        if (itemName && itemName !== '') {
          items.push({
            name: itemName,
            quantity: quantity
          });

          // Skip next line since we processed it
          i++;
        }
      }
    }
  }

  return items;
}
