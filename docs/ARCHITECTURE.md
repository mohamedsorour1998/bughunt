# BugHunt — Architecture & Million-Scale Capacity Notes

Target: Track 3 — an app architected to scale to millions of users globally.
This document shows the access patterns, the math, the known limits, and the
mitigation path for each limit. We prefer honest ceilings over hand-waving.

## System shape

- **Vercel** serves the Next.js 16 App Router globally (static/SSR at the edge,
  API routes as serverless functions). No servers, no WebSockets, no sticky state.
- **DynamoDB single-table** (`bughunt-main`, on-demand) is the source of truth:
  users, games, answers, bugs, daily challenges, tournaments, orgs, social
  graph, notifications, chat. TTL (`expiresAt`) reaps games/history after 90 days.
- **DynamoDB Streams → Lambda** materializes the leaderboard: `resolveGame`
  stamps `p1EloBefore/After`, `p2EloBefore/After` on the game META item *after*
  profiles are updated; the Lambda moves `RANK#<paddedElo>#<userId>` rows under
  `LEADERBOARD#GLOBAL` / `LEADERBOARD#SEASON#<id>`. Reads are a single Query,
  newest-Elo-first, `Limit: 100` — the leaderboard is **never computed at read time**.
- **Upstash Redis** holds only ephemeral coordination: Elo-bucketed matchmaking
  zsets, rate-limit counters, game-event pub/sub. Losing Redis loses no data —
  every consumer has a DynamoDB fallback (SSE falls back to 2s polling).
- **Bedrock Nova Lite** does content work (community-bug quality gate, admin
  generation) and optionally *plays the game* as the bot opponent.
- **Bots are serverless too:** there is no bot process. The human's own
  requests (status poll / submit / SSE tick) drive `maybePlayBotRound()`;
  determinism comes from `sha256(gameId:round)` seeding, and the conditional
  write (`attribute_not_exists(answers[i].submittedAt)`) makes concurrent
  drivers race-safe.

## Why DynamoDB (and not SQL) for this workload

Every hot-path access is a key lookup or a single-partition Query — no joins,
no aggregations at read time:

| Access pattern | Key | Cost |
|---|---|---|
| Load profile | `USER#id` / `PROFILE` | 1 RCU |
| Active game for user | GSI1 `ACTIVE_GAME#userId` | 1 query |
| Game + my answers | `GAME#id` / `META`,`PLAYER#uid` | 2 reads |
| Submit answer (race-safe) | conditional update on `answers[i]` | 1 WCU |
| Resolve game (exactly once) | conditional `status: active→completed` | 1 WCU |
| Top-100 leaderboard | `LEADERBOARD#GLOBAL` Query desc, limit 100 | 1 query |
| Match history page | `USER#id` / `GAME#<ts>` Query desc | 1 query |

Writes are guarded by `ConditionExpression`s everywhere two requests can race
(double-submit, double-resolve, join, chat caps, follow edges, tournament
capacity, BUG#INDEX optimistic versioning with bounded retries).

## Capacity math @ 1M DAU

Assume 1M DAU × 5 games/day = 5M games/day ≈ **58 games/s average, ~290/s peak (5× factor)**.

| Flow | Per-game cost | Peak | Verdict |
|---|---|---|---|
| Game writes (answers, resolve, history, profiles) | ~12 writes spread across `GAME#uuid` / `USER#uuid` partitions | ~3.5K WCU/s | UUID partition keys distribute uniformly; on-demand absorbs this trivially |
| Matchmaking | O(log N) zadd/zrange/zrem per poll | ~700 ops/s @ 2K concurrent queuers | Redis comfortable; queue sharded by Elo band (~15 buckets) |
| Leaderboard reads | 1 Query / 60s / warm function instance (in-memory cache) | negligible | landing page is effectively free |
| SSE | 1 read / 2s / active game (poll fallback) | 100K concurrent games → ~50K eventually-consistent reads/s | DynamoDB fine; the real cost is function-hours — see Limit 3 |

## Known limits and their mitigation paths (read this, judges)

**Limit 1 — leaderboard partition write rate.** Every ranked resolve funnels
up to 8 writes (2 players × 2 boards × delete+put) into the `LEADERBOARD#GLOBAL`
partition. At ~1,000 WCU/partition/s (before adaptive split-for-heat), that
caps at ≈125 resolves/s ≈ 0.4M DAU. Mitigation (designed, not yet needed):
the Lambda caches the top-100 cutoff Elo and **skips writes for players below
cutoff − 50** — at million scale >99% of games involve no top-100 candidate,
cutting partition traffic by two orders of magnitude. Fallback: shard boards
by Elo band (`LEADERBOARD#GLOBAL#<band>`) and fan-in the top query.

**Limit 2 — `BUG#INDEX` item size.** The bug catalog index is one item
(~40B/id → ~10K bugs within the 400KB item cap; warn logs at 50%). Fine for a
curated catalog; the migration path is per-difficulty index items (the
`byDifficulty` map is already the natural shard key), five smaller items with
the same optimistic-versioning write path.

**Limit 3 — SSE on serverless.** Each active game holds a function open
polling DynamoDB every 2s. Data-wise this scales (see table); dollar-wise,
held-open functions are the costliest part of the design. Upgrade path
(implemented behind `REDIS_URL`): TCP pub/sub subscriber (push) with a 10s
safety poll, turning per-game cost from 0.5 read/s to ~0. Final fallback is
plain client polling of `/api/game/status` — which is how the game degrades
gracefully when *both* Redis modes are unavailable.

**Limit 4 — multi-region writes.** Global Tables replicate `bughunt-main` to
eu-west-1 and ap-southeast-1; `src/lib/dynamodb.ts` routes reads by
`VERCEL_REGION`. Writes are pinned to us-east-1 while Vercel functions run
single-region — flipping on multi-region functions makes writes local too.
Caveat we accept: DynamoDB conditional writes are evaluated per-region, so
cross-region active-active would need region-pinned games (players are matched
through one global queue anyway, so a game's writes naturally share a region).

## Failure-mode design

- Redis down → matchmaking returns "waiting" (no crash), SSE falls back to
  DynamoDB polling, rate limiting fails open. No data loss.
- Lambda down → games still resolve and profiles still update; the leaderboard
  goes stale and self-heals when the stream resumes (24h retention), or
  `scripts/rebuild-leaderboard.ts` rematerializes it from profiles.
- Double-everything (submit, resolve, join, rematch, bot turns) → conditional
  writes make the second writer a no-op.
