# Fixes Applied - Multi-Guild Authentication

## Issues Fixed

### 1. ✅ Unauthorized Error When Saving Configuration
**Problem**: Setup page showed "Unauthorized - Please sign in" when trying to save guild config, even though user was signed in and showed as LEADER.

**Root Cause**: The setup page was using plain `fetch()` which doesn't include the `x-guild-id` header required by the API routes.

**Fix**:
- Updated [src/app/setup/page.tsx](src/app/setup/page.tsx) to use `useApiClient()` hook
- Wrapped page in `ProtectedRoute` with `requiredRole="LEADER"`
- Changed from `fetch('/api/config')` to `api.get('/api/config')`
- Changed from manual POST to `api.post('/api/config', config)`

### 2. ✅ Setup Page Visible to Non-Leaders
**Problem**: Setup page and settings button were visible to all users, including non-leaders.

**Fix**:
- Added role check to hide Settings button for non-leaders in [src/app/page.tsx](src/app/page.tsx#L135-L142)
- Wrapped setup page in `ProtectedRoute` requiring LEADER role
- Only show "Setup Required" message if user is a LEADER

### 3. ✅ Dashboard Not Requiring Authentication
**Problem**: Dashboard page wasn't protected and wasn't using authenticated API calls.

**Fix**:
- Updated [src/app/page.tsx](src/app/page.tsx) to use `useApiClient()` hook
- Wrapped entire dashboard in `ProtectedRoute` requiring MEMBER role
- Changed all `fetch()` calls to use `api.get()` for proper authentication

### 4. ✅ No Display Name in Signup
**Problem**: Signup only collected email and password, making it hard for guild leaders to identify users when assigning roles.

**Fix**:
- Added display name field to [src/app/signup/page.tsx](src/app/signup/page.tsx)
- Updated [src/contexts/AuthContext.tsx](src/contexts/AuthContext.tsx) to accept and save display name in user metadata
- Updated deployment guide with SQL to query display names

## Files Modified

### Frontend Pages
1. `/src/app/page.tsx` - Dashboard
   - Uses `useApiClient()` for all API calls
   - Wrapped in `ProtectedRoute` (MEMBER)
   - Hides Settings button for non-leaders
   - Fixed null safety for stats

2. `/src/app/setup/page.tsx` - Settings
   - Uses `useApiClient()` for config operations
   - Wrapped in `ProtectedRoute` (LEADER)

3. `/src/app/signup/page.tsx` - Signup
   - Added display name input field
   - Passes display name to signUp function
   - Includes helpful text explaining purpose

### Core Components
4. `/src/contexts/AuthContext.tsx`
   - Updated `signUp()` to accept optional `displayName` parameter
   - Saves display name to Supabase user metadata
   - Updated TypeScript interface

### Documentation
5. `/MULTI_GUILD_DEPLOYMENT.md`
   - Updated SQL queries to show how to retrieve display names
   - Added instructions for viewing user display names

## How It Works Now

### Authentication Flow
1. User signs up with email, password, and display name
2. Display name is stored in Supabase `auth.users.raw_user_meta_data`
3. User confirms email
4. User signs in and selects guild
5. All API calls automatically include `x-guild-id` header via `useApiClient()`

### API Client Pattern
```typescript
// Old way (broken)
const response = await fetch('/api/config');

// New way (works)
import { useApiClient } from '@/lib/api-client';
const api = useApiClient();
const response = await api.get('/api/config');
```

### Role-Based UI
```typescript
import { useAuth } from '@/contexts/AuthContext';
const { hasRole } = useAuth();

// Hide UI elements based on role
{hasRole('LEADER') && (
  <Button>Settings</Button>
)}
```

### Querying Users with Display Names
```sql
SELECT
  id,
  email,
  raw_user_meta_data->>'display_name' as display_name
FROM auth.users;
```

## Testing Checklist

- [x] Sign in as LEADER - can access setup page
- [x] Sign in as LEADER - can save configuration
- [x] Sign in as OFFICER - cannot see Settings button
- [x] Sign in as MEMBER - cannot see Settings button
- [x] Signup with display name - name is saved
- [x] Dashboard requires authentication
- [x] All pages use `useApiClient()` for authenticated requests

## Notes

- The `useApiClient()` hook automatically gets the current guild ID from the auth context
- All protected pages are wrapped in `<ProtectedRoute>` which redirects to login if not authenticated
- Display names help guild leaders identify users when running SQL to assign guild memberships
- The API client adds the `x-guild-id` header which the backend `verifyAuth()` function checks
