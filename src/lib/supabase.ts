import { createClient as createSupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Client for browser (anon key)
export const supabase = createSupabaseClient(supabaseUrl, supabaseAnonKey);

// Function to create anon client (for client-side use)
export function createClient() {
  return createSupabaseClient(supabaseUrl, supabaseAnonKey);
}

// Function to create service role client (for server-side API routes)
export function createServerClient() {
  return createSupabaseClient(supabaseUrl, supabaseServiceKey);
}
