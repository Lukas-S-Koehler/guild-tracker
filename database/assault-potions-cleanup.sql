-- Cleanup: drop untradable duplicates, set correct durations
DELETE FROM combat_potions WHERE id IN (2, 4, 6);

-- Combat potions
UPDATE combat_potions SET duration_minutes = 30  WHERE id = 1;   -- Attack Power
UPDATE combat_potions SET duration_minutes = 30  WHERE id = 3;   -- Protection
UPDATE combat_potions SET duration_minutes = 40  WHERE id = 5;   -- Bladeburst
UPDATE combat_potions SET duration_minutes = 40  WHERE id = 7;   -- Bulwark
UPDATE combat_potions SET duration_minutes = 60  WHERE id = 8;   -- Cosmic Tear   (guess)
UPDATE combat_potions SET duration_minutes = 60  WHERE id = 9;   -- Frenzy        (guess)
UPDATE combat_potions SET duration_minutes = 60  WHERE id = 10;  -- Shieldbearer  (guess)
UPDATE combat_potions SET duration_minutes = 60  WHERE id = 11;  -- Thunderfury   (guess)
UPDATE combat_potions SET duration_minutes = 120 WHERE id = 12;  -- Dragon        (guess)
UPDATE combat_potions SET duration_minutes = 120 WHERE id = 13;  -- Guardian      (guess)
UPDATE combat_potions SET duration_minutes = 120 WHERE id = 14;  -- Phoenix       (guess)

-- XP potions (user-confirmed)
UPDATE xp_potions SET duration_minutes = 120 WHERE id = 101; -- Sun's Light     (guess, mythic)
UPDATE xp_potions SET duration_minutes = 100 WHERE id = 103; -- Wraithbane 1h40
UPDATE xp_potions SET duration_minutes = 50  WHERE id = 104; -- Dungeon Master 50m
UPDATE xp_potions SET duration_minutes = 30  WHERE id = 105; -- Dungeon Potion 30m

UPDATE xp_potions SET duration_minutes = 60  WHERE id = 200; -- POTG 1h
UPDATE xp_potions SET duration_minutes = 90  WHERE id = 201; -- Dragonblood 1h30
UPDATE xp_potions SET duration_minutes = 45  WHERE id = 202; -- Vortex 45m
UPDATE xp_potions SET duration_minutes = 30  WHERE id = 203; -- Battle Potion 30m
UPDATE xp_potions SET duration_minutes = 60  WHERE id = 204; -- Strike 1h

-- Free preset uses tradeable ids only
UPDATE assault_potion_presets SET combat_potion_ids = ARRAY[5, 7]::INT[] WHERE id = 'free';
