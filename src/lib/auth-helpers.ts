import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';

export interface AuthResult {
  user: { id: string; email?: string };
  guildId: string;
  role: 'MEMBER' | 'OFFICER' | 'LEADER';
}

/**
 * Verify the user is authenticated and has access to the specified guild
 * @param request - The Next.js request object
 * @param requiredRole - Optional minimum role required ('MEMBER', 'OFFICER', or 'LEADER')
 * @returns AuthResult with user, guildId, and role, or NextResponse error
 */
export async function verifyAuth(
  request: Request,
  requiredRole?: 'MEMBER' | 'OFFICER' | 'LEADER'
): Promise<AuthResult | NextResponse> {
  const supabase = createServerClient(request);

  // 1. Check if user is authenticated
  const { data: { user }, error: userError } = await supabase.auth.getUser();

  console.log('[verifyAuth] Step 1 - User:', user?.id, 'Error:', userError?.message);

  if (userError || !user) {
    console.log('[verifyAuth] FAIL - Not authenticated');
    return NextResponse.json(
      { error: 'Unauthorized - Please sign in' },
      { status: 401 }
    );
  }

  // 2. Get guild ID from request header
  const guildId = request.headers.get('x-guild-id');

  console.log('[verifyAuth] Step 2 - Guild ID from header:', guildId);
  console.log('[verifyAuth] All request headers:', Object.fromEntries(request.headers.entries()));

  if (!guildId) {
    console.log('[verifyAuth] FAIL - No guild ID in header');
    return NextResponse.json(
      { error: 'Bad Request - No guild selected' },
      { status: 400 }
    );
  }

  // 3. Verify user has access to this guild
  const { data: membership, error: membershipError } = await supabase
    .from('guild_members')
    .select('role')
    .eq('user_id', user.id)
    .eq('guild_id', guildId)
    .single();

  console.log('[verifyAuth] Step 3 - Membership query:', {
    user_id: user.id,
    guild_id: guildId,
    found: !!membership,
    role: membership?.role,
    error: membershipError?.message || membershipError?.code
  });

  if (membershipError || !membership) {
    console.log('[verifyAuth] FAIL - No membership found or error');
    return NextResponse.json(
      { error: 'Forbidden - You do not have access to this guild' },
      { status: 403 }
    );
  }

  // 4. Check role if required
  if (requiredRole) {
    const roleHierarchy = { MEMBER: 0, OFFICER: 1, LEADER: 2 };
    const userRoleLevel = roleHierarchy[membership.role as keyof typeof roleHierarchy];
    const requiredRoleLevel = roleHierarchy[requiredRole];

    console.log('[verifyAuth] Step 4 - Role check:', {
      userRole: membership.role,
      requiredRole,
      userLevel: userRoleLevel,
      requiredLevel: requiredRoleLevel,
      passes: userRoleLevel >= requiredRoleLevel
    });

    if (userRoleLevel < requiredRoleLevel) {
      console.log('[verifyAuth] FAIL - Insufficient role');
      return NextResponse.json(
        { error: `Forbidden - ${requiredRole} role required` },
        { status: 403 }
      );
    }
  }

  console.log('[verifyAuth] SUCCESS - Auth verified');

  return {
    user: { id: user.id, email: user.email },
    guildId,
    role: membership.role as 'MEMBER' | 'OFFICER' | 'LEADER',
  };
}

/**
 * Helper to check if a value is a NextResponse (error response)
 */
export function isErrorResponse(value: AuthResult | NextResponse): value is NextResponse {
  return value instanceof NextResponse;
}
