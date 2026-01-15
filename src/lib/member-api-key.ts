import { SupabaseClient } from '@supabase/supabase-js';

/**
 * Get the API key for the current user (account-based, shared across all guilds)
 * @param supabase - Supabase client
 * @param userId - User ID
 * @param guildId - Guild ID (kept for API compatibility, not used)
 * @returns API key or null if not found
 */
export async function getMemberApiKey(
  supabase: SupabaseClient,
  userId: string,
  _guildId?: string // Kept for backward compatibility but not used
): Promise<string | null> {
  try {
    // Get API key for this user (account-based, not guild-based)
    const { data: keyData, error: keyError } = await supabase
      .from('user_api_keys')
      .select('api_key')
      .eq('user_id', userId)
      .single();

    if (keyError && keyError.code !== 'PGRST116') {
      console.error('[getMemberApiKey] Error fetching API key:', keyError);
      return null;
    }

    return keyData?.api_key || null;
  } catch (error) {
    console.error('[getMemberApiKey] Unexpected error:', error);
    return null;
  }
}
