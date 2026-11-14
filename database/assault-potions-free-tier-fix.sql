-- Free/F2P tier: don't force POTG (not everyone has one). Keep subtle reminder in description.
UPDATE assault_potion_presets
SET xp_potion_ids = ARRAY[204, 105]::INT[],
    description = 'Zero gold path. Dungeon Potion + tradeable combat freebies. Swap in POTG when you have one.',
    updated_at = NOW()
WHERE id = 'free';
