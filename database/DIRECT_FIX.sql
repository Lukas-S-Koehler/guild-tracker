-- DIRECT FIX: Insert/Update guild membership with hardcoded IDs
-- This bypasses auth.uid() issues

-- Step 1: Ensure guild_config exists
INSERT INTO guild_config (guild_id, guild_name, api_key, donation_requirement)
VALUES ('554', 'Your Guild Name', '', 5000)
ON CONFLICT (guild_id) DO UPDATE
SET guild_name = EXCLUDED.guild_name;

-- Step 2: Delete any existing membership for this guild (clean slate)
DELETE FROM guild_members WHERE guild_id = '554';

-- Step 3: Insert your membership with the CORRECT user_id
INSERT INTO guild_members (guild_id, user_id, role)
VALUES ('554', 'cc2a80d5-8e11-40b4-8e84-be4a6bc1c397', 'LEADER');

-- Step 4: Verify the insert worked
SELECT 'Verification:' as step;
SELECT * FROM guild_members WHERE guild_id = '554';

-- Step 5: Test the function with a manual query (bypassing auth.uid())
SELECT 'Manual Test:' as step;
SELECT
  gm.guild_id,
  gc.guild_name,
  gm.role,
  gm.joined_at
FROM guild_members gm
JOIN guild_config gc ON gc.guild_id = gm.guild_id
WHERE gm.user_id = 'cc2a80d5-8e11-40b4-8e84-be4a6bc1c397';

-- This should return 1 row with guild_id='554', role='LEADER'
