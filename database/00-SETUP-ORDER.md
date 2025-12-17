# Database Setup Order

Run these SQL files in your Supabase SQL Editor in this exact order:

## ✅ Current Status
Based on your data:
- ✅ `guilds` table exists with 11 guilds
- ✅ `guild_members` table exists
- ⚠️ `guild_config` has only 1 entry (need 11 entries, one per guild)
- ❓ Need to verify `member_keys`, `market_cache`, `challenges` tables exist

## 🔧 Setup Steps

### 1️⃣ **Create Guild Config Entries for All Guilds**
📄 **`02-create-guild-configs-from-existing.sql`**
- Creates `guild_config` entries for all guilds that don't have one
- Uses your ACTUAL guild IDs from the database
- Safe to run multiple times (won't create duplicates)

**Run this first!** This fixes the foreign key issue.

### 2️⃣ **Add Yourself as a Guild Member**
📄 **`03-add-yourself-as-member.sql`**
- Follow the steps in the script to:
  1. Find your user ID by email
  2. Find the guild ID you want to join
  3. Insert yourself as a member
  4. Verify your membership

### 3️⃣ **Create Database Functions**
📄 **`add-get-guild-members-function.sql`**
- Creates `get_all_guild_members()` RPC function
- Fixes admin page PGRST200 error
- Allows joining across schemas

📄 **`add-find-user-function.sql`**
- Creates `find_user_by_email()` RPC function
- Used for adding members by email in Admin page

### 4️⃣ **COMPREHENSIVE FIX - RUN THIS NOW** ⚠️ **CRITICAL - FIXES EVERYTHING**
📄 **`06-comprehensive-fix-loading-issues.sql`**
- Fixes ALL RLS policies on `guild_members` AND `guilds` tables
- Adds critical indexes for fast loading
- Creates missing `guild_config` entries
- Fixes permissions and grants
- **THIS IS THE MOST IMPORTANT SCRIPT - RUN IT NOW**
- ✅ Fixes "no guilds found" issue
- ✅ Fixes slow loading screens
- ✅ Includes diagnostics to verify everything works

**Alternative (if you already ran the old scripts):**
📄 **`05-fix-guild-members-rls.sql`** - Older partial fix (use 06 instead)

### 5️⃣ **Fix get_user_guilds Function** (Optional - for backup)
📄 **`04-fix-get-user-guilds-function.sql`**
- Creates backup RPC function for guild fetching
- Not currently used but good to have

### 6️⃣ **Create Member Keys Table**
📄 **`add-member-keys-table.sql`**
- Creates `member_keys` table for individual API keys
- Sets up RLS policies
- Enables per-member API key system

## 🎯 Quick Reference: Your Guild IDs

Based on your data, your guilds use these IDs:
- Dream Angels (DA, Level 1106): `'1106'`
- Dream Bandits: `'554'` (already has config)
- Other guilds: Check with `SELECT id, name, nickname FROM guilds`

**Important:** Use these ACTUAL IDs when adding guild members, not the min_level values!

## ✅ After Setup

1. **Sign in to the app**
2. **Go to Settings** (new navigation item)
3. **Add your personal IdleMMO API key**
4. **Test processing an activity log or challenge**

## ✅ Verify Your Setup

After running the scripts, verify everything is working:

📄 **Run `07-verify-setup.sql`** in the Supabase SQL Editor

This will check:
- ✅ All tables exist
- ✅ All guilds have config entries
- ✅ RLS policies are correct
- ✅ Indexes are created
- ✅ Foreign keys are set up

The script will tell you exactly what's wrong (if anything) and what to fix!

## 🚨 Troubleshooting

### 🔥 **"No guilds found" for all accounts** (MOST COMMON)
**Root Cause:** Infinite recursion in RLS policy (ERROR: 42P17) - the policy queries `guild_members` while checking permissions on `guild_members`

**Solution:** Run `06-comprehensive-fix-loading-issues.sql` immediately! This fixes ALL RLS policies and indexes.

**If already ran 06 but still broken:** Run `12-fix-recursive-rls-policy.sql` to fix just the RLS recursion issue.

### ⚠️ **ERROR: 42P17: infinite recursion detected in policy**
**Solution:** Run `12-fix-recursive-rls-policy.sql` to replace recursive policies with simple non-recursive ones.

### Error: "violates foreign key constraint guild_members_guild_id_fkey"
**Solution:** Run `02-create-guild-configs-from-existing.sql` first to create all guild_config entries.

### Error: "PGRST200" on Admin page
**Solution:** Run `add-get-guild-members-function.sql`.

### Error: "API key not configured" when processing logs
**Solution:** Go to Settings page and add your personal IdleMMO API key.

### Can't add users by email in Admin page
**Solution:** Run `add-find-user-function.sql`.

## 🚀 Quick Start (MOST USERS - START HERE!)

If you're experiencing loading issues or "no guilds found":

1. **`06-comprehensive-fix-loading-issues.sql`** - Run this FIRST! Fixes RLS, indexes, foreign keys, everything
   - ⚠️ Fixes infinite recursion in RLS policies (ERROR: 42P17)
   - ✅ Creates non-recursive policies
   - ✅ Adds performance indexes
   - ✅ Fixes foreign key constraints
2. **`03-add-yourself-as-member.sql`** - Add yourself to a guild (if not already added)
3. **`07-verify-setup.sql`** - Verify everything is working
4. Sign in to the app and enjoy!

## ⚠️ If You Still Can't Connect After Running 06

If you ran the fix but still can't connect with an account that worked before:

1. **`08-fix-foreign-key-constraint.sql`** - Fixes incorrect FK constraint on guild_members
2. Refresh browser and try again

The issue is that `guild_members.guild_id` may be pointing to `guild_config.guild_id` instead of `guilds.id`

## 📊 Manual Verification Commands

If you prefer to check manually instead of using `07-verify-setup.sql`:

```sql
-- Check all guilds have config entries
SELECT
  g.id, g.name,
  CASE WHEN gc.guild_id IS NOT NULL THEN '✓' ELSE '✗' END as has_config
FROM guilds g
LEFT JOIN guild_config gc ON gc.guild_id = g.id;

-- Check your memberships
SELECT gm.guild_id, g.nickname, gm.role
FROM guild_members gm
JOIN guilds g ON g.id = gm.guild_id
WHERE gm.user_id = 'your-user-uuid';

-- Check RLS policies on guild_members (should be 3)
SELECT COUNT(*), STRING_AGG(policyname, ', ')
FROM pg_policies
WHERE tablename = 'guild_members';

-- Check RLS policies on guilds (should be 1)
SELECT COUNT(*), STRING_AGG(policyname, ', ')
FROM pg_policies
WHERE tablename = 'guilds';

-- Check indexes on guild_members (should be at least 5)
SELECT COUNT(*), STRING_AGG(indexname, ', ')
FROM pg_indexes
WHERE tablename = 'guild_members';
```
