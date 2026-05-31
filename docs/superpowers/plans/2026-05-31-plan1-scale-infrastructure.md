# Scale Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace DynamoDB polling and synchronous leaderboard writes with Upstash Redis + SSE + DynamoDB Streams to demonstrate million-scale architecture.

**Architecture:** Upstash Redis handles matchmaking queue (O(log N) SORTED SET) and game event pub/sub. SSE replaces 3s polling (eliminates 333K req/s at 1M users). DynamoDB Streams + Lambda drives leaderboard asynchronously.

**Tech Stack:** @upstash/redis, Next.js App Router SSE (nodejs runtime), AWS Lambda (nodejs22.x), DynamoDB Streams, @vercel/og

---

## File Map

| File | Status | Responsibility |
|---|---|---|
| `src/lib/redis.ts` | **Create** | Upstash singleton + queue helpers + pub/sub + rate limit + daily challenge cache |
| `src/lib/__tests__/redis-helpers.test.ts` | **Create** | Unit tests for queue logic (mocked Redis) |
| `src/app/api/game/matchmake/route.ts` | **Modify** | Replace DynamoDB MATCH#QUEUE# ops with Redis SORTED SET; add rate limiting |
| `src/app/api/game/stream/route.ts` | **Create** | SSE endpoint: subscribe Redis channel, stream events to client |
| `src/app/api/game/submit/route.ts` | **Modify** | Publish `player_submitted` event after writing player record |
| `src/lib/game.ts` | **Modify** | Publish `game_resolved` in resolveGame; remove leaderboard writes |
| `src/app/(game)/play/page.tsx` | **Modify** | Replace setInterval polling with EventSource; polling as fallback |
| `lambda/leaderboard-updater/index.ts` | **Create** | Lambda handler: DynamoDB Streams → leaderboard writes |
| `lambda/leaderboard-updater/package.json` | **Create** | Lambda package manifest (@aws-sdk/client-dynamodb, @aws-sdk/lib-dynamodb) |
| `scripts/create-lambda.sh` | **Create** | aws lambda create-function + create-event-source-mapping |
| `scripts/build-lambda.sh` | **Create** | Build + zip Lambda for deployment |
| `scripts/enable-global-tables.sh` | **Modify** | Add ap-southeast-1 replica |
| `src/lib/dynamodb.ts` | **Modify** | Use VERCEL_REGION to select closest DynamoDB region |
| `.env.local.example` | **Modify** | Add UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN, CRON_SECRET |

---

## Task 1: Upstash Redis client + queue helpers

**Files:**
- Create: `src/lib/redis.ts`
- Create: `src/lib/__tests__/redis-helpers.test.ts`

### Background

The existing DynamoDB client at `src/lib/dynamodb.ts` follows a singleton pattern: one module-level client instance, exported helpers, no classes. Redis follows the same pattern.

`@upstash/redis` is an HTTP-based client — safe for Vercel Serverless/Edge because it does not hold a persistent TCP connection. Import: `import { Redis } from "@upstash/redis"`.

Elo ranges are bucketed: `Math.floor(elo / 200) * 200`. A player with elo 1350 lands in bucket 1200. Finding a match means searching buckets at `eloRange-200`, `eloRange`, and `eloRange+200` — the same logic already in the current matchmake route.

SORTED SET score = Unix timestamp in seconds → oldest waiters match first (FIFO). `ZRANGEBYSCORE queue:1200 -inf +inf LIMIT 0 10` returns up to 10 candidates oldest-first.

Rate limiting uses a sliding window key: `ratelimit:{userId}:{action}:{windowStart}` where `windowStart = Math.floor(Date.now() / 1000 / windowSeconds)`. INCR + EXPIRE gives atomic counting.

- [ ] **Step 1: Install @upstash/redis**

```bash
cd /home/sorour/BugHunt && npm install @upstash/redis
```

Expected output: `added 1 package` (no errors).

- [ ] **Step 2: Write the failing test**

Create `src/lib/__tests__/redis-helpers.test.ts`:

```typescript
// redis-helpers.test.ts — unit tests for queue logic
// Uses a hand-rolled mock; no real Redis connection required.

import { strict as assert } from "assert"

// ---------------------------------------------------------------------------
// Minimal Redis mock
// ---------------------------------------------------------------------------

interface MockRedis {
  data: Map<string, Map<string, number>>   // sorted sets: key → (member → score)
  strings: Map<string, string>              // plain strings
  zadd(key: string, score: number | { score: number; member: string }, member?: string): Promise<number>
  zrangebyscore(key: string, min: number | string, max: number | string, opts?: { limit?: [number, number] }): Promise<string[]>
  zrem(key: string, member: string): Promise<number>
  expire(key: string, seconds: number): Promise<number>
  get(key: string): Promise<string | null>
  set(key: string, value: string, opts?: { ex?: number }): Promise<string>
  incr(key: string): Promise<number>
  publish(channel: string, message: string): Promise<number>
  _reset(): void
}

function createMockRedis(): MockRedis {
  const data = new Map<string, Map<string, number>>()
  const strings = new Map<string, string>()

  return {
    data,
    strings,
    async zadd(key, scoreOrObj, memberArg) {
      let score: number
      let member: string
      if (typeof scoreOrObj === "object") {
        score = scoreOrObj.score
        member = scoreOrObj.member
      } else {
        score = scoreOrObj
        member = memberArg!
      }
      if (!data.has(key)) data.set(key, new Map())
      data.get(key)!.set(member, score)
      return 1
    },
    async zrangebyscore(key, min, max, opts) {
      const set = data.get(key)
      if (!set) return []
      const minN = min === "-inf" ? -Infinity : Number(min)
      const maxN = max === "+inf" ? Infinity : Number(max)
      const entries = [...set.entries()]
        .filter(([, s]) => s >= minN && s <= maxN)
        .sort(([, a], [, b]) => a - b)
        .map(([m]) => m)
      if (opts?.limit) {
        const [offset, count] = opts.limit
        return entries.slice(offset, offset + count)
      }
      return entries
    },
    async zrem(key, member) {
      return data.get(key)?.delete(member) ? 1 : 0
    },
    async expire() { return 1 },
    async get(key) { return strings.get(key) ?? null },
    async set(key, value) { strings.set(key, value); return "OK" },
    async incr(key) {
      const v = parseInt(strings.get(key) ?? "0", 10) + 1
      strings.set(key, String(v))
      return v
    },
    async publish() { return 0 },
    _reset() { data.clear(); strings.clear() },
  }
}

// ---------------------------------------------------------------------------
// Helpers under test — extracted as pure functions so we can inject the mock.
// The real src/lib/redis.ts exports these same signatures.
// ---------------------------------------------------------------------------

type RedisLike = MockRedis

function eloRangeBucket(elo: number): number {
  return Math.floor(elo / 200) * 200
}

async function enqueuePlayer(redis: RedisLike, userId: string, elo: number): Promise<void> {
  const range = eloRangeBucket(elo)
  const score = Math.floor(Date.now() / 1000)
  await redis.zadd(`queue:${range}`, score, userId)
  await redis.expire(`queue:${range}`, 300)
}

async function findMatch(redis: RedisLike, userId: string, elo: number): Promise<string | null> {
  const range = eloRangeBucket(elo)
  const ranges = [
    Math.max(0, range - 200),
    range,
    range + 200,
  ]
  const unique = [...new Set(ranges)]
  for (const r of unique) {
    const members = await redis.zrangebyscore(`queue:${r}`, "-inf", "+inf", { limit: [0, 10] })
    for (const m of members) {
      if (m !== userId) return m
    }
  }
  return null
}

async function dequeuePlayer(redis: RedisLike, userId: string, elo: number): Promise<void> {
  const range = eloRangeBucket(elo)
  await redis.zrem(`queue:${range}`, userId)
}

async function rateLimitCheck(
  redis: RedisLike,
  userId: string,
  action: string,
  maxRequests: number,
  windowSeconds: number
): Promise<boolean> {
  const windowStart = Math.floor(Date.now() / 1000 / windowSeconds)
  const key = `ratelimit:${userId}:${action}:${windowStart}`
  const count = await redis.incr(key)
  if (count === 1) {
    await redis.expire(key, windowSeconds * 2)
  }
  return count <= maxRequests
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

function test(name: string, fn: () => Promise<void>) {
  return fn().then(
    () => console.log("✓", name),
    (e) => { console.error("✗", name, e); process.exit(1) }
  )
}

const redis = createMockRedis()

async function runAll() {
  // enqueue + findMatch — happy path
  await test("enqueuePlayer adds to sorted set", async () => {
    redis._reset()
    await enqueuePlayer(redis, "user-a", 1200)
    const members = await redis.zrangebyscore("queue:1200", "-inf", "+inf")
    assert.deepEqual(members, ["user-a"])
  })

  await test("findMatch returns first non-self member", async () => {
    redis._reset()
    await enqueuePlayer(redis, "user-a", 1200)
    await enqueuePlayer(redis, "user-b", 1200)
    const match = await findMatch(redis, "user-a", 1200)
    assert.equal(match, "user-b")
  })

  await test("findMatch returns null when only self in queue", async () => {
    redis._reset()
    await enqueuePlayer(redis, "user-a", 1200)
    const match = await findMatch(redis, "user-a", 1200)
    assert.equal(match, null)
  })

  await test("findMatch searches adjacent elo buckets", async () => {
    redis._reset()
    // user-b is at elo 1000 → bucket 1000; user-a is at elo 1200 → bucket 1200
    // adjacent search for user-a includes bucket 1000
    await enqueuePlayer(redis, "user-b", 1000)
    const match = await findMatch(redis, "user-a", 1200)
    assert.equal(match, "user-b")
  })

  await test("dequeuePlayer removes from sorted set", async () => {
    redis._reset()
    await enqueuePlayer(redis, "user-a", 1200)
    await dequeuePlayer(redis, "user-a", 1200)
    const match = await findMatch(redis, "user-b", 1200)
    assert.equal(match, null)
  })

  await test("rateLimitCheck allows up to maxRequests", async () => {
    redis._reset()
    const results = await Promise.all([
      rateLimitCheck(redis, "u1", "matchmake", 3, 60),
      rateLimitCheck(redis, "u1", "matchmake", 3, 60),
      rateLimitCheck(redis, "u1", "matchmake", 3, 60),
    ])
    assert.deepEqual(results, [true, true, true])
  })

  await test("rateLimitCheck blocks when over limit", async () => {
    redis._reset()
    await rateLimitCheck(redis, "u1", "matchmake", 2, 60)
    await rateLimitCheck(redis, "u1", "matchmake", 2, 60)
    const blocked = await rateLimitCheck(redis, "u1", "matchmake", 2, 60)
    assert.equal(blocked, false)
  })

  console.log("\nAll redis-helpers tests passed!")
}

runAll()
```

- [ ] **Step 3: Run test to verify it fails (no src/lib/redis.ts yet — that's fine, the test is self-contained)**

```bash
cd /home/sorour/BugHunt && npx tsx src/lib/__tests__/redis-helpers.test.ts
```

Expected: all 6 tests pass (the test file contains its own implementations — this verifies the logic before wiring to real Redis).

- [ ] **Step 4: Create src/lib/redis.ts**

```typescript
/**
 * Upstash Redis client for BugHunt.
 *
 * Scale design:
 * - HTTP-based (Upstash REST API): no persistent TCP connections, safe in Vercel Serverless
 * - Sorted set matchmaking queue: O(log N) vs DynamoDB scan O(N)
 * - Pub/sub for game events: fan-out to SSE connections without polling
 * - Sliding-window rate limiting: O(1), no DynamoDB reads
 */
import { Redis } from "@upstash/redis"

// ---------------------------------------------------------------------------
// 1. Singleton Redis client
// ---------------------------------------------------------------------------
export const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
})

// ---------------------------------------------------------------------------
// 2. Queue helpers
// ---------------------------------------------------------------------------

/** Bucket elo to nearest 200 (e.g. 1350 → 1200). */
function eloRangeBucket(elo: number): number {
  return Math.floor(elo / 200) * 200
}

/**
 * Add userId to the sorted set for their elo range.
 * Score = Unix timestamp seconds → oldest waiters surface first (FIFO).
 * TTL: 300s — entire key auto-expires if no new enqueues within 5 min.
 */
export async function enqueuePlayer(userId: string, elo: number): Promise<void> {
  const range = eloRangeBucket(elo)
  const score = Math.floor(Date.now() / 1000)
  await redis.zadd(`queue:${range}`, { score, member: userId })
  await redis.expire(`queue:${range}`, 300)
}

/**
 * Scan elo-200, elo, and elo+200 buckets for the first non-self candidate.
 * Returns userId of opponent, or null if queue is empty / only self present.
 */
export async function findMatch(userId: string, elo: number): Promise<string | null> {
  const range = eloRangeBucket(elo)
  const ranges = [
    Math.max(0, range - 200),
    range,
    range + 200,
  ]
  const unique = [...new Set(ranges)]

  for (const r of unique) {
    const members = await redis.zrange(`queue:${r}`, 0, 9)
    for (const m of members) {
      if (m !== userId) return m as string
    }
  }
  return null
}

/**
 * Remove userId from their elo bucket (after match is found or cancel).
 */
export async function dequeuePlayer(userId: string, elo: number): Promise<void> {
  const range = eloRangeBucket(elo)
  await redis.zrem(`queue:${range}`, userId)
}

// ---------------------------------------------------------------------------
// 3. Pub/sub helpers
// ---------------------------------------------------------------------------

export type GameEvent =
  | { type: "player_submitted"; userId: string; correct: boolean; timeElapsedMs: number }
  | { type: "game_resolved"; winnerId: string | null; p1EloAfter: number; p2EloAfter: number }

export type NotificationEvent =
  | { type: "match_found"; gameId: string }

/**
 * Publish a game state event to channel game:{gameId}.
 * SSE connections in /api/game/stream subscribe to this channel.
 */
export async function publishGameEvent(gameId: string, event: GameEvent): Promise<void> {
  await redis.publish(`game:${gameId}`, JSON.stringify(event))
}

/**
 * Publish a user-level notification to channel notifications:{userId}.
 */
export async function publishNotification(userId: string, event: NotificationEvent): Promise<void> {
  await redis.publish(`notifications:${userId}`, JSON.stringify(event))
}

// ---------------------------------------------------------------------------
// 4. Rate limiting — sliding window
// ---------------------------------------------------------------------------

/**
 * Increment a sliding-window counter for userId+action.
 * Returns true if the request is allowed (count <= maxRequests), false if over limit.
 *
 * Key: ratelimit:{userId}:{action}:{windowStart}
 * where windowStart = floor(now_seconds / windowSeconds)
 */
export async function rateLimitCheck(
  userId: string,
  action: string,
  maxRequests: number,
  windowSeconds: number
): Promise<boolean> {
  const windowStart = Math.floor(Date.now() / 1000 / windowSeconds)
  const key = `ratelimit:${userId}:${action}:${windowStart}`
  const count = await redis.incr(key)
  if (count === 1) {
    // First request in this window — set TTL so key auto-expires
    await redis.expire(key, windowSeconds * 2)
  }
  return count <= maxRequests
}

// ---------------------------------------------------------------------------
// 5. Daily challenge cache
// ---------------------------------------------------------------------------

/**
 * Get the bugId for today's daily challenge.
 * Returns null if not yet set.
 */
export async function getDailyChallengeBugId(date: string): Promise<string | null> {
  return redis.get<string>(`daily_challenge:${date}`)
}

/**
 * Cache today's daily challenge bugId.
 * Expires at midnight UTC (seconds until next midnight).
 */
export async function setDailyChallengeBugId(date: string, bugId: string): Promise<void> {
  // Calculate seconds until midnight UTC
  const now = new Date()
  const midnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1))
  const secondsUntilMidnight = Math.floor((midnight.getTime() - now.getTime()) / 1000)
  await redis.set(`daily_challenge:${date}`, bugId, { ex: secondsUntilMidnight })
}
```

- [ ] **Step 5: Run the tests again (all should still pass — logic unchanged)**

```bash
cd /home/sorour/BugHunt && npx tsx src/lib/__tests__/redis-helpers.test.ts
```

Expected: all 6 tests pass.

- [ ] **Step 6: Commit**

```bash
cd /home/sorour/BugHunt && git add src/lib/redis.ts src/lib/__tests__/redis-helpers.test.ts package.json package-lock.json && git commit -m "feat: add Upstash Redis client and queue helpers"
```

---

## Task 2: Migrate matchmake route to Redis

**Files:**
- Modify: `src/app/api/game/matchmake/route.ts`

### Background

The current route at `src/app/api/game/matchmake/route.ts` does multiple DynamoDB queries to scan `MATCH#QUEUE#*` keys. We replace those with `enqueuePlayer`, `findMatch`, and `dequeuePlayer` from `src/lib/redis.ts`.

What stays the same:
- `getActiveGameForUser(userId)` — GSI1 check in DynamoDB (correct, Redis queue is ephemeral)
- `getUser(userId)` — fetches elo from DynamoDB
- `selectBugForGame` — unchanged
- `createGame` — unchanged (writes DynamoDB game record)
- `TransactWriteCommand` — removed (no DynamoDB queue item to delete atomically; Redis ZREM is called separately)
- `updateUser` bugsSeen writes — unchanged

The new race-condition protection: after `findMatch` returns an opponentId, we call `dequeuePlayer` for both self and opponent before creating the game. If two matchmakers race to claim the same opponent, only one succeeds at the `createGame` + DynamoDB transaction level (the `putItemIfNotExists` on the game META already protects this via `attribute_not_exists(pk)`). We fall back to queue if the game already exists.

Rate limiting: 10 calls/min per user. If over limit, return 429.

- [ ] **Step 1: Replace matchmake route**

Overwrite `src/app/api/game/matchmake/route.ts` with:

```typescript
import { NextResponse } from "next/server"
import { getUser } from "@/lib/users"
import { getActiveGameForUser, createGame } from "@/lib/game"
import { selectBugForGame } from "@/lib/bugs"
import { safeAuth, getTestSession, getTestSessionFromCookies } from "@/lib/test-auth"
import {
  enqueuePlayer,
  findMatch,
  dequeuePlayer,
  rateLimitCheck,
} from "@/lib/redis"

export async function POST(req: Request) {
  const session = (await safeAuth()) ?? getTestSession(req) ?? await getTestSessionFromCookies()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const userId = session.user.id

  // Rate limit: 10 matchmake calls per minute per user
  const allowed = await rateLimitCheck(userId, "matchmake", 10, 60)
  if (!allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  // Check if user already has an active game
  const activeGame = await getActiveGameForUser(userId)
  if (activeGame) {
    return NextResponse.json({ gameId: activeGame.gameId, status: activeGame.status })
  }

  // Get user profile for elo
  const userProfile = await getUser(userId)
  if (!userProfile) {
    return NextResponse.json({ error: "User not found" }, { status: 404 })
  }

  const elo = userProfile.elo

  // Search adjacent elo buckets for an opponent
  const opponentId = await findMatch(userId, elo)

  if (opponentId) {
    // Remove both players from the queue before creating game
    const opponentProfile = await getUser(opponentId)

    const bugForGame = await selectBugForGame(
      Math.round((elo + (opponentProfile?.elo ?? elo)) / 2),
      userProfile.bugsSeen,
      opponentProfile?.bugsSeen ?? []
    )

    if (!bugForGame) {
      // No bug available — fall through to queue
      return queueUser(userId, elo)
    }

    // Dequeue both players atomically (best-effort: if opponent was already
    // dequeued by a racing matchmaker, we still proceed)
    await Promise.all([
      dequeuePlayer(userId, elo),
      dequeuePlayer(opponentId, opponentProfile?.elo ?? elo),
    ])

    // Create game record in DynamoDB
    let game
    try {
      game = await createGame(userId, opponentId, bugForGame.bugId)
    } catch (err: unknown) {
      // ConditionalCheckFailedException = game already exists (race condition)
      if (err instanceof Error && err.name === "ConditionalCheckFailedException") {
        return queueUser(userId, elo)
      }
      throw err
    }

    // Update both users' bugsSeen arrays
    const newSelfBugsSeen = [...new Set([...userProfile.bugsSeen, bugForGame.bugId])]
    const newOpponentBugsSeen = [
      ...new Set([...(opponentProfile?.bugsSeen ?? []), bugForGame.bugId]),
    ]

    await Promise.all([
      import("@/lib/users").then(({ updateUser }) =>
        updateUser(userId, { bugsSeen: newSelfBugsSeen })
      ),
      opponentProfile
        ? import("@/lib/users").then(({ updateUser }) =>
            updateUser(opponentId, { bugsSeen: newOpponentBugsSeen })
          )
        : Promise.resolve(),
    ])

    return NextResponse.json({ gameId: game.gameId, status: "active" })
  }

  // No opponent found — add self to queue
  return queueUser(userId, elo)
}

async function queueUser(userId: string, elo: number): Promise<NextResponse> {
  await enqueuePlayer(userId, elo)
  return NextResponse.json({ status: "waiting", gameId: null })
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /home/sorour/BugHunt && npx tsc --noEmit
```

Expected: no errors. If you see `Cannot find module '@/lib/redis'`, verify `src/lib/redis.ts` was created in Task 1.

- [ ] **Step 3: Commit**

```bash
cd /home/sorour/BugHunt && git add src/app/api/game/matchmake/route.ts && git commit -m "feat: migrate matchmake route from DynamoDB queue to Redis SORTED SET"
```

---

## Task 3: SSE game stream endpoint

**Files:**
- Create: `src/app/api/game/stream/route.ts`

### Background

Upstash Redis HTTP client supports pub/sub via a long-poll mechanism. The `subscribe` method blocks waiting for messages, making it suitable for SSE.

`export const runtime = "nodejs"` is required — Edge runtime does not support long-lived streaming.

The `ReadableStream` constructor's `start(controller)` callback sets up the subscription. The `cancel()` callback runs when the client disconnects (browser closes the tab, navigation away).

`game:{gameId}` channel carries `GameEvent` objects (defined in `src/lib/redis.ts`). On `game_resolved` event, we close the stream so the client knows to stop listening.

Auth check pattern: same as every other route in this codebase — `safeAuth() ?? getTestSession(req) ?? getTestSessionFromCookies()`.

- [ ] **Step 1: Create the SSE route**

Create `src/app/api/game/stream/route.ts`:

```typescript
import { type NextRequest, NextResponse } from "next/server"
import { safeAuth, getTestSession, getTestSessionFromCookies } from "@/lib/test-auth"
import { getGame } from "@/lib/game"
import { redis } from "@/lib/redis"

export const runtime = "nodejs"

export async function GET(req: NextRequest) {
  const session =
    (await safeAuth()) ?? getTestSession(req) ?? (await getTestSessionFromCookies())
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const userId = session.user.id
  const { searchParams } = req.nextUrl
  const gameId = searchParams.get("gameId")

  if (!gameId) {
    return NextResponse.json({ error: "Missing gameId" }, { status: 400 })
  }

  // Verify the game exists and this user is a participant
  const game = await getGame(gameId)
  if (!game) {
    return NextResponse.json({ error: "Game not found" }, { status: 404 })
  }
  if (game.player1Id !== userId && game.player2Id !== userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  // If game is already completed, send a final event immediately and close
  if (game.status === "completed") {
    const body = `data: ${JSON.stringify({ type: "game_resolved", gameId })}\n\n`
    return new Response(body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    })
  }

  // Subscribe to game channel and stream events to client
  const channel = `game:${gameId}`

  // Upstash subscribe returns an async iterator
  const stream = new ReadableStream({
    async start(controller) {
      try {
        // redis.subscribe returns a PubSubMessage async iterator
        for await (const message of redis.subscribe(channel)) {
          const data = typeof message.message === "string"
            ? message.message
            : JSON.stringify(message.message)

          controller.enqueue(
            new TextEncoder().encode(`data: ${data}\n\n`)
          )

          // Close stream after game_resolved so client knows to stop
          let parsed: { type?: string } = {}
          try { parsed = JSON.parse(data) } catch { /* ignore */ }
          if (parsed.type === "game_resolved") {
            controller.close()
            return
          }
        }
      } catch {
        // Client disconnected or subscription error — close cleanly
        try { controller.close() } catch { /* already closed */ }
      }
    },
    cancel() {
      // ReadableStream cancel is called when the client disconnects.
      // Upstash HTTP subscriptions are stateless — no explicit unsubscribe needed.
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  })
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /home/sorour/BugHunt && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /home/sorour/BugHunt && git add src/app/api/game/stream/route.ts && git commit -m "feat: add SSE game stream endpoint using Upstash Redis pub/sub"
```

---

## Task 4: Publish game events from submit + resolveGame

**Files:**
- Modify: `src/app/api/game/submit/route.ts`
- Modify: `src/lib/game.ts`

### Background

Two moments emit events:
1. A player submits their answer → `player_submitted` event so the opponent's UI can show "Opponent submitted!"
2. The game resolves → `game_resolved` event so both clients redirect to the result page

`publishGameEvent` from `src/lib/redis.ts` takes `(gameId: string, event: GameEvent)`. The call is fire-and-forget — wrap in a try/catch so a Redis failure never breaks the core game flow.

In `submit/route.ts`, publish **after** `putItemIfNotExists` confirms the write succeeded (line 63-76 in the original). In `game.ts` `resolveGame`, publish **after** the `putItem` that re-writes the META record as `status: "completed"` (around line 452-464 in the original).

- [ ] **Step 1: Add publishGameEvent call to submit route**

Open `src/app/api/game/submit/route.ts`. Add the import and publish call.

The file currently ends at line 103 with `return NextResponse.json({ correct, answer, submittedAt })`. The change is:

1. Add import at top of file (after existing imports):

```typescript
import { publishGameEvent } from "@/lib/redis"
```

2. After the `if (!written)` block (line 74-76) and before the `const otherId = ...` line, add:

```typescript
  // Publish submit event to SSE subscribers — fire-and-forget
  publishGameEvent(gameId, {
    type: "player_submitted",
    userId,
    correct,
    timeElapsedMs,
  }).catch(() => {/* Redis publish failure must not break game flow */})
```

Full updated file `src/app/api/game/submit/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server"
import { getGame, getGamePlayer, resolveGame } from "@/lib/game"
import { getBug } from "@/lib/bugs"
import { putItemIfNotExists, getItem } from "@/lib/dynamodb"
import { safeAuth, getTestSession, getTestSessionFromCookies } from "@/lib/test-auth"
import { publishGameEvent } from "@/lib/redis"

export async function POST(request: NextRequest) {
  const session = (await safeAuth()) ?? getTestSession(request) ?? await getTestSessionFromCookies()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const userId = session.user.id

  let body: { gameId: string; answer: number }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  }

  const { gameId, answer } = body

  if (!gameId || answer === undefined || answer === null) {
    return NextResponse.json({ error: "Missing gameId or answer" }, { status: 400 })
  }

  if (typeof answer !== "number" || answer < 0 || answer > 3) {
    return NextResponse.json({ error: "Answer must be 0-3" }, { status: 400 })
  }

  const game = await getGame(gameId)
  if (!game) {
    return NextResponse.json({ error: "Game not found" }, { status: 404 })
  }

  if (game.status !== "active") {
    return NextResponse.json({ error: "Game is not active" }, { status: 400 })
  }

  // Verify requesting user is a participant
  if (game.player1Id !== userId && game.player2Id !== userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  // Check timer: 120 seconds
  const now = Date.now()
  if (now > game.createdAt + 120_000) {
    return NextResponse.json({ error: "Time expired" }, { status: 400 })
  }

  // Get bug for correctAnswer check
  const bug = await getBug(game.bugId)
  if (!bug) {
    return NextResponse.json({ error: "Bug not found" }, { status: 500 })
  }

  const correct = answer === bug.correctAnswer
  const submittedAt = now
  const timeElapsedMs = now - game.createdAt

  // putItemIfNotExists — returns false if already submitted (409)
  const written = await putItemIfNotExists({
    pk: `GAME#${gameId}`,
    sk: `PLAYER#${userId}`,
    gameId,
    userId,
    answer,
    correct,
    submittedAt,
    timeElapsedMs,
  })

  if (!written) {
    return NextResponse.json({ error: "Already submitted" }, { status: 409 })
  }

  // Publish submit event to SSE subscribers — fire-and-forget
  publishGameEvent(gameId, {
    type: "player_submitted",
    userId,
    correct,
    timeElapsedMs,
  }).catch(() => {/* Redis publish failure must not break game flow */})

  // Check if game should resolve:
  // - Both players have submitted, OR
  // - Timer has expired for the other player (they can no longer submit)
  const otherId = game.player1Id === userId ? game.player2Id : game.player1Id
  let shouldResolve = false

  if (!otherId) {
    // Solo game — resolve immediately
    shouldResolve = true
  } else {
    const otherPlayerRecord = await getGamePlayer(gameId, otherId)
    if (otherPlayerRecord !== null && otherPlayerRecord.submittedAt !== null) {
      // Both have submitted
      shouldResolve = true
    } else if (now > game.createdAt + 120_000) {
      // Timer expired for other player
      shouldResolve = true
    }
  }

  if (shouldResolve) {
    await resolveGame(gameId)
  }

  return NextResponse.json({ correct, answer, submittedAt })
}
```

- [ ] **Step 2: Add publishGameEvent call to resolveGame in src/lib/game.ts**

In `src/lib/game.ts`, add the import at the top of the file (after existing imports):

```typescript
import { publishGameEvent } from "@/lib/redis"
```

Then, inside `resolveGame`, after the `putItem` call that re-writes the META record as `status: "completed"` (around line 452-464), add the publish call. The `putItem` block looks like this:

```typescript
  await putItem({
    pk: `GAME#${gameId}`,
    sk: "META",
    gameId,
    player1Id: game.player1Id,
    player2Id: game.player2Id,
    bugId: game.bugId,
    status: "completed",
    winnerId,
    createdAt: game.createdAt,
    expiresAt: game.expiresAt,
    // No gsi1pk / gsi1sk — completed game should not appear in active queries
  })
```

Add immediately after that `putItem` call:

```typescript
  // Publish game_resolved event to SSE subscribers — fire-and-forget
  publishGameEvent(gameId, {
    type: "game_resolved",
    winnerId,
    p1EloAfter,
    p2EloAfter,
  }).catch(() => {/* Redis publish failure must not break game resolution */})
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /home/sorour/BugHunt && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Run existing unit tests**

```bash
cd /home/sorour/BugHunt && npm run test:unit
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
cd /home/sorour/BugHunt && git add src/app/api/game/submit/route.ts src/lib/game.ts && git commit -m "feat: publish Redis game events from submit and resolveGame"
```

---

## Task 5: Update play page to use EventSource

**Files:**
- Modify: `src/app/(game)/play/page.tsx`

### Background

The current play page uses `setInterval` polling at 3-second intervals in `startGameplayPolling`. We replace this with `EventSource` when in the "playing" state.

`EventSource` is a browser API — not available server-side. The feature-detect is: `typeof EventSource !== "undefined"`. If it fails (unlikely in modern browsers but handles SSR hydration edge cases), fall back to the existing polling.

The SSE stream sends two event types (both as `message` events since we use `data:` without `event:` field):
- `{ type: "player_submitted", userId, correct, timeElapsedMs }` → set `opponentSubmitted = true` for the opponent's userId
- `{ type: "game_resolved", winnerId, p1EloAfter, p2EloAfter }` → redirect to `/game/result/{gameId}`

Lifecycle:
- Open `EventSource` when `playState` transitions to "playing" and `gameId` is set
- Store the `EventSource` instance in a `useRef`
- Close it on unmount (`useEffect` cleanup) and when the game completes
- Keep the existing polling ref and `startGameplayPolling` function as the fallback path

The matchmaking polling (`startMatchmakingPolling`) is unchanged — it polls `/api/game/matchmake` to detect when a game is found. Only the gameplay polling (after game starts) moves to SSE.

- [ ] **Step 1: Replace gameplay polling with EventSource in play/page.tsx**

In `src/app/(game)/play/page.tsx`, make these changes:

1. Add `esRef` alongside the existing `pollRef`:

```typescript
  const esRef = useRef<EventSource | null>(null)
```

2. Add a `stopSSE` helper alongside the existing `stopPolling`:

```typescript
  function stopSSE() {
    if (esRef.current) {
      esRef.current.close()
      esRef.current = null
    }
  }
```

3. Update the unmount cleanup effect to also close SSE:

```typescript
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopPolling()
      stopSSE()
    }
  }, [])
```

4. Replace `startGameplayPolling` with a new version that uses EventSource with polling fallback:

```typescript
  const startGameplayPolling = useCallback(
    (id: string) => {
      stopPolling()
      stopSSE()

      // Feature-detect EventSource (browser only)
      if (typeof EventSource !== "undefined") {
        const es = new EventSource(`/api/game/stream?gameId=${id}`)
        esRef.current = es

        es.onmessage = (event) => {
          try {
            const data: { type: string; userId?: string; winnerId?: string } =
              JSON.parse(event.data)

            if (data.type === "player_submitted" && data.userId !== session?.user?.id) {
              setOpponentSubmitted(true)
            }

            if (data.type === "game_resolved") {
              stopSSE()
              stopPolling()
              setPlayState("completed")
              router.push(`/game/result/${id}`)
            }
          } catch {
            // Malformed event — ignore
          }
        }

        es.onerror = () => {
          // SSE connection failed — fall back to polling
          stopSSE()
          startPollingFallback(id)
        }
      } else {
        // SSR or browser without EventSource — use polling
        startPollingFallback(id)
      }
    },
    [session?.user?.id, router] // eslint-disable-line react-hooks/exhaustive-deps
  )

  const startPollingFallback = useCallback(
    (id: string) => {
      stopPolling()
      pollRef.current = setInterval(async () => {
        try {
          const res = await fetch(`/api/game/status?gameId=${id}`)
          if (!res.ok) return
          const data: StatusResponse = await res.json()

          if (data.game) setGameData(data.game)
          if (data.player) setPlayerRecord(data.player)

          // Detect opponent submission via the [gameId] route
          const detailRes = await fetch(`/api/game/${id}`)
          if (detailRes.ok) {
            const detail = await detailRes.json()
            const myId = session?.user?.id
            const isPlayer1 = data.game?.player1Id === myId
            const opponentPlayer = isPlayer1
              ? detail.players?.player2
              : detail.players?.player1
            if (opponentPlayer?.submitted) {
              setOpponentSubmitted(true)
            }
          }

          if (data.game?.status === "completed") {
            stopPolling()
            setPlayState("completed")
            router.push(`/game/result/${id}`)
          }
        } catch {
          // Network hiccup — will retry
        }
      }, 3000)
    },
    [session?.user?.id, router]
  )
```

5. Add `esRef` to the `handleCancel` cleanup:

```typescript
  async function handleCancel() {
    setCancelLoading(true)
    stopPolling()
    stopSSE()   // <-- add this line
    // ... rest of handleCancel unchanged
  }
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /home/sorour/BugHunt && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /home/sorour/BugHunt && git add src/app/(game)/play/page.tsx && git commit -m "feat: replace gameplay polling with EventSource SSE (polling fallback retained)"
```

---

## Task 6: DynamoDB Streams Lambda

**Files:**
- Create: `lambda/leaderboard-updater/index.ts`
- Create: `lambda/leaderboard-updater/package.json`
- Create: `scripts/create-lambda.sh`
- Create: `scripts/build-lambda.sh`

### Background

The Lambda receives a `DynamoDBStreamEvent` from `aws-lambda` types. Each record has `eventName` ("INSERT" | "MODIFY" | "REMOVE") and `dynamodb.NewImage`.

Filter: only process records where:
- `eventName === "MODIFY"` (game going from active → completed)
- `NewImage.sk.S === "META"` (the game's main record, not player records)
- `NewImage.status.S === "completed"`

Idempotency: before writing, check if the leaderboard entry for the new elo already exists. Use a conditional `putItem` with `attribute_not_exists(pk) OR elo <> :newElo`.

The Lambda reads player profiles from DynamoDB to get `displayName`, `avatar`, `gamesPlayed`, `gamesWon`. The `NewImage` already contains `winnerId`, `player1Id`, `player2Id` — we use those to construct the update.

This Lambda runs in its own Node.js process outside Next.js, so it imports `@aws-sdk/client-dynamodb` directly (not the singleton from `src/lib/dynamodb.ts`).

The `zeroPad` helper produces a fixed-width elo string for lexicographic leaderboard ordering — same logic as in `src/lib/game.ts`.

- [ ] **Step 1: Create lambda/leaderboard-updater/package.json**

```bash
mkdir -p /home/sorour/BugHunt/lambda/leaderboard-updater
```

Create `lambda/leaderboard-updater/package.json`:

```json
{
  "name": "bughunt-leaderboard-updater",
  "version": "1.0.0",
  "description": "DynamoDB Streams Lambda for async leaderboard updates",
  "main": "index.js",
  "scripts": {
    "build": "npx tsc --outDir dist --module commonjs --target es2020 --esModuleInterop true --strict true index.ts"
  },
  "dependencies": {
    "@aws-sdk/client-dynamodb": "^3.1057.0",
    "@aws-sdk/lib-dynamodb": "^3.1057.0"
  },
  "devDependencies": {
    "@types/aws-lambda": "^8.10.145",
    "typescript": "^5.0.0"
  }
}
```

- [ ] **Step 2: Create lambda/leaderboard-updater/index.ts**

Create `lambda/leaderboard-updater/index.ts`:

```typescript
/**
 * bughunt-leaderboard-updater
 *
 * Triggered by DynamoDB Streams on bughunt-main.
 * Processes GAME#<id> META records that transition to status=completed.
 * Writes LEADERBOARD#GLOBAL and LEADERBOARD#SEASON#1 entries.
 *
 * Idempotent: skips if leaderboard entry already exists with the same elo.
 */
import { DynamoDBClient } from "@aws-sdk/client-dynamodb"
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  DeleteCommand,
} from "@aws-sdk/lib-dynamodb"
import type {
  DynamoDBStreamEvent,
  DynamoDBRecord,
  Handler,
} from "aws-lambda"

// ---------------------------------------------------------------------------
// DynamoDB client
// ---------------------------------------------------------------------------

const client = new DynamoDBClient({ region: process.env.AWS_REGION ?? "us-east-1" })
const ddb = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
})
const TABLE = process.env.DYNAMODB_TABLE_NAME ?? "bughunt-main"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UserProfile {
  userId: string
  displayName: string
  avatar: string | null
  elo: number
  gamesPlayed: number
  gamesWon: number
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function zeroPad(n: number): string {
  return String(n).padStart(6, "0")
}

async function getUserProfile(userId: string): Promise<UserProfile | null> {
  const result = await ddb.send(
    new GetCommand({ TableName: TABLE, Key: { pk: `USER#${userId}`, sk: "PROFILE" } })
  )
  if (!result.Item) return null
  return result.Item as UserProfile
}

async function updateLeaderboardEntry(
  leaderboardPk: string,
  userId: string,
  oldElo: number,
  newElo: number,
  displayName: string,
  avatar: string | null,
  gamesPlayed: number,
  gamesWon: number
): Promise<void> {
  // Delete old entry (may not exist — suppress error)
  const oldKey = zeroPad(oldElo) + "#" + userId
  await ddb
    .send(new DeleteCommand({ TableName: TABLE, Key: { pk: leaderboardPk, sk: `RANK#${oldKey}` } }))
    .catch(() => {/* ignore */})

  // Write new entry — idempotent conditional write
  const newKey = zeroPad(newElo) + "#" + userId
  try {
    await ddb.send(
      new PutCommand({
        TableName: TABLE,
        Item: {
          pk: leaderboardPk,
          sk: `RANK#${newKey}`,
          userId,
          elo: newElo,
          displayName,
          avatar,
          gamesPlayed,
          gamesWon,
          updatedAt: Date.now(),
        },
        // Skip if entry already exists with the exact same elo (duplicate event)
        ConditionExpression:
          "attribute_not_exists(pk) OR #elo <> :newElo",
        ExpressionAttributeNames: { "#elo": "elo" },
        ExpressionAttributeValues: { ":newElo": newElo },
      })
    )
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      err.name === "ConditionalCheckFailedException"
    ) {
      // Already written with this elo — idempotent, ignore
      return
    }
    throw err
  }
}

// ---------------------------------------------------------------------------
// Process one stream record
// ---------------------------------------------------------------------------

async function processRecord(record: DynamoDBRecord): Promise<void> {
  // Only process MODIFY events (active → completed transitions)
  if (record.eventName !== "MODIFY") return

  const newImage = record.dynamodb?.NewImage
  if (!newImage) return

  // Filter: only game META records that just completed
  if (newImage.sk?.S !== "META") return
  if (newImage.status?.S !== "completed") return

  const gameId = newImage.gameId?.S
  const player1Id = newImage.player1Id?.S
  const player2Id = newImage.player2Id?.S
  const winnerId = newImage.winnerId?.S ?? null

  if (!gameId || !player1Id) return

  // Read current player profiles (contains updated elo from resolveGame)
  const [p1Profile, p2Profile] = await Promise.all([
    getUserProfile(player1Id),
    player2Id ? getUserProfile(player2Id) : Promise.resolve(null),
  ])

  if (!p1Profile) return

  // Compute old elo: we need it to delete the stale leaderboard entry.
  // The OldImage carries the pre-update elo.
  const oldImage = record.dynamodb?.OldImage
  const p1OldElo = parseInt(oldImage?.elo?.N ?? String(p1Profile.elo), 10)
  const p2OldElo = p2Profile
    ? parseInt(oldImage?.p2Elo?.N ?? String(p2Profile.elo), 10)
    : p1Profile.elo

  // Update LEADERBOARD#GLOBAL
  await updateLeaderboardEntry(
    "LEADERBOARD#GLOBAL",
    player1Id,
    p1OldElo,
    p1Profile.elo,
    p1Profile.displayName,
    p1Profile.avatar,
    p1Profile.gamesPlayed,
    p1Profile.gamesWon
  )

  if (p2Profile && player2Id) {
    await updateLeaderboardEntry(
      "LEADERBOARD#GLOBAL",
      player2Id,
      p2OldElo,
      p2Profile.elo,
      p2Profile.displayName,
      p2Profile.avatar,
      p2Profile.gamesPlayed,
      p2Profile.gamesWon
    )
  }

  // Update LEADERBOARD#SEASON#1 (hardcoded season 1; extend for dynamic seasons later)
  const seasonPk = "LEADERBOARD#SEASON#1"
  await updateLeaderboardEntry(
    seasonPk,
    player1Id,
    p1OldElo,
    p1Profile.elo,
    p1Profile.displayName,
    p1Profile.avatar,
    p1Profile.gamesPlayed,
    p1Profile.gamesWon
  )

  if (p2Profile && player2Id) {
    await updateLeaderboardEntry(
      seasonPk,
      player2Id,
      p2OldElo,
      p2Profile.elo,
      p2Profile.displayName,
      p2Profile.avatar,
      p2Profile.gamesPlayed,
      p2Profile.gamesWon
    )
  }
}

// ---------------------------------------------------------------------------
// Lambda handler
// ---------------------------------------------------------------------------

export const handler: Handler<DynamoDBStreamEvent, void> = async (event) => {
  const results = await Promise.allSettled(
    event.Records.map((record) => processRecord(record))
  )

  // Log any failures but don't throw — let Lambda retry the batch
  for (const result of results) {
    if (result.status === "rejected") {
      console.error("Failed to process stream record:", result.reason)
    }
  }
}
```

- [ ] **Step 3: Create scripts/build-lambda.sh**

Create `scripts/build-lambda.sh`:

```bash
#!/bin/bash
# Build and zip the leaderboard-updater Lambda function.
# Run from the BugHunt repo root.
# Output: lambda.zip in repo root

set -e

LAMBDA_DIR="lambda/leaderboard-updater"
ZIP_FILE="lambda.zip"

echo "Installing Lambda dependencies..."
cd "$LAMBDA_DIR"
npm install

echo "Compiling TypeScript..."
npm run build

echo "Zipping dist/ + node_modules/..."
cd dist
zip -r "../../../${ZIP_FILE}" . ../node_modules
cd ../../..

echo "Lambda package ready: ${ZIP_FILE}"
echo "Deploy with: aws lambda update-function-code --function-name bughunt-leaderboard-updater --zip-file fileb://${ZIP_FILE}"
```

- [ ] **Step 4: Create scripts/create-lambda.sh**

Create `scripts/create-lambda.sh`:

```bash
#!/bin/bash
# Create the Lambda function and wire it to the DynamoDB Stream.
# Prerequisites:
#   - Lambda.zip built via scripts/build-lambda.sh
#   - IAM role exists: arn:aws:iam::ACCOUNT_ID:role/bughunt-lambda-role
#     with policies: AWSLambdaDynamoDBExecutionRole + dynamodb:PutItem/DeleteItem/GetItem on bughunt-main
#   - ACCOUNT_ID and STREAM_ARN set as environment variables
#
# Usage:
#   ACCOUNT_ID=123456789012 STREAM_ARN=arn:aws:dynamodb:... bash scripts/create-lambda.sh

set -e

REGION="${AWS_REGION:-us-east-1}"
FUNCTION_NAME="bughunt-leaderboard-updater"
ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/bughunt-lambda-role"
ZIP_FILE="lambda.zip"

if [ -z "$ACCOUNT_ID" ]; then
  echo "Error: ACCOUNT_ID env var is required"
  exit 1
fi

if [ -z "$STREAM_ARN" ]; then
  echo "Error: STREAM_ARN env var is required (get from: aws dynamodb describe-table --table-name bughunt-main | jq '.Table.LatestStreamArn')"
  exit 1
fi

echo "Creating Lambda function ${FUNCTION_NAME}..."
aws lambda create-function \
  --function-name "$FUNCTION_NAME" \
  --runtime nodejs22.x \
  --handler index.handler \
  --role "$ROLE_ARN" \
  --zip-file "fileb://${ZIP_FILE}" \
  --timeout 30 \
  --memory-size 256 \
  --environment "Variables={DYNAMODB_TABLE_NAME=bughunt-main,AWS_REGION=${REGION}}" \
  --region "$REGION"

echo "Creating DynamoDB Stream event source mapping..."
aws lambda create-event-source-mapping \
  --function-name "$FUNCTION_NAME" \
  --event-source-arn "$STREAM_ARN" \
  --starting-position LATEST \
  --batch-size 10 \
  --bisect-batch-on-function-error \
  --filter-criteria '{"Filters":[{"Pattern":"{\"dynamodb\":{\"NewImage\":{\"status\":{\"S\":[\"completed\"]},\"sk\":{\"S\":[\"META\"]}}}}"}]}' \
  --region "$REGION"

echo ""
echo "Lambda setup complete."
echo "Check Lambda logs with:"
echo "  aws logs tail /aws/lambda/${FUNCTION_NAME} --follow"
```

- [ ] **Step 5: Make scripts executable**

```bash
chmod +x /home/sorour/BugHunt/scripts/build-lambda.sh /home/sorour/BugHunt/scripts/create-lambda.sh
```

- [ ] **Step 6: Commit**

```bash
cd /home/sorour/BugHunt && git add lambda/ scripts/build-lambda.sh scripts/create-lambda.sh && git commit -m "feat: add DynamoDB Streams Lambda for async leaderboard updates"
```

---

## Task 7: Remove leaderboard writes from resolveGame

**Files:**
- Modify: `src/lib/game.ts`

### Background

With the Lambda handling leaderboard updates asynchronously, `resolveGame` no longer needs to call `updateLeaderboardEntry` or `updateSeasonLeaderboardEntry`. Leaderboard updates will arrive within 1-2 seconds of game completion via the stream trigger.

What stays in `resolveGame`:
- Game META status update
- Player profile updates (elo, rank, gamesPlayed, gamesWon, streaks, achievements)
- Match history writes (both timestamp and direct-lookup items)
- GSI marker cleanup
- `markBugServed`
- `publishGameEvent` (added in Task 4)

What is removed:
- `updateLeaderboardEntry(game.player1Id, ...)` call (~line 421)
- `updateLeaderboardEntry(game.player2Id, ...)` call (~line 427)
- `updateSeasonLeaderboardEntry(...)` calls (~lines 434-443)
- The entire `updateLeaderboardEntry` helper function (~lines 481-507)
- The entire `updateSeasonLeaderboardEntry` helper function (~lines 509-537)
- The `getCurrentSeason` import and call (if no longer used elsewhere in the file)

Check if `getCurrentSeason` is used anywhere else in `game.ts` before removing the import. If it is not used after removing the leaderboard code, remove the import too.

- [ ] **Step 1: Remove leaderboard writes from resolveGame**

In `src/lib/game.ts`, delete the following block (the two `updateLeaderboardEntry` calls and the season block):

```typescript
  // ---------------------------------------------------------------------------
  // Update leaderboard items
  // ---------------------------------------------------------------------------
  // Remove old leaderboard entry and add new one for player1
  await updateLeaderboardEntry(game.player1Id, p1EloBefore, p1EloAfter, p1Profile.displayName, p1Profile.avatar, p1NewGamesPlayed, p1NewGamesWon)

  if (game.player2Id && p2Profile) {
    const p2Won = winnerId === game.player2Id
    const p2NewGamesPlayed = p2Profile.gamesPlayed + 1
    const p2NewGamesWon = p2Profile.gamesWon + (p2Won ? 1 : 0)
    await updateLeaderboardEntry(game.player2Id, p2EloBefore, p2EloAfter, p2Profile.displayName, p2Profile.avatar, p2NewGamesPlayed, p2NewGamesWon)
  }

  // ---------------------------------------------------------------------------
  // Update season leaderboard items (if an active season exists)
  // ---------------------------------------------------------------------------
  const activeSeason = await getCurrentSeason()
  if (activeSeason) {
    const seasonPk = `LEADERBOARD#SEASON#${activeSeason.seasonId}`
    await updateSeasonLeaderboardEntry(seasonPk, game.player1Id, p1EloBefore, p1EloAfter, p1Profile.displayName, p1Profile.avatar, p1NewGamesPlayed, p1NewGamesWon)

    if (game.player2Id && p2Profile) {
      const p2Won = winnerId === game.player2Id
      const p2NewGamesPlayed = p2Profile.gamesPlayed + 1
      const p2NewGamesWon = p2Profile.gamesWon + (p2Won ? 1 : 0)
      await updateSeasonLeaderboardEntry(seasonPk, game.player2Id, p2EloBefore, p2EloAfter, p2Profile.displayName, p2Profile.avatar, p2NewGamesPlayed, p2NewGamesWon)
    }
  }
```

Then delete the two helper functions `updateLeaderboardEntry` and `updateSeasonLeaderboardEntry` (and the `zeroPad` helper if it's only used by them — check if `zeroPad` is referenced elsewhere in the file).

Also remove the `getCurrentSeason` import line if it's no longer used:

```typescript
import { getCurrentSeason } from "@/lib/seasons"
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /home/sorour/BugHunt && npx tsc --noEmit
```

Expected: no errors. If TypeScript complains about `zeroPad` being undefined, also remove that helper (it's only used by the leaderboard functions).

- [ ] **Step 3: Run unit tests to confirm game resolution logic is intact**

```bash
cd /home/sorour/BugHunt && npm run test:unit
```

Expected: all tests pass. The `game-resolution.test.ts` test specifically validates resolveGame logic.

- [ ] **Step 4: Commit**

```bash
cd /home/sorour/BugHunt && git add src/lib/game.ts && git commit -m "refactor: remove synchronous leaderboard writes from resolveGame (now async via Lambda)"
```

---

## Task 8: 3-region Global Tables

**Files:**
- Modify: `scripts/enable-global-tables.sh`
- Modify: `src/lib/dynamodb.ts`

### Background

The existing `scripts/enable-global-tables.sh` adds one replica (`eu-west-1`). We add a second replica (`ap-southeast-1`) as a separate `aws dynamodb update-table` call — you cannot add two replicas in the same call.

In `src/lib/dynamodb.ts`, the current DynamoDB client uses `process.env.AWS_REGION ?? "us-east-1"`. Vercel sets `process.env.VERCEL_REGION` to a string like `"iad1"` (US East), `"cdg1"` (Paris), `"sin1"` (Singapore). We map these to the closest DynamoDB region. The mapping is:

| VERCEL_REGION prefix | DynamoDB region |
|---|---|
| `iad` | `us-east-1` |
| `sfo` | `us-west-2` |
| `cdg`, `lhr`, `ams`, `fra` | `eu-west-1` |
| `sin`, `hnd`, `icn`, `bom` | `ap-southeast-1` |

Fall back to `process.env.AWS_REGION ?? "us-east-1"` when `VERCEL_REGION` is not set (local dev, non-Vercel deploys).

- [ ] **Step 1: Update scripts/enable-global-tables.sh**

Replace the content of `scripts/enable-global-tables.sh`:

```bash
#!/bin/bash
# Enable DynamoDB Global Tables for bughunt-main — 3 regions
# Run this ONCE after the table is created and populated.
# Each region must be added in a separate update-table call.
# Requires AWS CLI configured with appropriate permissions.

REGION="${AWS_REGION:-us-east-1}"
TABLE="bughunt-main"

echo "Enabling Global Tables replication for $TABLE..."
echo "Source region: $REGION"

echo ""
echo "Adding replica: eu-west-1 (Ireland)..."
aws dynamodb update-table \
  --table-name "$TABLE" \
  --replica-updates "[{\"Create\":{\"RegionName\":\"eu-west-1\"}}]" \
  --region "$REGION"

echo ""
echo "Waiting 30s before adding second replica (AWS requires sequential replica adds)..."
sleep 30

echo "Adding replica: ap-southeast-1 (Singapore)..."
aws dynamodb update-table \
  --table-name "$TABLE" \
  --replica-updates "[{\"Create\":{\"RegionName\":\"ap-southeast-1\"}}]" \
  --region "$REGION"

echo ""
echo "Replication initiated. It may take 30-60 minutes per region to fully propagate."
echo "Check status with:"
echo "  aws dynamodb describe-table --table-name $TABLE --region $REGION | jq '.Table.Replicas'"
```

- [ ] **Step 2: Update src/lib/dynamodb.ts to select closest region**

In `src/lib/dynamodb.ts`, replace the current client instantiation:

```typescript
const client = new DynamoDBClient({
  region: process.env.AWS_REGION ?? "us-east-1",
});
```

with:

```typescript
/**
 * Select the closest DynamoDB region based on Vercel deployment region.
 * Falls back to AWS_REGION or us-east-1 when not running on Vercel.
 *
 * Vercel region codes: https://vercel.com/docs/edge-network/regions
 * Global Table replicas: us-east-1, eu-west-1, ap-southeast-1
 */
function selectDynamoDBRegion(): string {
  const vercelRegion = process.env.VERCEL_REGION ?? ""
  if (vercelRegion.startsWith("cdg") ||
      vercelRegion.startsWith("lhr") ||
      vercelRegion.startsWith("ams") ||
      vercelRegion.startsWith("fra")) {
    return "eu-west-1"
  }
  if (vercelRegion.startsWith("sin") ||
      vercelRegion.startsWith("hnd") ||
      vercelRegion.startsWith("icn") ||
      vercelRegion.startsWith("bom")) {
    return "ap-southeast-1"
  }
  return process.env.AWS_REGION ?? "us-east-1"
}

const client = new DynamoDBClient({
  region: selectDynamoDBRegion(),
});
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /home/sorour/BugHunt && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd /home/sorour/BugHunt && git add scripts/enable-global-tables.sh src/lib/dynamodb.ts && git commit -m "feat: add ap-southeast-1 Global Table replica and VERCEL_REGION-aware DynamoDB client"
```

---

## Task 9: Environment variables + .env.local.example update

**Files:**
- Modify: `.env.local.example`

### Background

Three new variables are needed:
- `UPSTASH_REDIS_REST_URL` — the HTTPS REST endpoint from Upstash console
- `UPSTASH_REDIS_REST_TOKEN` — the REST token from Upstash console
- `CRON_SECRET` — a secret for authenticating cron job requests (used by future specs; include now so developers know to set it)

- [ ] **Step 1: Update .env.local.example**

Replace the contents of `.env.local.example`:

```bash
# AWS
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=

# NextAuth
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=

# OAuth
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=

# Admin
ADMIN_EMAILS=

# DynamoDB
DYNAMODB_TABLE_NAME=bughunt-main

# Upstash Redis (get from https://console.upstash.com)
UPSTASH_REDIS_REST_URL=https://your-instance.upstash.io
UPSTASH_REDIS_REST_TOKEN=your-rest-token-here

# Cron job secret (set a random string, used to authenticate /api/cron/* routes)
CRON_SECRET=
```

- [ ] **Step 2: Commit**

```bash
cd /home/sorour/BugHunt && git add .env.local.example && git commit -m "chore: add UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN, CRON_SECRET to env example"
```

---

## Task 10: Update load test

**Files:**
- Modify: `scripts/load-test.yml`

### Background

The current load test targets `http://localhost:3000` and tests unauthenticated endpoints. Update to:
1. Target Vercel production (configurable via `TARGET_URL` env var)
2. Increase matchmake load to test Redis-backed endpoint at 1000 concurrent
3. Add notes on what to measure

- [ ] **Step 1: Update scripts/load-test.yml**

Replace the contents of `scripts/load-test.yml`:

```yaml
# BugHunt load test — validates Redis-backed matchmaking at scale
# Run with: TARGET_URL=https://your-app.vercel.app npx artillery run scripts/load-test.yml
# Or locally: npx artillery run scripts/load-test.yml
#
# Metrics to capture (before/after Redis migration):
#   - p95 latency on POST /api/game/matchmake
#   - DynamoDB ConsumedCapacityUnits (AWS Console → DynamoDB → Metrics)
#   - Redis throughput (Upstash Console → Database → Commands/sec)

config:
  target: "{{ $env.TARGET_URL | default('http://localhost:3000') }}"
  phases:
    - duration: 30
      arrivalRate: 10
      name: "Warm up"
    - duration: 120
      arrivalRate: 100
      name: "Sustained load (100 req/s)"
    - duration: 60
      arrivalRate: 500
      name: "Spike — Redis queue stress (500 req/s)"
    - duration: 60
      arrivalRate: 1000
      name: "Peak — 1000 concurrent matchmake attempts"
  defaults:
    headers:
      Content-Type: "application/json"

scenarios:
  - name: "Matchmake flow (Redis-backed)"
    weight: 70
    flow:
      - post:
          url: "/api/game/matchmake"
          json:
            userId: "load-test-user-{{ $randomNumber(1, 10000) }}"
          expect:
            - statusCode:
                - 200
                - 401
                - 429

  - name: "Leaderboard read"
    weight: 20
    flow:
      - get:
          url: "/api/leaderboard"
          expect:
            - statusCode: 200

  - name: "Bug random"
    weight: 10
    flow:
      - get:
          url: "/api/bugs/random"
          expect:
            - statusCode: 200
```

- [ ] **Step 2: Commit**

```bash
cd /home/sorour/BugHunt && git add scripts/load-test.yml && git commit -m "chore: update load test for Redis-backed matchmaking at 1000 concurrent"
```

---

## Self-Review Checklist

### Spec Coverage

| Spec section | Covered by |
|---|---|
| §1 Upstash Redis client + queue | Task 1 |
| §1 Migration from DynamoDB queue | Task 2 |
| §1 Rate limiting | Task 2 (rateLimitCheck in matchmake) |
| §1 Daily challenge cache | Task 1 (getDailyChallengeBugId/setDailyChallengeBugId) |
| §2 SSE stream endpoint | Task 3 |
| §2 Client EventSource | Task 5 |
| §2 Publisher in submit | Task 4 |
| §2 Publisher in resolveGame | Task 4 |
| §3 Lambda handler | Task 6 |
| §3 create-lambda.sh | Task 6 |
| §3 Remove leaderboard from resolveGame | Task 7 |
| §4 3-region Global Tables | Task 8 |
| §4 VERCEL_REGION routing | Task 8 |
| §5 Load test update | Task 10 |
| Env vars | Task 9 |

### Type Consistency Check

- `GameEvent` defined in `src/lib/redis.ts` Task 1: `player_submitted { userId, correct, timeElapsedMs }` and `game_resolved { winnerId, p1EloAfter, p2EloAfter }`
- `publishGameEvent` called in Task 4 with matching shapes: `{ type: "player_submitted", userId, correct, timeElapsedMs }` and `{ type: "game_resolved", winnerId, p1EloAfter, p2EloAfter }` ✓
- SSE client in Task 5 reads `data.type` and `data.userId` — both present in the published events ✓
- Lambda in Task 6 reads `NewImage.player1Id?.S`, `NewImage.player2Id?.S`, `NewImage.winnerId?.S` — matches DynamoDB item fields written in `createGame` ✓
- `rateLimitCheck` signature in Task 1 test: `(redis, userId, action, maxRequests, windowSeconds)` — real export in redis.ts: `(userId, action, maxRequests, windowSeconds)` ✓ (mock version takes extra `redis` arg for injection; real version uses module-level singleton)
- `enqueuePlayer`, `findMatch`, `dequeuePlayer` signatures match between test file, redis.ts, and matchmake route ✓
