# BugHunt — Competitive Debugging Game

> Race to find bugs in code faster than your opponents. Climb the Elo ladder. Become the Grandmaster.

[Live Demo](https://bughunt.vercel.app) · [Demo Video](#) · [Architecture Diagram](#architecture)

## What is BugHunt?

BugHunt is a real-time competitive debugging game. Two players are matched and given the same buggy code snippet. The first to correctly identify the bug wins Elo points. It's chess.com — but for code.

## Features

- **Async Matchmaking** — Find opponents within ±200 Elo. No waiting rooms.
- **50+ Real Bugs** — Hand-crafted bugs in Python, JavaScript, TypeScript, Go, SQL, and Bash
- **Elo Rating System** — Chess-style K-factor ratings (40/32/24/16)
- **7 Rank Tiers** — Bronze → Silver → Gold → Platinum → Diamond → Master → Grandmaster
- **Season Leaderboards** — Compete for top rank in monthly seasons
- **Practice Mode** — Solo play with no Elo change
- **AI Bug Generation** — Amazon Bedrock Nova generates new bugs (admin-reviewed)
- **Achievements** — First Win, Win Streaks, Elo milestones

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                  Users (Global)                      │
└────────────────────┬────────────────────────────────┘
                     │
              ┌──────▼──────┐
              │ Vercel Edge  │  (CDN + Edge Network)
              │    CDN       │
              └──────┬──────┘
                     │
         ┌───────────▼───────────┐
         │   Next.js 15 App      │
         │   (Vercel Serverless) │
         │                       │
         │  ┌─────────────────┐  │
         │  │  App Router     │  │
         │  │  API Routes     │  │
         │  │  Server Actions │  │
         │  └────────┬────────┘  │
         └───────────┼───────────┘
                     │
         ┌───────────▼───────────┐
         │   DynamoDB            │
         │   (Single Table)      │
         │   bughunt-main        │
         │                       │
         │  us-east-1 ◄──────► eu-west-1  (Global Tables)
         └───────────┬───────────┘
                     │
         ┌───────────▼───────────┐
         │  Amazon Bedrock Nova  │
         │  (AI Bug Generation)  │
         └───────────────────────┘
```

## Million-Scale Design

| Concern | Solution |
|---|---|
| Database throughput | DynamoDB on-demand: auto-scales to millions req/sec |
| Hot partitions | UUID PKs + Elo-range queue partitions (7 buckets) |
| Leaderboard at scale | ISR (60s revalidate) — 1M users see cached page |
| Multi-region | DynamoDB Global Tables: us-east-1 + eu-west-1 |
| Stateless compute | Vercel serverless: 0→millions, no servers to manage |
| Global distribution | Vercel Edge CDN: assets served from 100+ PoPs |
| Queue at 1M users | 3s polling × 1M = 333K req/s — DynamoDB handles trivially |

## DynamoDB Single-Table Schema

Table: `bughunt-main` | On-demand capacity | TTL on `expiresAt`

| Entity | PK | SK |
|---|---|---|
| User Profile | USER#\<id\> | PROFILE |
| Game | GAME#\<id\> | META |
| Game Player | GAME#\<id\> | PLAYER#\<userId\> |
| Match Queue | MATCH#QUEUE#\<eloRange\> | \<ts\>#\<userId\> |
| Bug | BUG#\<id\> | META |
| Leaderboard | LEADERBOARD#GLOBAL | RANK#\<paddedElo\>#\<userId\> |
| Match History | USER#\<id\> | GAME#\<ts\>#\<gameId\> |

GSI1: Active game by user · GSI2: User by email

## Tech Stack

- **Frontend + API:** Next.js 15 App Router (Vercel)
- **Database:** Amazon DynamoDB (single-table, on-demand)
- **Auth:** NextAuth.js v5 (Google + GitHub OAuth)
- **UI:** shadcn/ui + Tailwind CSS v4
- **AI:** Amazon Bedrock Nova Lite (bug generation)
- **Analytics:** Vercel Analytics
- **Language:** TypeScript

## Setup

### Prerequisites
- Node.js 18+
- AWS account with DynamoDB access
- Google + GitHub OAuth apps
- (Optional) Amazon Bedrock Nova access

### Environment Variables
Copy `.env.local.example` to `.env.local` and fill in:

```bash
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-key
AWS_SECRET_ACCESS_KEY=your-secret
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=generate-with-openssl-rand-base64-32
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
ADMIN_EMAILS=your@email.com
```

### Install & Run

```bash
npm install
npm run db:create        # Create DynamoDB table
npm run db:seed          # Seed 50 bugs
npm run db:seed-season   # Create Season 1
npm run dev              # Start dev server
```

### Deploy to Vercel

```bash
vercel --prod
```

Set all environment variables in Vercel dashboard.

### Enable Global Tables (optional, for multi-region demo)

```bash
./scripts/enable-global-tables.sh
```

### Load Testing

```bash
npm install -g artillery
npm run load-test
```

## Demo Script (3 minutes)

1. **Hook** (0:00–0:15) — "What if debugging was competitive?"
2. **Login** (0:15–0:35) — Sign in with Google/GitHub
3. **Matchmaking** (0:35–1:05) — Click "Find Match", watch for opponent
4. **Gameplay** (1:05–1:50) — Read code, pick the bug, timer counts down
5. **Result + Elo** (1:50–2:10) — Win/loss banner, Elo change, bug explanation
6. **Leaderboard** (2:10–2:30) — Season 1 rankings
7. **Architecture** (2:30–3:00) — DynamoDB console, Global Tables, Vercel dashboard

## Hackathon Info

- **Event:** H0 Hackathon — Vercel + AWS Databases
- **Track:** Track 3: Million-scale global app
- **Team:** Mohamed Sorour (@mohamedsorour1998)

## License

MIT
