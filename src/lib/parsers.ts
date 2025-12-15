import type { ParsedActivity } from '@/types';

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
export function parseActivityLog(text: string): Record<string, ParsedActivity> {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l);
  const members: Record<string, ParsedActivity> = {};

  let currentMember: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // Remove Discord/Markdown formatting (__text__ or **text**)
    line = line.replace(/__|[*]{1,2}/g, '').trim();

    // Skip empty lines and timestamps (1d, 2h, 21h, 2m, etc.)
    if (!line || /^\d+[hHdDmMsS]+$/.test(line)) {
      continue;
    }

    // Check if this is a member name line (starts with *)
    // The original line would have been "* Username"
    const originalLine = lines[i];
    if (originalLine.startsWith('*') || originalLine.startsWith('* ')) {
      // Extract username - remove the * and any formatting
      currentMember = line.replace(/^\*\s*/, '').trim();
      
      if (currentMember && !members[currentMember]) {
        members[currentMember] = {
          ign: currentMember,
          raids: 0,
          donations: []
        };
      }
      continue;
    }

    // Check if this is a raid
    if (line.toLowerCase().includes('participated in a raid')) {
      if (currentMember && members[currentMember]) {
        members[currentMember].raids++;
      }
      continue;
    }

    // Check if this is a donation (Contributed X ItemName)
    const donationMatch = line.match(/contributed\s+(\d+)\s+(.+)/i);
    if (donationMatch && currentMember && members[currentMember]) {
      const quantity = parseInt(donationMatch[1]);
      let itemName = donationMatch[2].trim();

      // Remove any remaining formatting
      itemName = itemName.replace(/__|[*]{1,2}/g, '').trim();

      members[currentMember].donations.push({
        item: itemName,
        quantity: quantity
      });
      continue;
    }

    // Ignore "Joined the guild", "Kicked from the guild", etc.
  }

  return members;
}

/**
 * Get unique item names from parsed activity data
 */
export function getUniqueItems(parsedData: Record<string, ParsedActivity>): string[] {
  const items = new Set<string>();

  for (const member in parsedData) {
    parsedData[member].donations.forEach(donation => {
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
