import { createServerClient as createSupabaseSSRClient } from '@supabase/ssr';
import { NextRequest } from 'next/server';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Function to create server client (for server-side API routes)
// Reads session from request cookies
export function createServerClient(request: Request | NextRequest) {
  return createSupabaseSSRClient(
    supabaseUrl,
    supabaseAnonKey,
    {
      cookies: {
        getAll() {
          const cookieHeader = request.headers.get('cookie') || '';
          return cookieHeader.split(';').map(cookie => {
            const [name, ...valueParts] = cookie.trim().split('=');
            return { name, value: valueParts.join('=') };
          }).filter(c => c.name);
        },
        setAll() {
          // Not needed for reading session in API routes
        },
      },
    }
  );
}
