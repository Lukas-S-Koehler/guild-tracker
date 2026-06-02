// Database types
export interface GuildConfig {
  id: string;
  guild_name: string;
  api_key: string;
  donation_requirement: number;
  created_at: string;
  updated_at: string;
}

export interface Member {
  id: string;
  ign: string;
  first_seen: string;
  last_seen: string;
  created_at: string;
}

export interface DailyLog {
  id: string;
  member_id: string;
  log_date: string;
  raids: number;
  gold_donated: number;
  met_requirement: boolean;
  created_at: string;
  updated_at: string;
  // Joined
  members?: Member;
}

export interface Challenge {
  id: string;
  challenge_date: string;
  raw_input: string | null;
  items: ChallengeItem[];
  total_cost: number;
  created_at: string;
}

export interface ChallengeItem {
  name: string;
  quantity: number;
  unit_price: number | null;
  total_price: number | null;
  is_expensive: boolean;
}

export interface MarketCache {
  id: string;
  item_name: string;
  item_id: string | null;
  price: number;
  cached_at: string;
}

// Parsed activity types
export interface ParsedActivity {
  ign: string;
  raids: number;
  donations: Array<{ item: string; quantity: number }>;
  deposits: Array<{ item: string; quantity: number }>;
}

export interface ProcessedMember {
  ign: string;
  raids: number;
  gold: number;
  deposits_gold: number;
  donations: Array<{
    item: string;
    quantity: number;
    price: number;
    total: number;
    initial_quantity?: number;
    percentage_of_initial?: number;
  }>;
  deposits: Array<{
    item: string;
    quantity: number;
    price: number;
    total: number;
    valid?: boolean;
  }>;
  meets_challenge_quantity?: boolean;
  manual_override?: boolean;
  log_order?: number;
}

// Leaderboard
export interface LeaderboardEntry {
  id: string;
  ign: string;
  total_raids: number;
  total_gold: number;
  activity_score: number;
  days_active: number;
}

// Inactivity
export interface InactivityEntry {
  id: string;
  ign: string;
  position: string;
  avatar_url: string | null;
  last_active_date: string | null;
  first_seen: string | null;
  days_inactive: number;
  category: string;
  warning_level: 'safe' | 'warn1' | 'warn2' | 'kick';
  has_alts?: boolean;
  alt_covered?: boolean;
  discord_id?: string | null;
}

// Alt characters
export interface MemberAlt {
  id: string;
  member_id: string;
  alt_ign: string;
  alt_hashed_id: string;
  alt_member_id: string | null;
  fetched_at: string;
}

export interface AltCharacter {
  id: number;
  hashed_id: string;
  name: string;
  class: string;
  total_level: number;
  created_at: string;
}

// Warnings
export interface Warning {
  id: string;
  member_id: string;
  guild_id: string;
  warning_level: 'warn1' | 'warn2' | 'kick';
  reason: string | null;
  is_auto: boolean;
  discord_dm_sent: boolean;
  discord_dm_error: string | null;
  warned_by_discord_id: string | null;
  warned_by_ign: string | null;
  created_at: string;
  // Joined
  members?: { ign: string; discord_id: string | null };
  guilds?: { name: string; nickname: string };
}

// Leaderboard (extended with alt merging)
export interface LeaderboardEntryMerged {
  id: string;
  ign: string;
  guild_nickname: string;
  guild_name: string;
  current_guild_id: string;
  total_raids: number;
  total_gold: number;
  activity_score: number;
  days_active: number;
  alt_count: number;
  alt_igns: string[];
}
