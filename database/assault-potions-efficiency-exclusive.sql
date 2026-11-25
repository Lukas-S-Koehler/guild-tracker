-- Hunting-efficiency XP potions don't stack (Wraithbane, Strike Essence, Dungeon Potion,
-- Dungeon Master's Tonic). App now blocks combining them; fix presets that did.

-- Free: keep Strike Essence (free drop, +20% eff), drop Dungeon Potion (also efficiency).
UPDATE assault_potion_presets
SET xp_potion_ids = ARRAY[204]::INT[],
    description = 'Zero gold path. Strike Essence + tradeable combat freebies. Swap in POTG when you have one.',
    updated_at = NOW()
WHERE id = 'free';

-- Budget: Wraithbane for efficiency, Vortex Brew for Battle XP (Strike would clash).
UPDATE assault_potion_presets
SET xp_potion_ids = ARRAY[202, 103]::INT[],
    description = 'Mid-market stack. Skip Battle XP mythic; use Vortex Brew + Wraithbane.',
    updated_at = NOW()
WHERE id = 'budget';

-- Saved user loadouts that combine two efficiency potions: list for review (not auto-edited).
SELECT l.id, l.name, l.user_id, l.xp_potion_ids
FROM assault_potion_loadouts l
WHERE (SELECT COUNT(*) FROM xp_potions x WHERE x.id = ANY(l.xp_potion_ids) AND x.efficiency_value > 0) > 1;
