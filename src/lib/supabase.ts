import { createBrowserClient } from '@supabase/ssr';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Client for browser - stores session in cookies for SSR compatibility
export const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey);

// Function to create browser client (for client-side use)
// This uses cookies instead of localStorage for SSR compatibility
export function createClient() {
  return createBrowserClient(supabaseUrl, supabaseAnonKey);
}
