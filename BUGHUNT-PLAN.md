# BugHunt — Competitive Debugging Game

## Context

Mohamed lost the AIdeas 2025 competition and tore down all RosettaCloud infrastructure. He's entering the **H0 Hackathon** (Vercel + AWS Databases, $80K prizes, deadline June 30). Track 3: Million-scale global app (gaming/social/entertainment). The stack is simple: **Next.js on Vercel + DynamoDB**. No K8s, no EKS, no pods.

**BugHunt**: Players compete to find bugs in code snippets. Async turn-based matchmaking (like chess.com). Elo rating system, leaderboards, seasons, streaks. Hand-crafted bug bank + AI-generated bugs via Bedrock Nova.

---

## Architecture

```
Browser → Vercel Edge CDN → Next.js (App Router + API Routes) → DynamoDB (single table, on-demand)
                                    ↓
                              NextAuth.js (Google/GitHub OAuth → DynamoDB adapter)
                                    ↓
                              Amazon Bedrock Nova (AI bug generation, optional)
```

No separate backend server. API routes are serverless functions on Vercel.

---

## DynamoDB Single-Table Design

**Table**: `bughunt-main` | PK (String), SK (String) | On-demand capacity

| Entity | PK | SK | Key Fields |
|--------|----|----|------------|
| User | `USER#<id>` | `PROFILE` | email, displayName, elo (default 1200), rank, gamesPlayed, gamesWon, currentStreak, bestStreak, bugsSeen[] |
| Game | `GAME#<id>` | `META` | player1Id, player2Id, bugId, status (waiting/active/completed), winnerId, createdAt, expiresAt |
| Game Player | `GAME#<id>` | `PLAYER#<userId>` | answer, correct, submittedAt, timeElapsedMs |
| Match Queue | `MATCH#QUEUE#<eloRange>` | `<timestamp>#<userId>` | userId, elo, ttl (5min auto-expire) |
| Bug | `BUG#<id>` | `META` | language, category, difficulty (1-5), buggyCode, correctCode, bugLine, options[], correctAnswer, explanation, hint, timesServed, source |
| Leaderboard | `LEADERBOARD#GLOBAL` | `RANK#<zeroPaddedElo>#<userId>` | displayName, elo, gamesPlayed, gamesWon |
| Match History | `USER#<id>` | `GAME#<timestamp>#<gameId>` | opponentId, result, eloBefore, eloAfter, eloChange |

**GSIs:**
- GSI1: `ACTIVE_GAME#<userId>` → `<gameId>` — check if user has active game
- GSI2: `EMAIL#<email>` → `USER` — auth lookup

**TTL** on `expiresAt`: auto-expire queue entries (5min) and old games (90 days).

---

## Game Flow

1. Player clicks "Find Match" → `POST /api/game/matchmake`
2. Server checks for existing active game (GSI1). If yes, return it.
3. Query queue for players within ±200 Elo. Match found → create GAME, assign random bug, remove both from queue. No match → add to queue with 5min TTL.
4. Client polls `GET /api/game/status` every 3 seconds until matched.
5. Both players see same buggy code + 4 multiple-choice options. Timer: 120 seconds (server-authoritative baseline + client decrement).
6. Player submits → `POST /api/game/submit` with conditional write (prevent double-submit).
7. Game resolves when both submit or timer expires. Winner: correct > incorrect; if both correct, faster wins.
8. Elo computed server-side, both profiles + leaderboard updated atomically.
9. Result shown: "You Won! +18 Elo" with bug explanation.

---

## API Routes

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/auth/[...nextauth]` | NextAuth handler |
| GET | `/api/user/profile` | Get current user |
| GET | `/api/user/history` | Match history (paginated) |
| POST | `/api/game/matchmake` | Enter queue or instant match |
| GET | `/api/game/status` | Poll game state |
| POST | `/api/game/submit` | Submit answer |
| GET | `/api/game/[gameId]` | Game details |
| POST | `/api/game/cancel` | Leave queue |
| GET | `/api/bugs/random` | Random bug (practice mode) |
| GET | `/api/leaderboard` | Top 100 global |
| POST | `/api/admin/bugs` | Create bug (admin) |
| POST | `/api/admin/bugs/generate` | AI generate bug via Bedrock |

---

## Frontend Pages

```
app/
  page.tsx                    — Landing page / hero
  (auth)/login/page.tsx       — Login (Google/GitHub)
  (game)/
    play/page.tsx             — Matchmaking + gameplay
    practice/page.tsx         — Solo mode (no Elo)
    result/[gameId]/page.tsx  — Post-game result
  (social)/
    leaderboard/page.tsx      — Global leaderboard
    profile/page.tsx          — Own profile + stats
    profile/[userId]/page.tsx — Public profile
```

**Key Components:**
- `CodeViewer` — syntax-highlighted buggy code (Prism.js)
- `AnswerOptions` — 4 multiple-choice buttons
- `GameTimer` — 120s countdown, server-authoritative (reuse RosettaCloud timer pattern)
- `MatchmakingOverlay` — spinner, "Finding opponent...", cancel
- `GameResult` — win/loss, Elo change animation, bug explanation
- `RankBadge` — Bronze/Silver/Gold/Platinum/Diamond/Master/Grandmaster
- `LeaderboardTable` — top 100, ISR (revalidate every 60s)
- `MatchHistory` — paginated recent games
- `EloChart` — simple SVG line chart

---

## Elo System

```
E = 1 / (1 + 10^((opponent - player) / 400))
newElo = player + K * (score - E)
```

| Condition | K-Factor |
|-----------|----------|
| Placement (games 1-10) | 40 |
| Elo < 1400 | 32 |
| Elo 1400-2000 | 24 |
| Elo > 2000 | 16 |

**Ranks:** Bronze (<1000), Silver (1000-1199), Gold (1200-1399), Platinum (1400-1599), Diamond (1600-1799), Master (1800-1999), Grandmaster (2000+)

---

## Bug Content

50-100 hand-crafted bugs across: Python, JavaScript, TypeScript, SQL, Bash, Go.

Categories: off-by-one, null reference, type coercion, wrong comparison, scope/closure, async mistakes, SQL bugs, logic errors.

Difficulty 1-5 mapped to Elo ranges. Bug selection: `targetDifficulty = ceil(avgElo / 400)`, weighted toward less-served bugs. Never serve same bug to same player twice.

AI generation via Bedrock Nova as bonus feature — generate + admin review queue.

---

## Million-Scale Justification (for judges)

- DynamoDB on-demand: auto-scales to millions of req/sec
- UUID partition keys: uniform distribution, no hot partitions
- Queue partitioned by Elo range (7 partitions): prevents hot partition on matchmaking
- Leaderboard: ISR on Vercel (revalidate 60s) — millions of users see cached page
- DynamoDB Global Tables: enable on us-east-1 + eu-west-1 for multi-region demo
- Vercel serverless: each API route scales independently, 0 to millions
- Stateless: no server sessions, no WebSockets, JWT carries identity
- Polling at 3s interval: at 1M users = 333K req/s — DynamoDB handles trivially

---

## Reusable RosettaCloud Code

| Pattern | Source | BugHunt Use |
|---------|--------|-------------|
| DynamoDB client + cache | `Backend/app/backends/users_backends.py` | `src/lib/dynamodb.ts` |
| Conditional PutItem | Same file, line 131 | Prevent double game submission |
| Update expression builder | Same file, lines 212-221 | Elo updates, profile updates |
| In-memory TTL cache | `Backend/app/backends/questions_backends.py:19-31` | Cache bugs, leaderboard |
| Question metadata format | Same file + `Backend/questions/` | Bug content model |
| Server-authoritative timer | `Frontend/src/app/lab/lab.component.ts:379-386` | GameTimer component |
| Rate limiting | `Backend/app/main.py:128-238` | API route protection |
| Polling with retry | `Frontend/src/app/lab/lab.component.ts:682-694` | Game status polling |

---

## 4-Week Timeline

### Week 1 (Jun 1-7): Foundation
- Day 1-2: Next.js scaffold, DynamoDB table, NextAuth + DynamoDB adapter, deploy to Vercel
- Day 3-4: DynamoDB utils, User model, Bug model, seed 20 bugs, basic API routes
- Day 5-7: Game engine backend (matchmaking, submit, resolve, Elo), test with 2 browser tabs

### Week 2 (Jun 8-14): Core UI
- Day 8-9: CodeViewer, AnswerOptions, GameTimer, MatchmakingOverlay
- Day 10-11: GameResult, Profile page, MatchHistory, EloChart
- Day 12-14: Leaderboard, Practice mode, seed 30 more bugs (total 50), mobile responsive

### Week 3 (Jun 15-21): Polish + Differentiators
- Day 15-16: Season system + season leaderboard
- Day 17-18: Bedrock Nova bug generation + admin review page
- Day 19-21: Streaks, daily challenge, achievement toasts, sound effects

### Week 4 (Jun 22-30): Ship
- Day 22-23: DynamoDB Global Tables, Vercel Analytics, load test
- Day 24-25: Edge case fixes (browser close, double game, timeouts)
- Day 26-27: Demo video (3min), architecture diagram, blog post
- Day 28-29: Final polish, screenshots, submission form
- Day 30: Submit

---

## What NOT to Build

- WebSocket real-time (polling is sufficient for async turn-based)
- Team/clan system
- Chat between players
- Payment/monetization
- Mobile app (responsive web only)
- Email notifications
- Social features (friends, follow)
- Replay system
- i18n
- CI/CD pipeline (Vercel auto-deploys from GitHub)
- Comprehensive test suite (only test Elo math)

---

## Submission Artifacts

1. **Demo video (3min):** Hook → login → matchmaking → gameplay → result → leaderboard → architecture → AI generation
2. **Architecture diagram:** Vercel Edge → Next.js API Routes → DynamoDB (single table) → Global Tables (3 regions) → Bedrock Nova
3. **Blog post on builder.aws:** "Building a Million-Scale Debugging Game with Next.js, Vercel, and DynamoDB" (+0.2 bonus points)
4. **Screenshots:** Vercel dashboard, DynamoDB console (Global Tables, metrics), Storage config

---

## Verification

1. Auth: Login with Google and GitHub, verify user created in DynamoDB
2. Gameplay: Open 2 browser tabs, matchmake, play a game, verify Elo updates
3. Leaderboard: Verify top 100 loads, ISR revalidation works
4. Practice: Play solo mode, no Elo change
5. Mobile: Test on phone-sized viewport
6. Scale proof: Run load test (Artillery/k6) against matchmaking endpoint — 1000 concurrent requests
