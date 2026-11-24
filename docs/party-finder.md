# Party finder (Dream Hub step 16, F4)

Status: **built** 2026-11-24 (run `database/party-finder.sql`, `?action=register-hub`, then `/league board` + `/league import`).

## Rules from the user

- Discord-only must be fully functional. No website account or claim is needed for anything. The site is an optional extra view.
- The overview lives in **#league-party-find** (forum `1444751519588024492`) as a pinned **📋 Party board** thread, edited in place by DreamBot.
- Leagues come in through a **staff paste** of the in-game league list. DreamBot parses it.
- A party is **persistent**: one in-game party with its own forum thread, reused across many leagues. Example: `1471554145344553204`, a smelt party with 400+ messages over several leagues.
- In scope: league parties, **party Slayer**, **solo players looking for a party**, and staff-**verified Dream parties**.

## In-game facts the design relies on

- Max 4 per party. Leader and officers invite and join leagues, and only the leader leaves a league or closes the party.
- While a party is registered for an upcoming or active league, **no one can join**. Open slots only matter **before** the party registers.
- Leagues have a skill (17 types, incl. Village / Pet / Hunting / seasonal masteries and Battle), a contribution type (EXP / kills), a max party size, dates, a status and sometimes a restriction (cursed / restricted / forsaken / banished).
- Party Slayer locks the party for 24 h per contract, and trade-locked classes can't take part.
- Alts can be in different parties, so a person may be in several parties (one per character).

## Data (one migration `database/party-finder.sql`)

| Table | Fields |
|---|---|
| `leagues` | skill, contribution (`exp`/`kills`), max_size, starts_on, ends_on, restriction (nullable), entrants (count shown in game), imported_at. Unique on skill + contribution + dates + restriction, so re-pasting updates instead of duplicating |
| `parties` | name, forum thread_id, leader discord_id, verified (staff), slayer (bool: open for party slayer), note, created_at, closed_at |
| `party_members` | party_id, discord_id, ign (optional, filled from member mapping when known), rank leader/officer/member. Max 4 |
| `party_leagues` | party_id, league_id, state `planned` / `registered` |
| `party_seekers` | discord_id, ign, skills[], league_ids[], slayer, note, expires_at (14 days, renewed by a button) |

Identity is the **Discord user**. IGN is optional. If the member mapping knows the person, the board shows their IGN and guild tag.

## Discord

**`/party`** (anyone):
- `create name: [thread]`: links an existing forum thread (run it inside the thread) or creates a new one. The creator becomes leader.
- `invite user:` / `kick user:` / `leave` / `rank user: officer|member` (leader and officers, matching the in-game permissions).
- `league add league:` (autocomplete from active and upcoming leagues) / `league remove` / `league registered` (marks the party as joined in game, so it stops showing open slots for that league).
- `slayer on|off`, `note text:`, `close`.
- `info`: the party card.

**Party card**: DreamBot posts and pins one card at the top of each party thread and keeps it edited. It shows members, leagues, open slots and slayer flag. A **🙋 Ask to join** button pings the leader and officers in the thread.

**`/lfg`** (solo players): `set skills: leagues: slayer: note:` / `clear`. The board lists them, and a 📩 button lets a party leader ping them.

**`/league list`**: active and upcoming leagues with the Dream parties in each. **`/league import`** (staff): opens a modal, you paste the in-game list, DreamBot parses it and shows a preview, then you confirm.

## 📋 Party board (live key `party-board`, edit in place, pinned thread)

1. **Upcoming leagues**: start date, length, max size, restriction. Under each: Dream parties planning it, with open slots and thread link.
2. **Active leagues**: Dream parties in it (no slots, because the party is locked).
3. **Slayer parties**: parties with slayer on and a free slot.
4. **Looking for a party**: solo players by skill.

The board refreshes whenever a command changes something and once a day from `/api/cron/discord-live`. Leagues that ended drop off, and seekers expire after 14 days.

## Staff (Admin → Discord → Party finder, optional)

League import (same parser as the modal), verify/unverify parties, close dead parties. Everything here also works via commands.

## Website (optional extra, later in the step)

Read-only `/parties` page mirroring the board, for members.

## Not in v1

- No automatic league results or standings (no API).
- No Dream Pass XP or achievements for leagues yet (could add later, e.g. top-25 finish reported by the leader).

## Decisions (user, 2026-11-24)

- Restricted leagues (cursed / restricted / forsaken / banished) only accept those characters.
- The copied list has no restriction text (in game it's only an icon). The importer reads it when a restriction word does appear. Otherwise staff set it with `/league restrict`. The import reply marks leagues with far fewer parties than the rest (below 40% of the median) as "restricted?".
- Supreme staff (role `1445371753181220904`) can attach any thread to a party (`/party create leader:` inside the thread), import leagues, set restrictions, verify parties and create the board. A thread's creator can attach their own thread.

## As built

- `src/lib/party.ts`: data, paste parser (year guessed from today, end date rolls into next year), import (re-pasting updates the existing rows, and a cursed and a normal league with the same dates are told apart by entrant count), party card, board builder.
- `src/lib/party-discord.ts`: `/party`, `/lfg`, `/league`, the 🙋 button, the /lfg skill picker (multi-select incl. Party Slayer) and the import modal. Registered with `register-hub`.
- The party card is the starter message for parties DreamBot opens. For an adopted thread it is a new message, pinned. DreamBot unarchives the thread before editing.
- `/league board` creates the forum post, locks it, pins it to the top of the forum and binds live key `party-board`. Every change refreshes the board, and so does the daily `discord-live` cron, which drops ended leagues and expired seekers.
- `/party invite` only updates the Discord roster. The in-game invite still has to be sent in the game. Adding someone also removes their /lfg listing.
- The website `/parties` page has not been built (optional).

## 16b: members are characters (user, 2026-11-24)

- A party member is a **character** (IGN), not a Discord user. One person can put several alts in the same party (each is its own row), and **a character can be in only one open party at a time**. A closed party frees its characters.
- Migration `database/party-characters.sql`: `party_members` gets `id` (new PK), `ign`, `member_id`, and `discord_id` becomes nullable. Existing rows are backfilled when the Discord user has exactly one active character. Otherwise the card shows "character not set" until `/party invite ign:` fills that row.
- `/party create ign:` (leader character, defaults to your only character), `/party invite ign: [user:]` (Dream characters autocomplete with your own first, other names allowed with `user:` for who plays them), `/party kick ign:`, `/party rank ign:`, `/party leave [ign:]` (no ign = all your characters except a leader).
- The card lists one line per character: `👑 **Ign** (@user)`.
- Players from outside the Dream guilds or the server (user, 2026-11-24): `/party invite ign:` takes any name. Characters we don't know get a 🌐 on the card and board, and `user:` is optional for outside players who are on this server (pings, `/party leave`). They count for the one-party-per-character rule like everyone else.
