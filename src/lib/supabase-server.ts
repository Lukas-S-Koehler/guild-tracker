import { createServerClient as createSupabaseSSRClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

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

// Function to create admin client with Service Role key
// ONLY use this for admin operations that require elevated permissions
// like accessing auth.admin.listUsers()
export function createAdminClient() {
  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}
