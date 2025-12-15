# Multi-Guild Deployment Guide

This guide walks you through deploying the multi-guild version of the Guild Tracker with authentication and role-based permissions.

## Prerequisites

- Existing Supabase project
- Next.js app deployed (Vercel, Netlify, etc.) or ready to deploy

## Step 1: Database Migration

Run the multi-guild database migration in your Supabase SQL Editor:

1. Go to your Supabase project → SQL Editor
2. Open and run [database/multi-guild-phase1.sql](database/multi-guild-phase1.sql)

This will:
- ✅ Create the `guild_members` table
- ✅ Enable Row Level Security (RLS) on all tables
- ✅ Add RLS policies to scope data by guild
- ✅ Create helper functions for permission checks

## Step 2: Enable Supabase Authentication

### In Supabase Dashboard

1. Go to **Authentication** → **Providers**
2. Enable **Email** provider
3. Configure email settings:
   - **Confirm email**: Enable (recommended for production)
   - **Secure email change**: Enable
   - **Email OTP expiration**: 3600 seconds (1 hour)

### Configure Email Templates (Optional but Recommended)

1. Go to **Authentication** → **Email Templates**
2. Customize the confirmation email template
3. Set your site URL (e.g., `https://your-app.vercel.app`)

## Step 3: Create Initial Guild and User

Since you're migrating from a single-guild setup, you need to create an initial user and link them to your existing guild.

### 3.1 Sign Up First User

1. Deploy your app (even if incomplete)
2. Go to `/signup` and create an account
3. Confirm your email (check spam folder)

### 3.2 Link User to Existing Guild

Run this SQL in Supabase SQL Editor (replace with your actual values):

```sql
-- Get your user ID and display name from the auth.users table
SELECT id, email, raw_user_meta_data->>'display_name' as display_name FROM auth.users;

-- Get your guild_id from guild_config
SELECT guild_id, guild_name FROM guild_config;

-- Insert guild membership (replace USER_ID and GUILD_ID with actual values)
INSERT INTO guild_members (user_id, guild_id, role)
VALUES (
  'USER_ID_HERE',  -- Your user ID from auth.users
  'GUILD_ID_HERE', -- Your guild_id from guild_config
  'LEADER'         -- Give yourself LEADER role
);
```

Example:
```sql
INSERT INTO guild_members (user_id, guild_id, role)
VALUES (
  'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  'my-guild',
  'LEADER'
);
```

## Step 4: Environment Variables

Ensure your deployment has these environment variables:

```bash
# Supabase (already set up)
NEXT_PUBLIC_SUPABASE_URL=your-supabase-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

**Important**: The service role key is required for server-side operations. Keep it secret!

## Step 5: Test the Multi-Guild Setup

1. **Sign in** at `/login` with your created account
2. **Verify guild selection** - You should see your guild at `/guilds`
3. **Test permissions**:
   - As LEADER, you should see all pages
   - Try creating a new activity log
   - Try saving a challenge

## Step 6: Add More Users

### For Guild Members

1. User signs up at `/signup` with their display name
2. Leader runs this SQL to add them to the guild:

```sql
-- Get the new user's ID and display name
SELECT id, email, raw_user_meta_data->>'display_name' as display_name
FROM auth.users
WHERE email = 'newuser@example.com';

-- Add them to your guild
INSERT INTO guild_members (user_id, guild_id, role)
VALUES (
  'NEW_USER_ID',
  'your-guild-id',
  'MEMBER'  -- or 'OFFICER' or 'LEADER'
);
```

### Role Permissions

- **MEMBER**: Can view leaderboards and reports (read-only)
- **OFFICER**: Can process activity logs and add challenges
- **LEADER**: Full access, including guild config and user management

## Step 7: Supporting Multiple Guilds

### Creating a New Guild

When you want to add another guild to the platform:

1. Create the guild config:

```sql
INSERT INTO guild_config (guild_id, guild_name, api_key, settings)
VALUES (
  'second-guild',
  'Second Guild Name',
  'idlemmo-api-key-here',
  '{"donation_requirement": 5000, "challenge_requirement_percent": 50}'::jsonb
);
```

2. Add the guild leader:

```sql
INSERT INTO guild_members (user_id, guild_id, role)
VALUES (
  'user-id-of-leader',
  'second-guild',
  'LEADER'
);
```

3. The user will now see a guild selector in the navigation when they sign in

## Step 8: Update Frontend Code to Use API Client

To make API requests work with the guild context, update your pages to use the `useApiClient` hook:

### Before (old code):
```typescript
const response = await fetch('/api/config');
```

### After (new code):
```typescript
import { useApiClient } from '@/lib/api-client';

const api = useApiClient();
const response = await api.get('/api/config');
```

The API client automatically adds the `x-guild-id` header based on the currently selected guild.

## Step 9: Protect Routes with ProtectedRoute

Wrap pages that require authentication:

```typescript
import ProtectedRoute from '@/components/ProtectedRoute';

export default function ActivityPage() {
  return (
    <ProtectedRoute requiredRole="OFFICER">
      {/* Your page content */}
    </ProtectedRoute>
  );
}
```

## Troubleshooting

### "Unauthorized - Please sign in"
- Make sure you're signed in at `/login`
- Check that cookies are enabled
- Verify Supabase auth is configured correctly

### "Bad Request - No guild selected"
- Make sure you selected a guild at `/guilds`
- Check that the API client is being used (not plain `fetch`)
- Verify `x-guild-id` header is being sent

### "Forbidden - You do not have access to this guild"
- Verify user is in `guild_members` table for that guild
- Check RLS policies are enabled
- Ensure guild_id matches between request and database

### User sees no guilds after signup
- Add them to a guild using the SQL from Step 6
- Refresh the page

### RLS policies blocking legitimate requests
- Check that service role key is being used in API routes
- Verify `createServerClient()` is used (not `createClient()`)
- Test policies in Supabase SQL Editor

## Migration from Single-Guild

If you have existing data:

1. ✅ Run the migration SQL (Step 1)
2. ✅ Your existing `guild_config` data is preserved
3. ✅ Your existing `members`, `challenges`, and `daily_logs` are preserved
4. ✅ Create a user and link to your guild (Step 3)
5. ⚠️ Update frontend code to use `useApiClient` (Step 8)
6. ⚠️ Wrap protected pages in `ProtectedRoute` (Step 9)

## Security Checklist

- ✅ RLS policies enabled on all tables
- ✅ Service role key kept secret (not in frontend code)
- ✅ Email confirmation enabled for new users
- ✅ HTTPS enabled on your domain
- ✅ API routes verify user permissions
- ✅ Guild isolation enforced at database level

## Next Steps

- Add user management UI for leaders to add/remove members
- Implement guild creation flow for new guilds
- Add audit logging for sensitive operations
- Set up email notifications for important events
- Add 2FA for leader accounts (Supabase supports this)

---

**Need Help?** Check the [MULTI_GUILD_IMPLEMENTATION.md](MULTI_GUILD_IMPLEMENTATION.md) file for technical details about the implementation.
