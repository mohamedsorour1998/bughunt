# Spec 1 — Scale Infrastructure

**Goal:** Replace all polling and synchronous leaderboard writes with event-driven, push-based infrastructure that demonstrably scales to 1M concurrent users.

**Why this comes first:** Every other spec depends on Redis (queue, pub/sub, rate limiting) and SSE (real-time game updates). Streaming + Lambda are the foundation the Community and Platform specs build on.

---

## 1. Upstash Redis Integration

### What
Replace DynamoDB as the matchmaking queue and add pub/sub for real-time game event fan-out. Use Upstash Redis (serverless, HTTP-based, works in Vercel Edge/Serverless without persistent connections).

### Package
```
npm install @upstash/redis
```

### Environment variables
```
UPSTASH_REDIS_REST_URL=https://...upstash.io
UPSTASH_REDIS_REST_TOKEN=...
```

### New file: `src/lib/redis.ts`
- Singleton `Redis` client from `@upstash/redis`
- **Matchmaking queue** — Redis SORTED SET per Elo range:
  - Key: `queue:{eloRange}` (e.g. `queue:1200`)
  - Score: Unix timestamp (FIFO within range)
  - Value: `userId`
  - Operations: `zadd` to enqueue, `zrangebyscore` to find ±200 Elo matches, `zrem` to dequeue
  - TTL: `expire queue:{range} 300` (5 min auto-expire entire range if idle)
- **Pub/Sub for game events** — Redis channel per game:
  - Channel: `game:{gameId}`
  - Published events: `{ type: "player_submitted", userId, correct, timeElapsedMs }` and `{ type: "game_resolved", winnerId, p1Elo, p2Elo }`
  - Subscribers: SSE connections (see §2)
- **Rate limiting** — sliding window in Redis:
  - Key: `ratelimit:{userId}:{action}:{windowStart}`
  - INCR + EXPIRE, O(1), no DynamoDB reads
- **Daily challenge cache**:
  - Key: `daily_challenge:{YYYY-MM-DD}`
  - Value: bugId, expires at midnight UTC

### Migration from DynamoDB queue
- Remove all `MATCH#QUEUE#*` DynamoDB writes in `src/app/api/game/matchmake/route.ts`
- Replace with Redis SORTED SET operations
- Keep DynamoDB GSI1 active-game check (this is correct — Redis is for the ephemeral queue only)

### Scale justification (for blog + architecture diagram)
- DynamoDB queue scan: O(N items in queue) — at 1M users = millions of reads/s
- Redis SORTED SET lookup: O(log N) — constant time regardless of queue depth
- Upstash serverless: HTTP-based, no persistent connection pool, safe in Vercel Functions

---

## 2. Server-Sent Events (SSE) — Real-Time Game Updates

### What
Replace 3-second polling in `/api/game/status` with a push-based SSE stream. The client opens one long-lived connection; the server pushes events when the game state changes.

### Scale justification
At 1M concurrent games: polling generates 1M × (1/3s) = **333,333 req/s** to `/api/game/status`. SSE replaces this with 1M persistent connections but **zero request overhead** — Vercel handles long-lived streaming natively.

### New route: `GET /api/game/stream?gameId=`
```typescript
// src/app/api/game/stream/route.ts
export const runtime = "nodejs"  // SSE requires Node runtime, not Edge

export async function GET(req: Request) {
  // auth check
  // validate gameId
  // subscribe to Redis channel game:{gameId}
  
  const stream = new ReadableStream({
    start(controller) {
      // Subscribe to Redis pub/sub
      // On event: controller.enqueue(`data: ${JSON.stringify(event)}\n\n`)
      // On game_resolved: controller.close()
      // On client disconnect: unsubscribe
    },
    cancel() {
      // unsubscribe from Redis
    }
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

### Client changes in `src/app/(game)/play/page.tsx`
- On entering "playing" state: `const es = new EventSource('/api/game/stream?gameId=X')`
- Handle events: `es.onmessage = (e) => { const data = JSON.parse(e.data); ... }`
- On `game_resolved`: redirect to result page
- On `player_submitted`: show "Opponent submitted!" indicator
- Cleanup: `es.close()` on unmount or game completion
- Keep polling as **fallback** if EventSource fails (feature-detect + graceful degradation)

### Publisher
In `src/lib/game.ts resolveGame`: after updating DynamoDB, publish to Redis:
```typescript
await redis.publish(`game:${gameId}`, JSON.stringify({ type: "game_resolved", winnerId, ... }))
```
In `POST /api/game/submit`: after writing player record:
```typescript
await redis.publish(`game:${gameId}`, JSON.stringify({ type: "player_submitted", userId, correct }))
```

---

## 3. DynamoDB Streams + Lambda — Async Leaderboard

### What
Remove synchronous leaderboard updates from `resolveGame`. Instead, DynamoDB Streams detects every completed game write and triggers a Lambda function that updates the leaderboard atomically.

### Why
Currently `resolveGame` does 6+ DynamoDB writes synchronously (profiles, leaderboard, history). At scale this is a latency bottleneck. Streams + Lambda makes it async and retry-safe.

### Architecture
```
GAME#<id> META updated (status=completed)
  → DynamoDB Stream (NEW_IMAGE filter)
    → Lambda bughunt-leaderboard-updater
      → updateItem LEADERBOARD#GLOBAL
      → updateItem LEADERBOARD#SEASON#1
      → updateItem LEADERBOARD#TOURNAMENT#<id> (if applicable)
```

### Lambda: `lambda/leaderboard-updater/index.ts`
- Triggered by DynamoDB Stream on `bughunt-main`
- Filter: only process records where `status.S = "completed"` and `sk.S = "META"`
- Reads player profiles for both players
- Writes leaderboard entries for global + active season + active tournament
- Idempotent: uses conditional write with `elo` check to prevent duplicate processing

### Infrastructure: `scripts/create-lambda.sh`
```bash
# Create Lambda function
aws lambda create-function \
  --function-name bughunt-leaderboard-updater \
  --runtime nodejs22.x \
  --handler index.handler \
  --role arn:aws:iam::ACCOUNT:role/bughunt-lambda-role \
  --zip-file fileb://lambda.zip

# Add DynamoDB Stream trigger
aws lambda create-event-source-mapping \
  --function-name bughunt-leaderboard-updater \
  --event-source-arn <STREAM_ARN> \
  --starting-position LATEST \
  --filter-criteria '{"Filters":[{"Pattern":"{\"dynamodb\":{\"NewImage\":{\"status\":{\"S\":[\"completed\"]}}}}"}]}'
```

### IAM role required
- `dynamodb:GetRecords`, `dynamodb:GetShardIterator`, `dynamodb:DescribeStream` on stream
- `dynamodb:UpdateItem`, `dynamodb:PutItem` on `bughunt-main`

### Changes to resolveGame
- Remove all leaderboard write calls
- Keep: user profile updates, match history writes, Elo computation
- Leaderboard is now eventually consistent (acceptable — updates within 1-2s)

---

## 4. DynamoDB Global Tables — 3 Regions

### What
Extend `scripts/enable-global-tables.sh` to add `ap-southeast-1` (Singapore) in addition to `eu-west-1` (Ireland).

### Updated `scripts/enable-global-tables.sh`
```bash
# Add eu-west-1
aws dynamodb update-table \
  --table-name bughunt-main \
  --replica-updates "[{\"Create\":{\"RegionName\":\"eu-west-1\"}}]" \
  --region us-east-1

# Add ap-southeast-1
aws dynamodb update-table \
  --table-name bughunt-main \
  --replica-updates "[{\"Create\":{\"RegionName\":\"ap-southeast-1\"}}]" \
  --region us-east-1
```

### Vercel deployment
Add `DYNAMODB_REGION` env var per Vercel deployment region:
- US deployments: `us-east-1`
- EU deployments: `eu-west-1`
- Asia deployments: `ap-southeast-1`

Use `process.env.VERCEL_REGION` to auto-select the closest DynamoDB region at runtime.

### Scale justification
- Active-active: reads AND writes in every region — no cross-region latency for 66% of global users
- Conflict resolution: DynamoDB uses last-writer-wins (LWW) — acceptable for game state

---

## 5. Load Test Update

Update `scripts/load-test.yml` to:
- Target Vercel production URL (not localhost)
- Test Redis-backed matchmaking endpoint at 1000 concurrent
- Measure p95 latency before/after Redis migration
- Capture DynamoDB metrics screenshot from AWS console

---

## DynamoDB Schema additions
None — all Redis data is ephemeral. Lambda reads/writes existing DynamoDB entities.

## Files created/modified
| File | Change |
|---|---|
| `src/lib/redis.ts` | New — Upstash client + queue + pub/sub + rate limit helpers |
| `src/app/api/game/stream/route.ts` | New — SSE endpoint |
| `src/app/api/game/matchmake/route.ts` | Replace DynamoDB queue with Redis SORTED SET |
| `src/app/api/game/submit/route.ts` | Add Redis publish after submit |
| `src/lib/game.ts` | Add Redis publish in resolveGame, remove leaderboard writes |
| `src/app/(game)/play/page.tsx` | Replace polling with EventSource, polling as fallback |
| `lambda/leaderboard-updater/index.ts` | New Lambda function |
| `scripts/create-lambda.sh` | New — Lambda setup script |
| `scripts/enable-global-tables.sh` | Updated — add ap-southeast-1 |
| `scripts/load-test.yml` | Updated — Redis-backed endpoints |
