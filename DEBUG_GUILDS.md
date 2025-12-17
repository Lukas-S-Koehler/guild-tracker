# Debug: No Guilds Found Issue

## Current Situation
- ✅ Sign in works
- ✅ Shows "LEADER" badge in top right
- ❌ Shows "No Guilds Found" screen
- ✅ Database has guild membership: `guild_id="554"`, `user_id="cc2a80d5-8e11-40b4-8e84-be4a6bc1c397"`, `role="LEADER"`

## Root Cause
The `get_user_guilds()` function is either missing or failing to return results.

---

## Step-by-Step Fix

### Step 1: Check if the Function Exists

Run this in Supabase SQL Editor:

```sql
-- Check if get_user_guilds function exists
SELECT routine_name, routine_type
FROM information_schema.routines
WHERE routine_name = 'get_user_guilds';
```

**Expected Result:**
- Should return 1 row with `routine_name = 'get_user_guilds'`

**If it returns 0 rows:**
- ⚠️ The function doesn't exist yet
- You MUST run the migration: `/database/multi-guild-phase1.sql`

---

### Step 2: Check if guild_config Exists for Guild 554

```sql
-- Check if guild_config has your guild
SELECT * FROM guild_config WHERE guild_id = '554';
```

**Expected Result:**
- Should return 1 row with your guild name

**If it returns 0 rows:**
- ⚠️ Your guild_config is missing!
- Run this to create it:

```sql
INSERT INTO guild_config (guild_id, guild_name, api_key, donation_requirement)
VALUES ('554', 'Your Guild Name Here', '', 5000);
```

---

### Step 3: Test the Function Manually

Sign in to your app first, then run this in Supabase SQL Editor:

```sql
-- Test get_user_guilds while you're signed in
SELECT * FROM get_user_guilds();
```

**Expected Result:**
- Should return your guild with `guild_id='554'`, `guild_name='...'`, `role='LEADER'`

**If it returns 0 rows:**
- There's a mismatch between your auth user ID and guild_members user_id
- Go to Step 4

**If it gives an error like "function does not exist":**
- You haven't run the migration yet
- Run `/database/multi-guild-phase1.sql` in Supabase SQL Editor

---

### Step 4: Verify User ID Match

```sql
-- Get your current authenticated user ID
SELECT auth.uid() as current_user_id;

-- Get your guild membership
SELECT * FROM guild_members
WHERE user_id = 'cc2a80d5-8e11-40b4-8e84-be4a6bc1c397';

-- Check if they match
SELECT
  auth.uid() as "Current User (from auth.uid())",
  'cc2a80d5-8e11-40b4-8e84-be4a6bc1c397' as "Guild Member User ID",
  CASE
    WHEN auth.uid() = 'cc2a80d5-8e11-40b4-8e84-be4a6bc1c397' THEN '✅ MATCH'
    ELSE '❌ MISMATCH - This is the problem!'
  END as status;
```

**If they don't match:**
- Your guild_members row has the wrong user_id
- Update it with the correct one:

```sql
-- First, get the correct user_id
SELECT id, email FROM auth.users WHERE email = 'motivationluki@gmail.com';

-- Then update guild_members with the correct user_id
UPDATE guild_members
SET user_id = (SELECT id FROM auth.users WHERE email = 'motivationluki@gmail.com')
WHERE guild_id = '554';
```

---

### Step 5: Check RLS Policies

If the function exists and returns data when tested manually, but the app still shows "No Guilds Found", the issue might be RLS policies:

```sql
-- Check if guild_members has RLS enabled
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public' AND tablename = 'guild_members';

-- Check RLS policies on guild_members
SELECT * FROM pg_policies WHERE tablename = 'guild_members';
```

**If RLS is enabled but policies are missing:**
- Run the migration: `/database/multi-guild-phase1.sql`

---

## Quick Fix: Run Everything

If you're unsure about the state of your database, just run this entire script:

```sql
-- 1. Ensure guild_config exists
INSERT INTO guild_config (guild_id, guild_name, api_key, donation_requirement)
VALUES ('554', 'Your Guild Name', '', 5000)
ON CONFLICT (guild_id) DO NOTHING;

-- 2. Create the get_user_guilds function
CREATE OR REPLACE FUNCTION get_user_guilds()
RETURNS TABLE (
  guild_id TEXT,
  guild_name TEXT,
  role TEXT,
  joined_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    gm.guild_id,
    gc.guild_name,
    gm.role,
    gm.joined_at
  FROM guild_members gm
  JOIN guild_config gc ON gc.guild_id = gm.guild_id
  WHERE gm.user_id = auth.uid()
  ORDER BY gm.joined_at ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Verify it works
SELECT * FROM get_user_guilds();
```

**Expected output:** Your guild with guild_id='554'

---

## After Running SQL

1. **Clear your browser cache** (Ctrl+Shift+Delete or Cmd+Shift+Delete)
2. **Sign out** of the app
3. **Sign in** again
4. You should now see the dashboard instead of "No Guilds Found"

---

## Still Not Working?

Open browser console (F12) and look for errors. Share any errors that mention:
- "guilds"
- "RPC"
- "get_user_guilds"
- "Timeout"

Also run this in Supabase SQL Editor and share the results:

```sql
-- Debug info
SELECT 'Step 1: Function exists?' as step;
SELECT EXISTS (
  SELECT 1 FROM information_schema.routines
  WHERE routine_name = 'get_user_guilds'
) as function_exists;

SELECT 'Step 2: Guild config exists?' as step;
SELECT * FROM guild_config WHERE guild_id = '554';

SELECT 'Step 3: Guild membership exists?' as step;
SELECT * FROM guild_members WHERE guild_id = '554';

SELECT 'Step 4: Current user ID' as step;
SELECT auth.uid() as current_user_id;

SELECT 'Step 5: Test function' as step;
SELECT * FROM get_user_guilds();
```
