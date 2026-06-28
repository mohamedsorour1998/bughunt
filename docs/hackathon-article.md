# Chess.com for Debugging: How BugHunt Runs Real-Time Multiplayer on DynamoDB with Zero Servers

*This article was created for the purposes of entering the [H0: Hack the Zero Stack](https://h0-hackathon.devpost.com/) hackathon. #H0Hackathon*

---

Every developer debugs. It's the skill you use more than any algorithm — reading unfamiliar code, spotting what's wrong, fixing it under pressure. Yet there's no competitive platform for it. LeetCode tests algorithms. HackerRank tests data structures. Nothing tests the skill you actually use at 2am in production.

**BugHunt changes that.** It's a real-time 1v1 debugging game built to handle a million daily active users on a single DynamoDB table with no servers to manage: two players are matched by Elo rating, see the same buggy code snippet, race to identify the bug, and earn chess-style ratings. Three rounds, 120 seconds each, fastest accurate answer wins. At 1M DAU × 5 games/day that's ~290 game resolves per second at peak — all absorbed by DynamoDB on-demand, with no provisioned capacity, no hot-partition tricks, and no compute layer beyond Vercel serverless functions. It's live at [bughunt-beryl.vercel.app](https://bughunt-beryl.vercel.app).

## Why DynamoDB — and Why It Scales

The H0 hackathon Track 3 asks for a million-scale global app. Before writing a line of code, I did the math: 1M DAU × 5 games/day = 5M games/day ≈ **58 games/s average, ~290/s at peak** (5× burst). Each game generates ~12 DynamoDB writes across game state, player answers, and Elo updates — call it 3,500 WCU/s peak. DynamoDB on-demand handles this trivially: UUID partition keys distribute writes uniformly, there are no hot partitions, and capacity scales automatically with no provisioning.

The table uses Global Tables replicated to us-east-1, eu-west-1, and ap-southeast-1 — reads route to the nearest region. The leaderboard is a materialized view (constant-time reads at any user count, explained below). Every race condition is settled by ConditionExpressions (never locks). The result: a multiplayer game that scales horizontally without any changes to the application layer.

When I listed every read and write the app would make, every single one was either a key lookup or a single-partition query:

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

## Real Multiplayer: Elo-Bucketed Matchmaking

When you click Find Match, BugHunt pushes your Elo rating into a Redis sorted set bucketed by skill range. The next player in a compatible Elo band atomically claims the match — a `ZREM` that returns `> 0` is the only valid claim; two concurrent callers can't both grab the same opponent. The winner creates a game in DynamoDB with a conditional write, and both clients get their game ID back within milliseconds. If the `ZREM` wins but the game creation later fails (no bugs available, conditional conflict), the claimed opponent is re-enqueued — no one gets silently dropped.

This is the primary experience: humans racing humans at similar skill levels. Bots only enter when you've waited more than ten seconds with no human in range.

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

## Scale Math — The Honest Version

Rather than hand-wave "it'll scale," I documented every known limit and its mitigation path:

| Flow | Peak load | Verdict |
|------|-----------|---------|
| Game writes (~12 writes/game) | ~3,500 WCU/s | On-demand + UUID keys absorb trivially |
| Matchmaking (zadd/zrange/zrem) | ~700 ops/s @ 2K concurrent | Redis sorted sets, sharded by Elo band (~15 buckets) |
| Leaderboard reads | ~1 Query/60s/warm instance | In-memory cache; effectively free |
| SSE (DynamoDB polling fallback) | ~50K reads/s @ 100K concurrent | DynamoDB fine; real cost is function-hours |

**Known limits with mitigation paths:**

1. **Leaderboard partition write rate** — at ~1,000 WCU/partition/s the limit is ~125 resolves/s (≈0.4M DAU). Fix: Lambda skips writes for players whose Elo is far below the top-100 cutoff. >99% of games involve no top-100 candidate at million scale.
2. **BUG#INDEX item size** — one item, 400KB cap, safe to ~10K bugs. Fix: shard by difficulty (5 smaller items, same optimistic-versioning write path).
3. **SSE on serverless** — held-open functions are the dollar cost. Redis TCP pub/sub (when `REDIS_URL` is set) reduces per-game DynamoDB reads from 0.5/s to ~0.1/s. Final fallback: client polling.
4. **Multi-region writes** — currently pinned to us-east-1. Fix: multi-region Vercel functions + region-affinity matching (players matched through one queue, game writes share a region).

Full capacity documentation: [docs/ARCHITECTURE.md](https://github.com/mohamedsorour1998/bughunt/blob/main/docs/ARCHITECTURE.md)

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
