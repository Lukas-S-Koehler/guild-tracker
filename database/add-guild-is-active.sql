-- Add is_active flag to guilds table
ALTER TABLE guilds ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
