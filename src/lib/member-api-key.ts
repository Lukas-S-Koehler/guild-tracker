import { SupabaseClient } from '@supabase/supabase-js';

/**
 * Get the API key for the current user in the specified guild
 * @param supabase - Supabase client
 * @param userId - User ID
 * @param guildId - Guild ID
 * @returns API key or null if not found
 */
export async function getMemberApiKey(
  supabase: SupabaseClient,
  userId: string,
  guildId: string
): Promise<string | null> {
  try {
    // Get guild_member record
    const { data: guildMember, error: memberError } = await supabase
      .from('guild_members')
      .select('id')
      .eq('user_id', userId)
      .eq('guild_id', guildId)
      .single();

    if (memberError || !guildMember) {
      console.error('[getMemberApiKey] Error fetching guild member:', memberError);
      return null;
    }

    // Get API key for this guild member
    const { data: keyData, error: keyError } = await supabase
      .from('member_keys')
      .select('api_key')
      .eq('guild_member_id', guildMember.id)
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
