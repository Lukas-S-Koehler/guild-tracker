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

### 4️⃣ **Fix get_user_guilds Function**
📄 **`04-fix-get-user-guilds-function.sql`**
- Fixes the `get_user_guilds()` RPC function
- Resolves timeout errors when loading guilds
- Improves reliability by joining with guilds table

### 5️⃣ **Create Member Keys Table**
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

## 🚨 Troubleshooting

### Error: "violates foreign key constraint guild_members_guild_id_fkey"
**Solution:** Run `02-create-guild-configs-from-existing.sql` first to create all guild_config entries.

### Error: "PGRST200" on Admin page
**Solution:** Run `add-get-guild-members-function.sql`.

### Error: "API key not configured" when processing logs
**Solution:** Go to Settings page and add your personal IdleMMO API key.

### Can't add users by email in Admin page
**Solution:** Run `add-find-user-function.sql`.

## 📊 Verification Commands

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

-- Check functions exist
SELECT routine_name FROM information_schema.routines
WHERE routine_schema = 'public'
AND routine_name IN ('get_all_guild_members', 'find_user_by_email');

-- Check member_keys table exists
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'member_keys';
```
