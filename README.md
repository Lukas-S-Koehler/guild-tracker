# Guild Tracker

Track IdleMMO guild activity by pasting activity logs and challenge data. Automatically fetches market prices and calculates gold values.

## Features

- **Activity Log Parser**: Paste Discord-style activity logs to track raids and donations
- **Challenge Calculator**: Paste challenge items to calculate total cost and find expensive items (>15k)
- **Leaderboard**: Rankings by activity score (raids × 1000 + gold)
- **Inactivity Reports**: Track members who haven't met requirements
- **Market Price Cache**: Auto-fetches and caches item prices from IdleMMO API

## Setup

### 1. Database (Supabase)

1. Create a project at [supabase.com](https://supabase.com)
2. Go to SQL Editor and run `database/schema.sql`
3. Copy your project URL and anon key from Settings → API

### 2. Environment

Create `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

### 3. Install & Run

```bash
npm install
npm run dev
```

### 4. Configure API Key

1. Go to Setup page
2. Enter your IdleMMO API key (for market price lookups)
3. Save

## Usage

### Processing Activity Logs

1. Copy the activity log from Discord (format below)
2. Go to "Activity Log" page
3. Set the date
4. Paste and click "Process"
5. Review results and click "Save"

**Expected format:**
```
* Username
Participated in a raid.
1d
* AnotherUser
Contributed 100 Iron Ore
2h
* ThirdUser
Contributed 50 Steel Bar
1h
```

### Calculating Challenges

1. Copy challenge data (format below)
2. Go to "Challenges" page
3. Paste and click "Calculate"
4. Items >15k gold are flagged

**Expected format:**
```
35
Siren's Soulstone21h
1,340
Maple Log21h
2,400
Copper Ore21h
```

## Activity Requirement

Members are "active" if they donate 5,000+ gold (configurable in Setup).

## Deployment (Vercel)

1. Push to GitHub
2. Import to Vercel
3. Add environment variables
4. Deploy

## Tech Stack

- Next.js 14
- Supabase (PostgreSQL)
- Tailwind CSS
- IdleMMO API for market prices
