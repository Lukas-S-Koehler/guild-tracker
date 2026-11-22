# Fix: Infinite Loading Screen Issue

## Problem
The app gets stuck on a loading screen after signing in, on all browsers.

## Root Cause
The `get_user_guilds()` database function doesn't exist in your Supabase database yet. The app tries to call this function but it hangs or fails, causing infinite loading.

## Solution

### Step 1: Run the Database Migration ⚡ CRITICAL

1. **Open your Supabase project**
   - Go to https://supabase.com/dashboard
   - Select your guild-tracker project

2. **Open SQL Editor**
   - Click "SQL Editor" in the left sidebar
   - Click "+ New Query"

3. **Run the migration**
   - Open the file `/database/multi-guild-phase1.sql` from your project
   - Copy the ENTIRE file contents (all 238 lines)
   - Paste into the Supabase SQL Editor
   - Click "Run" (or press Ctrl+Enter / Cmd+Enter)
   - You should see: **"Success. No rows returned"** - this is correct!

### Step 2: Clear Your Browser Data 🧹

The old broken version is cached. You must clear it:

**Chrome / Edge / Brave:**
```
1. Press Ctrl+Shift+Delete (Windows/Linux) or Cmd+Shift+Delete (Mac)
2. Select "All time" for time range
3. Check these boxes:
   ✅ Cookies and other site data
   ✅ Cached images and files
4. Click "Clear data"
```

**Safari:**
```
1. Press Cmd+Option+E to empty caches
2. OR: Safari menu > Settings > Privacy > Manage Website Data
3. Search for your site URL (guild-tracker-9ys7.vercel.app)
4. Click "Remove" or "Remove All"
```

**Firefox:**
```
1. Press Ctrl+Shift+Delete (Windows/Linux) or Cmd+Shift+Delete (Mac)
2. Select "Everything" for time range
3. Check these boxes:
   ✅ Cookies
   ✅ Cache
4. Click "Clear Now"
```

### Step 3: Test It Works ✅

1. Close ALL browser windows/tabs with your site
2. Open a NEW browser window
3. Go to your site: https://guild-tracker-9ys7.vercel.app
4. Sign in with: `motivationluki@gmail.com`

**Expected result:**
- ✅ Login page loads (no loading spinner)
- ✅ After login, you see the dashboard (no infinite loading)
- ✅ Top right shows "LEADER" badge
- ✅ You can click "Settings" button
- ✅ Settings page loads and you can save configuration

**If it still doesn't work:**
1. Open browser console (F12 or Ctrl+Shift+I)
2. Look for errors in the console
3. Share the errors with me

---

## Technical Details

### What Changed

**1. Added timeout to database calls**
- File: [src/contexts/AuthContext.tsx](src/contexts/AuthContext.tsx)
- Added 10-second timeout to `get_user_guilds()` RPC calls
- If the function doesn't exist or hangs, it now fails gracefully after 10 seconds
- Shows helpful error message in console pointing to the migration file

**2. Improved error handling**
- Now sets `loading = false` even if errors occur
- Sets `guilds = []` on error, showing "No Guilds Found" message instead of infinite spinner
- Added mounted check to prevent state updates after component unmounts

**3. Fixed setup page authentication**
- File: [src/app/setup/page.tsx](src/app/setup/page.tsx)
- Now waits for `currentGuild` to be loaded before making API calls
- Uses `useApiClient()` which automatically includes the `x-guild-id` header
- Wrapped in `ProtectedRoute` requiring LEADER role

### Database Migration Details

The migration creates:
- `guild_members` table: Links users to guilds with roles (MEMBER, OFFICER, LEADER)
- Row Level Security (RLS) policies: Ensures users can only see data for their guilds
- `get_user_guilds()` function: Returns all guilds the current user belongs to
- `user_has_guild_role()` helper: Checks if user has required role in a guild

### Files Modified

1. `/src/contexts/AuthContext.tsx` - Added timeout and better error handling
2. `/src/app/setup/page.tsx` - Fixed to wait for guild context and use API client
3. `/src/app/page.tsx` - Uses API client, wrapped in ProtectedRoute
4. `/src/components/ProtectedRoute.tsx` - Shows helpful message when no guilds
5. `/src/app/signup/page.tsx` - Added display name field

---

## Quick Checklist

- [ ] Step 1: Run `/database/multi-guild-phase1.sql` in Supabase SQL Editor
- [ ] Step 2: Clear browser cache and cookies (Ctrl+Shift+Delete)
- [ ] Step 3: Close all browser windows
- [ ] Step 4: Open fresh browser window and test login
- [ ] Verify: No infinite loading
- [ ] Verify: Can access Settings as LEADER
- [ ] Verify: Can save configuration

---

## Still Having Issues?

If you're still seeing infinite loading after completing all steps:

1. **Check browser console** (F12 → Console tab)
   - Look for red errors
   - Share any errors that mention "guilds" or "RPC"

2. **Verify the migration ran**
   - Go to Supabase SQL Editor
   - Run: `SELECT * FROM guild_members WHERE user_id = 'cc2a80d5-8e11-40b4-8e84-be4a6bc1c397';`
   - Should return your guild membership with role='LEADER'

3. **Test the function directly**
   - In Supabase SQL Editor, run:
   ```sql
   SELECT * FROM get_user_guilds();
   ```
   - If this errors, the function wasn't created properly

4. **Try incognito/private browsing**
   - Opens clean browser with no cache
   - Tests if the issue is caching-related
