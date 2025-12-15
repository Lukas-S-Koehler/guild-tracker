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
}

export interface ProcessedMember {
  ign: string;
  raids: number;
  gold: number;
  donations: Array<{ item: string; quantity: number; price: number; total: number }>;
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
  last_active_date: string | null;
  days_inactive: number;
  category: string;
}
