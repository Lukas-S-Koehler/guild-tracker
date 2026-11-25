// Verifies src/lib/combat/pet-hunting.ts against the community Citadel sheet
// (Lv 100 pet, mastery 100, no evolution). Run: npx tsx scripts/check-pet-hunting.ts
import { petHuntEstimate } from '../src/lib/combat/pet-hunting';

// name, agility, stamina, move speed, hunt length, time per enemy, encounters
const ROWS = `Fluffy 35 99 4.80 1:06:00 0:02:53 23
Shelly 14 99 1.80 1:06:00 0:03:09 21
Whiskers 48 99 4.80 1:06:00 0:02:43 24
Leafy 35 99 4.80 1:06:00 0:02:53 23
Aquastar 35 99 4.80 1:06:00 0:02:53 23
Aquarion 49 139 8.64 1:45:18 0:02:41 39
Furbella 16 139 9.72 1:45:18 0:03:05 34
Shadowscale 56 139 9.00 1:45:18 0:02:36 41
Nutwhisker 36 139 9.00 1:45:18 0:02:50 37
Stardust 29 139 10.08 1:45:18 0:02:55 36
Blooplord 43 139 9.36 1:45:18 0:02:45 38
Draconis 43 139 9.72 1:45:18 0:02:45 38
Wrex 100 179 16.92 2:37:01 0:02:01 78
Fangor 92 179 15.84 2:37:01 0:02:07 74
Raptora 78 179 16.56 2:37:01 0:02:17 69
Lumi 85 179 16.20 2:37:01 0:02:12 71
Zephyrix 92 179 17.28 2:37:01 0:02:06 75
Vexalia 65 179 17.28 2:37:01 0:02:26 64
Vulpina 114 219 21.96 3:48:08 0:01:49 126
Florien 88 219 20.28 3:48:08 0:02:08 107
Emberwhisp 78 219 20.28 3:48:08 0:02:16 101
Pyroflare 79 219 23.76 3:48:08 0:02:13 103
Aerion 79 219 23.76 3:48:08 0:02:13 103
Solarix 101 219 21.96 3:48:08 0:01:58 116
Starmane 86 219 21.96 3:48:08 0:02:09 106
Ravenwing 86 219 23.76 3:48:08 0:02:08 107
Snowrunner 96 219 25.56 3:48:08 0:02:00 114
Lovebuzz 96 219 18.48 3:48:08 0:02:03 111
Thistlehop 109 219 21.96 3:48:08 0:01:52 122
Nyx 98 219 23.76 3:48:08 0:02:00 114
Wingsley 92 219 22.56 3:48:08 0:02:04 110
Nova 90 219 23.76 3:48:08 0:02:05 109
Ollo 26 219 7.20 3:48:08 0:02:58 77
Rattles 65 219 24.36 3:48:08 0:02:23 95
Nutmeg 74 219 24.96 3:48:08 0:02:17 100
Splash 82 219 23.76 3:48:08 0:02:11 104
Lumo 84 219 22.56 3:48:08 0:02:10 105
Leovar 124 268 25.56 5:43:35 0:01:43 200
Drakeling 114 268 25.56 5:43:35 0:01:47 192
Scalethorn 124 268 27.36 5:43:35 0:01:42 202
Sauronix 103 268 25.56 5:43:35 0:01:55 179
Thunderhoof 120 348 29.16 9:40:00 0:01:42 343
Wyrmshadow 133 348 29.16 9:40:00 0:01:42 343
Orthrus 120 348 29.16 9:40:00 0:01:42 343
Lunark 125 348 29.76 9:40:00 0:01:41 343`;

const secs = (t: string) => t.split(':').reduce((s, p) => s * 60 + Number(p), 0);
let bad = 0;
let maxTime = 0;
let maxEnc = 0;
for (const line of ROWS.split('\n')) {
  const [name, agi, sta, ms, len, tpe, enc] = line.split(' ');
  const e = petHuntEstimate(name, 100, 100, 0);
  if (!e) { console.log('MISSING', name); bad++; continue; }
  const errs: string[] = [];
  if (e.agility !== Number(agi)) errs.push(`agi ${e.agility}≠${agi}`);
  if (Math.abs(e.moveSpeed - Number(ms)) > 0.005) errs.push(`ms ${e.moveSpeed}≠${ms}`);
  if (e.maxStamina !== Number(sta)) errs.push(`sta ${e.maxStamina}≠${sta}`);
  if (Math.abs(e.huntSeconds - secs(len)) > 1) errs.push(`len ${e.huntSeconds.toFixed(0)}≠${secs(len)}`);
  const dt = Math.abs(e.secondsPerEnemy - secs(tpe));
  const de = Math.abs(e.citadelEncounters - Number(enc));
  maxTime = Math.max(maxTime, dt);
  maxEnc = Math.max(maxEnc, de);
  if (dt > 1.5) errs.push(`time ${e.secondsPerEnemy.toFixed(1)}≠${secs(tpe)}`);
  if (de > 3) errs.push(`enc ${e.citadelEncounters}≠${enc}`);
  if (errs.length) { bad++; console.log(name, errs.join(', ')); }
}
console.log(`${bad} rows off · max time error ${maxTime.toFixed(2)}s · max encounter error ${maxEnc}`);
process.exit(bad ? 1 : 0);
