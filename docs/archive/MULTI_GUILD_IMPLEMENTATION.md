# Multi-Guild Implementation Plan

## Overview
Transform the guild tracker from a single-guild app to a multi-guild platform where multiple guilds can use the same deployment.

## Phase 1: Database Schema Updates

### New Tables Needed

```sql
-- User accounts (managed by Supabase Auth)
-- Users are created via Supabase Auth, we just reference them

-- Guild memberships (links users to guilds with roles)
CREATE TABLE guild_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id TEXT NOT NULL REFERENCES guild_config(guild_id),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  role TEXT NOT NULL CHECK (role IN ('MEMBER', 'OFFICER', 'LEADER')),
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(guild_id, user_id)
);

-- Index for fast lookups
CREATE INDEX idx_guild_members_user ON guild_members(user_id);
CREATE INDEX idx_guild_members_guild ON guild_members(guild_id);
```

### Update Existing Tables

All queries need to be scoped to guild_id. The existing schema already has guild_id in:
- `guild_config` ✅
- `challenges` ✅
- Members are implicitly scoped (they belong to one guild)

### Row Level Security (RLS) Policies

```sql
-- Guild Config: Users can only see their guild's config
CREATE POLICY "Users can view their guild config"
  ON guild_config FOR SELECT
  USING (
    guild_id IN (
      SELECT guild_id FROM guild_members WHERE user_id = auth.uid()
    )
  );

-- Guild Config: Only leaders can update
CREATE POLICY "Leaders can update guild config"
  ON guild_config FOR UPDATE
  USING (
    guild_id IN (
      SELECT guild_id FROM guild_members
      WHERE user_id = auth.uid() AND role = 'LEADER'
    )
  );

-- Similar policies for challenges, daily_logs, etc.
```

## Phase 2: Authentication Setup

### Install Supabase Auth
```bash
# Already have @supabase/supabase-js installed
```

### Create Auth Context
- Wrap app in auth provider
- Track current user
- Track current selected guild

### Login/Signup Pages
- `/login` - Sign in page
- `/signup` - Registration page
- `/guilds` - Guild selection page

## Phase 3: Guild Selection

### Guild Context
- Store current guild_id in React Context
- Persist to localStorage
- Add guild switcher to navbar

### Protected Routes
- Redirect to login if not authenticated
- Redirect to guild selection if no guild selected
- Check permissions for each page

## Phase 4: Update All API Routes

### Add Guild Context to Every Route
```typescript
// Example: Update activity route
const { data: { user } } = await supabase.auth.getUser();
if (!user) return unauthorized();

// Get user's current guild
const guildId = req.headers.get('x-guild-id');

// Verify user has access to this guild
const { data: membership } = await supabase
  .from('guild_members')
  .select('role')
  .eq('user_id', user.id)
  .eq('guild_id', guildId)
  .single();

if (!membership) return forbidden();

// Now proceed with guild-scoped query
```

## Phase 5: UI Updates

### Add to Navigation
- Guild selector dropdown
- User profile menu
- Logout button

### Update Page Permissions
- Activity page: Officers and Leaders only
- Challenges page: Officers and Leaders only
- Reports page: All guild members
- Leaderboard page: All guild members
- Setup page: Leaders only

## Phase 6: Migration Path

### For Existing Single-Guild Users
1. Run migration to add new tables
2. Create a "default" guild from existing guild_config
3. Optionally add auth (or keep public for single guild)

### For New Multi-Guild Platform
1. Deploy with auth enabled
2. Users sign up and create/join guilds
3. Full isolation between guilds

## Implementation Priority

**Phase 1** (Critical): Database schema + RLS
**Phase 2** (Critical): Authentication
**Phase 3** (Critical): Guild selection
**Phase 4** (Critical): API route updates
**Phase 5** (Important): UI updates
**Phase 6** (Nice to have): Migration tools

## Estimated Effort

- Database setup: 2-3 hours
- Auth implementation: 3-4 hours
- API route updates: 4-5 hours
- UI updates: 3-4 hours
- Testing: 2-3 hours

**Total: ~15-20 hours of development**

## Alternative: Simple Password Protection

If you want something simpler for now:
- Add a single password per guild
- Store password in guild_config
- Check password on entry
- No user accounts, just guild access codes
- Much faster to implement (2-3 hours)

Let me know if you want to proceed with full multi-guild or the simpler password approach!
