# Chess.com for Debugging: How BugHunt Runs Real-Time Multiplayer on DynamoDB with Zero Servers

*This article was created for the purposes of entering the [H0: Hack the Zero Stack](https://h0-hackathon.devpost.com/) hackathon. #H0Hackathon*

---

Every developer debugs. It's the skill you use more than any algorithm — reading unfamiliar code, spotting what's wrong, fixing it under pressure. Yet there's no competitive platform for it. LeetCode tests algorithms. HackerRank tests data structures. Nothing tests the skill you actually use at 2am in production.

**BugHunt changes that.** It's a real-time 1v1 debugging game: two players see the same buggy code snippet, race to identify the bug from four options, and earn Elo ratings like chess. Three rounds, 120 seconds each, fastest accurate answer wins. It's deployed at [bughunt-beryl.vercel.app](https://bughunt-beryl.vercel.app) and built entirely on Next.js 16 (Vercel) + DynamoDB (AWS).

## Why DynamoDB?

When I started designing BugHunt, I listed every read and write the app would make. Every single one was either a key lookup or a single-partition query:

| What | Key pattern | Cost |
|------|-------------|------|
| Load a profile | `USER#id` / `PROFILE` | 1 RCU |
| Find active game | GSI1: `ACTIVE_GAME#userId` | 1 query |
| Load game + my answers | `GAME#id` / `META`, `PLAYER#uid` | 2 reads |
| Submit an answer | Conditional update on `answers[i]` | 1 WCU |
| Top-100 leaderboard | `LEADERBOARD#GLOBAL` descending, limit 100 | 1 query |

No joins. No aggregations at read time. This is DynamoDB's sweet spot — and on-demand capacity means I never provision anything. The table scales with traffic, period.

## One Table, Every Entity

Everything in BugHunt lives in one DynamoDB table called `bughunt-main`:

- **Users** — profiles, Elo, match history, social follows
- **Games** — game state, per-player answers, post-game chat
- **Bugs** — the actual code snippets with options and explanations
- **Leaderboards** — materialized RANK# rows, never computed
- **Tournaments** — brackets and registrations
- **Organizations** — team leaderboards
- **Daily challenges** — one per day with streak tracking

Two GSIs cover the non-key access patterns: GSI1 maps active games to users (so matchmaking can find your in-progress game), and GSI2 maps emails to user IDs (for OAuth account linking).

## The Hard Part: Multiplayer on Serverless

A real-time multiplayer game is a pile of race conditions. Both players submitting in the same millisecond. Game resolution triggered twice. A rematch accepted from both ends simultaneously. A tournament slot claimed by two people.

In a traditional backend, you'd use database transactions or mutex locks. On serverless (no persistent state, no shared memory), those don't exist. Instead, I settled every race condition with **DynamoDB ConditionExpressions**:

```
// Submit answer — only succeeds if this round hasn't been answered yet
ConditionExpression: "attribute_not_exists(answers[2].submittedAt)"

// Resolve game — only one request wins
ConditionExpression: "#status = :active"

// Join private game — exactly-once player 2 assignment
ConditionExpression: "attribute_not_exists(player2Id) OR player2Id = :null"
```

The pattern is consistent: every write that can race carries a condition. The first writer wins; the second gets a `ConditionalCheckFailedException` and handles it gracefully (usually by returning the current state). No corruption, no locks, no transactions.

## The Leaderboard Is a Materialized View

Most leaderboards scan every user, sort by score, and return the top N. That's an O(n) query that gets slower as your user base grows.

BugHunt's leaderboard is **written, never read-computed**. Here's how:

1. When a game resolves, `resolveGame()` updates both players' Elo on their profiles, then stamps `p1EloBefore`, `p1EloAfter`, `p2EloBefore`, `p2EloAfter` onto the game META item.

2. That MODIFY event flows through **DynamoDB Streams** to a Lambda function.

3. The Lambda moves each player's `RANK#<zero-padded-elo>#<userId>` row under the `LEADERBOARD#GLOBAL` partition. Delete the old Elo row, write the new one.

4. Reading the top 100 is one descending Query on the leaderboard partition. Constant time, regardless of user count.

The zero-padding trick (`001262` for Elo 1262) turns DynamoDB's lexicographic sort key ordering into a numeric ranking. A per-user cursor row keyed by monotonic `gamesPlayed` count guards against cross-shard event reordering — even if two games for the same player arrive out of order, the cursor ensures the latest Elo always wins.

## Bots Without Servers

Hackathon demos die on empty matchmaking queues. But running a bot server defeats the "zero servers" architecture. BugHunt's bots have **no process at all**.

When a player has been in the matchmaking queue for 10 seconds with no human opponent, the next matchmake poll creates a game against a bot. From that point, the human's own requests power the bot's turns:

1. Every status poll / SSE tick calls `maybePlayBotRound(game)`
2. It checks whether the bot's deterministic think delay (seeded from `sha256(gameId:round)`) has elapsed
3. If yes, it writes the bot's answer through the exact same conditional-write path humans use
4. If another concurrent request already wrote it, the conditional write fails silently

The bot's answer quality is Elo-calibrated: a probability curve based on the bot's rating vs. the bug's difficulty, optionally overridden by Amazon Bedrock Nova (which literally reads the code and picks an answer with a 2.5-second timeout).

## Real-Time Without WebSockets

Vercel serverless functions can't hold WebSocket connections. BugHunt uses **Server-Sent Events (SSE)** with layered fallbacks:

1. **Primary**: TCP-based Redis pub/sub via ioredis — the game route subscribes to a `game:<gameId>` channel and pushes events instantly
2. **Safety net**: 10-second DynamoDB poll inside the same SSE connection catches anything pub/sub misses
3. **Fallback**: If Redis is completely unavailable, the client polls `/api/game/status` every 3 seconds

This means the game works even if Redis is down — it just updates slightly slower. No single point of failure.

## Scale Math

I did the honest math for 1 million daily active users (5 games/day each):

- **58 games/second average, ~290/s at peak** (5x burst factor)
- **~3,500 WCU/s** across game writes — UUID partition keys distribute uniformly; on-demand handles this trivially
- **Top-100 leaderboard reads** are cached in-memory for 60 seconds; effectively zero DynamoDB cost
- **SSE with pub/sub** costs function-hours (the only real dollar cost at scale)

The three known limits and their mitigation paths are documented in the repo's [ARCHITECTURE.md](https://github.com/mohamedsorour1998/bughunt/blob/main/docs/ARCHITECTURE.md): leaderboard partition write gating (skip writes for players far from top-100), BUG#INDEX item-size sharding, and SSE function-hour costs.

## The Stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 16 App Router (Turbopack) |
| Deployment | Vercel (global edge) |
| Database | DynamoDB single-table, on-demand, Global Tables |
| Stream processing | DynamoDB Streams + Lambda |
| Real-time coordination | Upstash Redis (matchmaking, pub/sub, rate limiting) |
| AI | Amazon Bedrock Nova Lite (bug quality filter, bot opponent) |
| Auth | NextAuth v5 (Google + GitHub OAuth) |
| Scheduling | Upstash QStash (daily challenge, tournament tick) |

## What I Learned

**Single-table design is a forcing function.** You must know every access pattern before you write a line of code. That sounds painful, but it means your data model serves your app perfectly — no ORM surprises, no N+1 queries, no migration headaches.

**On-demand DynamoDB makes 95% of scale free.** The engineering is in the other 5%: hot partitions, item-size ceilings, and held-open serverless functions. Do that math in the open. Your future self — and apparently hackathon judges — will thank you.

**ConditionExpressions replace locks.** Every race condition in a multiplayer game can be expressed as a conditional write. The mental model shift from "acquire lock, do work, release lock" to "attempt write, handle rejection" is genuinely better for serverless architectures.

---

**Try BugHunt:** [bughunt-beryl.vercel.app](https://bughunt-beryl.vercel.app)

**Source code:** [github.com/mohamedsorour1998/bughunt](https://github.com/mohamedsorour1998/bughunt)

*Built for the H0 Hackathon — Vercel + AWS Databases. #H0Hackathon*
