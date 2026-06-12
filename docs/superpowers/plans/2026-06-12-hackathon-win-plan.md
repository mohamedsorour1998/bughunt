# Hackathon Win Plan — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take BugHunt from "strong submission" to "#1 on H0 Track 3" by 2026-06-30: fix the broken leaderboard Streams pipeline, add a server-side bot opponent (demo insurance + cold-start fix), close the design gap, harden + document the million-scale story with evidence, and produce all submission artifacts.

**Architecture:** All work stays inside the existing Next.js 16 App Router + DynamoDB single-table + Upstash Redis stack (no new services except the already-scaffolded Streams Lambda). The bot opponent uses **lazy evaluation**: the human's own polling requests drive the bot's turns, so no background workers are needed — serverless-idiomatic and a judging talking point. The leaderboard fix moves Elo audit fields onto the game META item so the DynamoDB Streams Lambda becomes deterministic and idempotent.

**Tech Stack:** Next.js 16.2 (App Router), TypeScript, DynamoDB (single-table `bughunt-main`, Streams, Global Tables, TTL), AWS Lambda (leaderboard updater), Upstash Redis, Amazon Bedrock Nova (`amazon.nova-lite-v1:0`), Tailwind v4 + base-ui, node:test + tsx for tests, Playwright for E2E.

---

## Context the executor MUST know before starting

1. **Read `CLAUDE.md` first** — especially the "Conditional-Write Patterns" section. Plain `updateItem`/`putItem` is forbidden for contended state.
2. **Auth in routes:** every route resolves the session as
   `(await safeAuth()) ?? getTestSession(req) ?? await getTestSessionFromCookies()`. New/modified routes must keep this or API tests break.
3. **Unit tests** (`src/lib/__tests__/*.test.ts`) are plain tsx assertion scripts (a local `test(name, fn)` helper, `console.log("✓", …)`, `process.exit(1)` on failure) — NOT node:test. **API tests** (`tests/api/*.test.ts`) use `node:test` + real DynamoDB and import route handlers directly; they require `TEST_MODE=true` and a seeded table (`npm run db:seed`).
4. **Commits go to `main`** (solo hackathon repo, that's the established history). Commit after every task with the message given in the task.
5. AWS CLI + credentials are assumed configured for ops tasks (Streams, Lambda, Global Tables). Ops tasks that touch live AWS are marked **[OPS]** — run them exactly as written and paste outputs into the task log.
6. The deadline rhythm: Phases 0–2 by Jun 15, Phase 3 by Jun 20, Phase 4 by Jun 24, Phase 5 by Jun 27. Submit Jun 28.
7. **Environment variables added by this plan** (document in `.env.example`, set in Vercel):
   - `BOT_MATCH_AFTER_MS` (default `10000`) — queue wait before a bot match.
   - `BOT_THINK_MIN_MS` (default `8000`) / `BOT_THINK_SPAN_MS` (default `17000`) — bot answer delay window.
   - `BOT_USE_BEDROCK` (default unset/false) — when `"true"`, the bot asks Nova to pick its answer.

## File map (created/modified by this plan)

| File | Action | Task |
|---|---|---|
| `WhatsApp Image 2026-06-11 at 3.51.35 PM.jpeg` | delete | 1 |
| `.env.example` | create | 1 |
| `README.md` | modify (copy + diagram + claims) | 1, 19, 22 |
| `src/lib/game.ts` | modify (`resolveGame` final update) | 2 |
| `tests/api/resolve.test.ts` | create | 2 |
| `lambda/leaderboard-updater/index.ts` | rewrite | 3 |
| `lambda/leaderboard-updater/index.test.ts` | create | 3 |
| `lambda/leaderboard-updater/package.json` | modify (test script, tsx devDep) | 3 |
| `scripts/create-table.ts` | modify (StreamSpecification) | 4 |
| `scripts/enable-streams.sh` | create | 4 |
| `scripts/rebuild-leaderboard.ts` | create | 5 |
| `src/lib/bot.ts` | create | 6 |
| `src/lib/__tests__/bot.test.ts` | create | 6 |
| `package.json` | modify (test scripts) | 6, 7 |
| `src/lib/redis.ts` | modify (queue-joined helpers) | 7 |
| `src/app/api/game/matchmake/route.ts` | modify (bot fallback) | 7 |
| `src/app/api/game/cancel/route.ts` | modify (clear queue-joined) | 7 |
| `tests/api/bot.test.ts` | create | 7–8 |
| `src/app/api/game/status/route.ts` | modify (bot hook) | 8 |
| `src/app/api/game/submit/route.ts` | modify (bot hook) | 8 |
| `src/app/api/game/stream/route.ts` | modify (bot hook in poll tick) | 8 |
| `src/lib/bedrock.ts` | modify (novaPickAnswer) | 9 |
| `src/components/game/MatchmakingOverlay.tsx` | modify (elapsed copy) | 10 |
| `src/components/game/DuelHeader.tsx` | create | 11 |
| `src/app/(game)/play/page.tsx` | modify (duel UI, verdict flash, timeout) | 11–12 |
| `src/components/landing/BugTeaser.tsx` | create | 13 |
| `src/app/page.tsx` | modify (teaser section + lib import) | 13, 15 |
| `src/components/game/GameResult.tsx` | modify (rank-up + banner animation) | 14 |
| `src/lib/leaderboard.ts` | create | 15 |
| `src/app/api/leaderboard/route.ts` | modify (thin wrapper) | 15 |
| `src/app/(social)/leaderboard/page.tsx` | modify (import) | 15 |
| `src/components/leaderboard/LeaderboardTabs.tsx` | modify (type import) | 15 |
| `src/app/share/result/[gameId]/page.tsx` | create (optional) | 16 |
| `src/app/api/og/result/route.tsx` | create (optional) | 16 |
| `docs/ARCHITECTURE.md` | create | 17 |
| `src/lib/bugs.ts` | modify (index size guard) | 18 |
| `docs/loadtest/` | create (results) | 20 |
| `docs/architecture.mmd` | create | 22 |
| `docs/demo-video-script.md` | create | 23 |
| `docs/blog-builder-aws.md` | create | 24 |
| `docs/devpost.md` | create | 25 |

---

## Phase 0 — Repo hygiene (Jun 12)

### Task 1: Clean the public repo surface

**Files:**
- Delete: `WhatsApp Image 2026-06-11 at 3.51.35 PM.jpeg`
- Create: `.env.example`
- Modify: `README.md:9-13`

- [ ] **Step 1: Delete the stray photo**

Run: `rm "/home/sorour/BugHunt/WhatsApp Image 2026-06-11 at 3.51.35 PM.jpeg"`
Expected: file gone; `git status` no longer lists it.

- [ ] **Step 2: Create `.env.example`**

```bash
# --- AWS (DynamoDB + Bedrock) ---
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=

# --- NextAuth ---
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=            # openssl rand -base64 32

# --- OAuth providers ---
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=

# --- App ---
ADMIN_EMAILS=               # comma-separated, gates /admin
DYNAMODB_TABLE_NAME=bughunt-main
CRON_SECRET=                # Bearer token for /api/cron/*
BEDROCK_REGION=us-east-1

# --- Upstash Redis ---
REDIS_URL=                  # rediss://... (TLS/TCP URL)
UPSTASH_REDIS_REST_URL=     # https://...upstash.io
UPSTASH_REDIS_REST_TOKEN=

# --- Bot opponent (optional overrides) ---
# BOT_MATCH_AFTER_MS=10000
# BOT_THINK_MIN_MS=8000
# BOT_THINK_SPAN_MS=17000
# BOT_USE_BEDROCK=true
```

- [ ] **Step 3: Fix the README game description (it says first-to-find wins; the game is 3 rounds, correctness then total-time tiebreak)**

In `README.md`, replace:

```markdown
BugHunt is a competitive debugging platform — chess.com, but for finding bugs. Two players are matched
and shown the same buggy code snippet; the first to correctly identify the bug wins Elo points. Beyond
```

with:

```markdown
BugHunt is a competitive debugging platform — chess.com, but for finding bugs. Two players are matched
and race through the same 3 buggy code snippets (one per round, 120s each); most correct answers wins,
with total time as the tiebreak, and the winner takes Elo points. Beyond
```

- [ ] **Step 4: Verify no secrets are tracked**

Run: `git -C /home/sorour/BugHunt log --all -p -- .env .env.local 2>/dev/null | head -5 && grep -rEn "AKIA[0-9A-Z]{16}" /home/sorour/BugHunt/src /home/sorour/BugHunt/scripts /home/sorour/BugHunt/lambda || echo "CLEAN"`
Expected: `CLEAN` (no output from the greps).

- [ ] **Step 5: Commit**

```bash
git add .env.example README.md
git commit -m "chore: repo hygiene — .env.example, accurate game description, remove stray image"
```

---

## Phase 1 — Leaderboard pipeline correctness (Jun 12–13)

**Why first:** the global leaderboard (landing page + /leaderboard) only updates via the DynamoDB Streams Lambda, which (a) may not be wired in prod because `create-table.ts` never enabled Streams, and (b) has a deterministic bug — it reads `p1EloBefore` off the game META item, but `resolveGame` never writes it, so stale `RANK#` rows are never deleted and players duplicate on the board. This is the flagship "deliberate data model" component; it must be flawless.

### Task 2: `resolveGame` stamps Elo audit fields and removes GSI attrs atomically

**Files:**
- Modify: `src/lib/game.ts:684-711` (the "Remove active-game GSI markers" block inside `resolveGame`)
- Test: `tests/api/resolve.test.ts` (create)

The current code **deletes META then re-puts it** — a crash between the two loses the game record forever, and it emits REMOVE+INSERT stream events instead of MODIFY. Replace with one `UpdateCommand` that (1) strips `gsi1pk`/`gsi1sk`, (2) stamps `p1EloBefore/p1EloAfter/p2EloBefore/p2EloAfter` for the Streams Lambda, (3) sets `currentRound` to the final value. Because this runs **after** both `updateUser` calls, the stream event that carries the Elo fields fires only when profiles are already current — eliminating the Lambda's read race.

- [ ] **Step 1: Write the failing test**

Create `tests/api/resolve.test.ts`:

```typescript
import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { DynamoDBClient } from "@aws-sdk/client-dynamodb"
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb"
import {
  seedTestUsers, cleanupTestUsers, seedTestGame, cleanupTestGame,
  seedGamePlayerAnswers, getFirstNActiveBugIds,
} from "../helpers/db"
import { TEST_USER_1, TEST_USER_2, TABLE_NAME } from "../helpers/fixtures"
import { resolveGame } from "../../src/lib/game"

if (process.env.TEST_MODE !== "true") throw new Error("TEST_MODE=true required")

const client = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: process.env.AWS_REGION ?? "us-east-1" }),
  { marshallOptions: { removeUndefinedValues: true } }
)

const GAME_ID = `test-resolve-elo-${Date.now()}`

before(async () => {
  await seedTestUsers()
  const bugIds = await getFirstNActiveBugIds(3)
  await seedTestGame(GAME_ID, TEST_USER_1.userId, TEST_USER_2.userId, bugIds, "active")
  const now = Date.now()
  // Player 1 sweeps all rounds; player 2 misses all — deterministic winner.
  await seedGamePlayerAnswers(GAME_ID, TEST_USER_1.userId,
    bugIds.map((bugId) => ({ bugId, answer: 0, correct: true, submittedAt: now, timeElapsedMs: 5000 })))
  await seedGamePlayerAnswers(GAME_ID, TEST_USER_2.userId,
    bugIds.map((bugId) => ({ bugId, answer: 1, correct: false, submittedAt: now, timeElapsedMs: 9000 })))
})

after(async () => {
  await cleanupTestGame(GAME_ID)
  await cleanupTestUsers()
})

test("resolveGame stamps Elo audit fields on META and keeps the record", async () => {
  await resolveGame(GAME_ID)

  const res = await client.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: { pk: `GAME#${GAME_ID}`, sk: "META" },
  }))
  const meta = res.Item
  assert.ok(meta, "META record must still exist after resolution (no delete window)")
  assert.equal(meta.status, "completed")
  assert.equal(meta.winnerId, TEST_USER_1.userId)
  assert.equal(typeof meta.p1EloBefore, "number", "p1EloBefore stamped for Streams Lambda")
  assert.equal(typeof meta.p1EloAfter, "number", "p1EloAfter stamped for Streams Lambda")
  assert.equal(typeof meta.p2EloBefore, "number", "p2EloBefore stamped for Streams Lambda")
  assert.equal(typeof meta.p2EloAfter, "number", "p2EloAfter stamped for Streams Lambda")
  assert.ok((meta.p1EloAfter as number) > (meta.p1EloBefore as number), "winner gains Elo")
  assert.equal(meta.gsi1pk, undefined, "GSI attrs removed so completed game leaves active index")
  assert.equal(meta.gsi1sk, undefined, "GSI attrs removed so completed game leaves active index")
})
```

- [ ] **Step 2: Run it to confirm it fails on the new assertions**

Run: `TEST_MODE=true npx tsx --tsconfig tsconfig.test.json --test tests/api/resolve.test.ts`
Expected: FAIL on `p1EloBefore stamped for Streams Lambda` (field is `undefined` today).

- [ ] **Step 3: Implement — replace the delete+reput block in `resolveGame`**

In `src/lib/game.ts`, find this block (near the end of `resolveGame`):

```typescript
  // ---------------------------------------------------------------------------
  // Remove active-game GSI markers
  // ---------------------------------------------------------------------------
  await deleteItem(`GAME#${gameId}`, "META").catch(() => {/* ignore if already gone */})
  // Re-write META without gsi1pk/gsi1sk
  await putItem({
    pk: `GAME#${gameId}`,
    sk: "META",
    gameId,
    player1Id: game.player1Id,
    player2Id: game.player2Id,
    bugIds: game.bugIds,
    bugId: game.bugId,
    currentRound: ROUNDS_PER_GAME,
    roundStartedAt: game.roundStartedAt,
    status: "completed",
    winnerId,
    createdAt: game.createdAt,
    expiresAt: game.expiresAt,
    isPrivate: game.isPrivate,
    affectsElo: game.affectsElo,
    // No gsi1pk / gsi1sk — completed game should not appear in active queries
  })
```

Replace it with:

```typescript
  // ---------------------------------------------------------------------------
  // Finalize META in ONE atomic update: strip the active-game GSI attrs and
  // stamp the Elo audit fields. Running this AFTER updateUser means the
  // resulting stream event is the signal that profiles are already current —
  // the leaderboard Lambda keys off p1EloAfter's presence.
  // ---------------------------------------------------------------------------
  await ddb.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { pk: `GAME#${gameId}`, sk: "META" },
      UpdateExpression:
        "SET currentRound = :rounds, p1EloBefore = :p1b, p1EloAfter = :p1a, p2EloBefore = :p2b, p2EloAfter = :p2a REMOVE gsi1pk, gsi1sk",
      ExpressionAttributeValues: {
        ":rounds": ROUNDS_PER_GAME,
        ":p1b": p1EloBefore,
        ":p1a": p1EloAfter,
        ":p2b": p2EloBefore,
        ":p2a": p2EloAfter,
      },
    })
  )
```

Also remove the now-unused imports if any (`deleteItem` is still used elsewhere in the file for the ACTIVE_PLAYER delete — keep it; `putItem` is still used for history writes — keep it).

- [ ] **Step 4: Run the test to verify it passes**

Run: `TEST_MODE=true npx tsx --tsconfig tsconfig.test.json --test tests/api/resolve.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Run the existing game API tests to confirm no regression**

Run: `TEST_MODE=true npx tsx --tsconfig tsconfig.test.json --test tests/api/game.test.ts && TEST_MODE=true npx tsx --tsconfig tsconfig.test.json --test tests/api/rematch.test.ts`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/game.ts tests/api/resolve.test.ts
git commit -m "fix: resolveGame finalizes META atomically and stamps Elo audit fields for the Streams Lambda"
```

### Task 3: Rewrite the leaderboard Lambda — deterministic, idempotent, bot/private-aware

**Files:**
- Rewrite: `lambda/leaderboard-updater/index.ts`
- Create: `lambda/leaderboard-updater/index.test.ts`
- Modify: `lambda/leaderboard-updater/package.json`

Changes vs current: (1) only process MODIFY events whose NewImage carries `p1EloAfter` (the final resolve update from Task 2), (2) take Elo before/after from the **NewImage** instead of guessing from profiles, (3) skip private games (`affectsElo === false`) and bot players (`bot-` prefix), (4) make `aws-lambda` / `AttributeValue` imports type-only so tsx can run the file without the (nonexistent at runtime) `aws-lambda` package.

- [ ] **Step 1: Write the failing predicate test**

Create `lambda/leaderboard-updater/index.test.ts`:

```typescript
// Plain tsx assertion script (matches src/lib/__tests__ style).
import { shouldProcessImage } from "./index"

function test(name: string, fn: () => void) {
  try {
    fn()
    console.log("✓", name)
  } catch (e) {
    console.error("✗", name, e)
    process.exit(1)
  }
}

function expect(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg)
}

const base = { sk: "META", status: "completed", p1EloAfter: 1216, p1EloBefore: 1200, affectsElo: true }

test("processes the final resolve update (META + completed + p1EloAfter)", () => {
  expect(shouldProcessImage(base) === true, "should process")
})

test("skips non-META items", () => {
  expect(shouldProcessImage({ ...base, sk: "PLAYER#u1" }) === false, "should skip")
})

test("skips non-completed status", () => {
  expect(shouldProcessImage({ ...base, status: "active" }) === false, "should skip")
})

test("skips the early status-flip update that lacks Elo fields", () => {
  const { p1EloAfter: _omit, ...withoutElo } = base
  expect(shouldProcessImage(withoutElo) === false, "should skip until p1EloAfter present")
})

test("skips private games (affectsElo=false)", () => {
  expect(shouldProcessImage({ ...base, affectsElo: false }) === false, "should skip private")
})

console.log("All leaderboard-lambda predicate tests passed!")
```

- [ ] **Step 2: Rewrite `lambda/leaderboard-updater/index.ts` (full file)**

```typescript
/**
 * DynamoDB Streams Lambda: async leaderboard materializer.
 *
 * resolveGame finishes by stamping p1EloBefore/p1EloAfter/p2EloBefore/p2EloAfter
 * onto the game META item (after player profiles are updated). That MODIFY
 * event — and only that one — is processed here: for each human player we
 * delete the RANK# row at their old Elo and write the row at their new Elo
 * under LEADERBOARD#GLOBAL and LEADERBOARD#SEASON#1.
 *
 * Idempotent: re-processing the same event deletes a row that's already gone
 * and conditionally re-puts an identical row.
 */
import type { DynamoDBStreamEvent, DynamoDBStreamHandler } from "aws-lambda"
import { DynamoDBClient } from "@aws-sdk/client-dynamodb"
import type { AttributeValue } from "@aws-sdk/client-dynamodb"
import {
  DynamoDBDocumentClient,
  GetCommand,
  DeleteCommand,
  PutCommand,
} from "@aws-sdk/lib-dynamodb"
import { unmarshall } from "@aws-sdk/util-dynamodb"

const TABLE_NAME = process.env.DYNAMODB_TABLE_NAME ?? "bughunt-main"
const LEADERBOARDS = ["LEADERBOARD#GLOBAL", "LEADERBOARD#SEASON#1"]

const client = new DynamoDBClient({})
const ddb = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
})

// ---------------------------------------------------------------------------
// Predicate (exported for unit tests)
// ---------------------------------------------------------------------------

export function shouldProcessImage(img: Record<string, unknown>): boolean {
  if (img.sk !== "META") return false
  if (img.status !== "completed") return false
  if (img.affectsElo === false) return false // private games don't touch boards
  if (typeof img.p1EloAfter !== "number") return false // only the final resolve update
  return true
}

function isBot(userId: string): boolean {
  return userId.startsWith("bot-")
}

function zeroPad(n: number): string {
  return String(n).padStart(6, "0")
}

// ---------------------------------------------------------------------------
// Profile lookup (display fields only — Elo comes from the stream image)
// ---------------------------------------------------------------------------

interface DisplayProfile {
  displayName: string
  avatar: string | null
  gamesPlayed: number
  gamesWon: number
}

async function getDisplayProfile(userId: string): Promise<DisplayProfile | null> {
  const result = await ddb.send(
    new GetCommand({ TableName: TABLE_NAME, Key: { pk: `USER#${userId}`, sk: "PROFILE" } })
  )
  if (!result.Item) return null
  const item = result.Item as Record<string, unknown>
  return {
    displayName: (item.displayName as string) ?? "Unknown",
    avatar: (item.avatar as string | null) ?? null,
    gamesPlayed: (item.gamesPlayed as number) ?? 0,
    gamesWon: (item.gamesWon as number) ?? 0,
  }
}

// ---------------------------------------------------------------------------
// Rank row maintenance
// ---------------------------------------------------------------------------

async function moveRankRow(
  board: string,
  userId: string,
  oldElo: number,
  newElo: number,
  profile: DisplayProfile
): Promise<void> {
  if (oldElo !== newElo) {
    await ddb
      .send(
        new DeleteCommand({
          TableName: TABLE_NAME,
          Key: { pk: board, sk: `RANK#${zeroPad(oldElo)}#${userId}` },
        })
      )
      .catch(() => {/* already gone — idempotent */})
  }

  try {
    await ddb.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          pk: board,
          sk: `RANK#${zeroPad(newElo)}#${userId}`,
          userId,
          elo: newElo,
          displayName: profile.displayName,
          avatar: profile.avatar,
          gamesPlayed: profile.gamesPlayed,
          gamesWon: profile.gamesWon,
          updatedAt: Date.now(),
        },
        // Same sk always carries the same Elo, so <= makes re-puts idempotent.
        ConditionExpression: "attribute_not_exists(sk) OR #elo <= :newElo",
        ExpressionAttributeNames: { "#elo": "elo" },
        ExpressionAttributeValues: { ":newElo": newElo },
      })
    )
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "ConditionalCheckFailedException") return
    throw err
  }
}

// ---------------------------------------------------------------------------
// Record processor
// ---------------------------------------------------------------------------

async function processRecord(record: DynamoDBStreamEvent["Records"][0]): Promise<void> {
  if (record.eventName !== "MODIFY") return
  if (!record.dynamodb?.NewImage) return

  const img = unmarshall(
    record.dynamodb.NewImage as Record<string, AttributeValue>
  ) as Record<string, unknown>

  if (!shouldProcessImage(img)) return

  const players: Array<{ userId: string; eloBefore: number; eloAfter: number }> = []

  const p1 = img.player1Id as string
  if (p1 && !isBot(p1)) {
    players.push({
      userId: p1,
      eloBefore: (img.p1EloBefore as number) ?? (img.p1EloAfter as number),
      eloAfter: img.p1EloAfter as number,
    })
  }

  const p2 = img.player2Id as string | null
  if (p2 && !isBot(p2) && typeof img.p2EloAfter === "number") {
    players.push({
      userId: p2,
      eloBefore: (img.p2EloBefore as number) ?? (img.p2EloAfter as number),
      eloAfter: img.p2EloAfter as number,
    })
  }

  for (const player of players) {
    const profile = await getDisplayProfile(player.userId)
    if (!profile) continue
    for (const board of LEADERBOARDS) {
      await moveRankRow(board, player.userId, player.eloBefore, player.eloAfter, profile)
    }
  }
}

// ---------------------------------------------------------------------------
// Lambda handler
// ---------------------------------------------------------------------------

export const handler: DynamoDBStreamHandler = async (event) => {
  const results = await Promise.allSettled(event.Records.map((r) => processRecord(r)))
  for (const result of results) {
    if (result.status === "rejected") {
      console.error("Failed to process record:", result.reason)
    }
  }
}
```

- [ ] **Step 3: Add the test script + tsx devDependency to the Lambda package**

In `lambda/leaderboard-updater/package.json`, replace the `"scripts"` block and `"devDependencies"`:

```json
  "scripts": {
    "build": "npx tsc --outDir dist --module commonjs --target es2020 --esModuleInterop true --strict true index.ts",
    "test": "npx tsx index.test.ts"
  },
```

```json
  "devDependencies": {
    "@types/aws-lambda": "^8.10.145",
    "tsx": "^4.22.3",
    "typescript": "^5.0.0"
  }
```

- [ ] **Step 4: Install lambda deps and run the test**

Run: `cd /home/sorour/BugHunt/lambda/leaderboard-updater && npm install && npm test`
Expected: `All leaderboard-lambda predicate tests passed!`

- [ ] **Step 5: Verify the Lambda still compiles**

Run: `cd /home/sorour/BugHunt/lambda/leaderboard-updater && npm run build`
Expected: exits 0, `dist/index.js` exists.

- [ ] **Step 6: Wire lambda tests into the root unit suite**

In root `package.json`, change the `test:unit` script — append the lambda test at the end:

```json
    "test:unit": "npx tsx src/lib/__tests__/elo.test.ts && npx tsx src/lib/__tests__/rank.test.ts && npx tsx src/lib/__tests__/bugs-logic.test.ts && npx tsx src/lib/__tests__/seasons-logic.test.ts && npx tsx src/lib/__tests__/game-resolution.test.ts && npx tsx src/lib/__tests__/redis-helpers.test.ts && npm --prefix lambda/leaderboard-updater run test",
```

Run: `npm run test:unit`
Expected: all suites pass, ending with the lambda predicate tests.

- [ ] **Step 7: Commit**

```bash
git add lambda/leaderboard-updater package.json
git commit -m "fix: leaderboard Lambda reads Elo from stream image — kills stale duplicate RANK rows, skips bots/private games"
```

### Task 4: [OPS] Enable DynamoDB Streams and deploy the Lambda

**Files:**
- Modify: `scripts/create-table.ts` (StreamSpecification for fresh tables)
- Create: `scripts/enable-streams.sh` (for the existing prod table)

- [ ] **Step 1: Add StreamSpecification to `create-table.ts`**

In `scripts/create-table.ts`, inside the `params: CreateTableCommandInput` object, add after the `BillingMode` line:

```typescript
    // DynamoDB Streams feed the leaderboard-updater Lambda
    StreamSpecification: {
      StreamEnabled: true,
      StreamViewType: "NEW_AND_OLD_IMAGES",
    },
```

- [ ] **Step 2: Create `scripts/enable-streams.sh`**

```bash
#!/bin/bash
# Enable DynamoDB Streams (NEW_AND_OLD_IMAGES) on the existing table — required
# by the leaderboard-updater Lambda. Idempotent.
set -euo pipefail
REGION="${AWS_REGION:-us-east-1}"
TABLE="${DYNAMODB_TABLE_NAME:-bughunt-main}"

CURRENT=$(aws dynamodb describe-table --table-name "$TABLE" --region "$REGION" \
  --query "Table.StreamSpecification.StreamEnabled" --output text 2>/dev/null || echo "None")

if [[ "$CURRENT" == "True" ]]; then
  echo "Streams already enabled on $TABLE."
else
  aws dynamodb update-table \
    --table-name "$TABLE" \
    --stream-specification StreamEnabled=true,StreamViewType=NEW_AND_OLD_IMAGES \
    --region "$REGION" >/dev/null
  echo "Streams enabled on $TABLE."
fi

echo -n "Stream ARN: "
aws dynamodb describe-table --table-name "$TABLE" --region "$REGION" \
  --query "Table.LatestStreamArn" --output text
```

Run: `chmod +x /home/sorour/BugHunt/scripts/enable-streams.sh`

- [ ] **Step 3: [OPS] Enable streams on the live table**

Run: `./scripts/enable-streams.sh`
Expected: prints `Streams enabled on bughunt-main.` (or "already enabled") and a Stream ARN like `arn:aws:dynamodb:us-east-1:…:table/bughunt-main/stream/2026-06-…`.

- [ ] **Step 4: [OPS] Build and deploy the Lambda**

Run, in order (requires an IAM role ARN with `AWSLambdaDynamoDBExecutionRole` + table read/write — create one in the IAM console first if `LAMBDA_ROLE_ARN` is unset):

```bash
./scripts/build-lambda.sh
LAMBDA_ROLE_ARN=arn:aws:iam::<ACCOUNT_ID>:role/bughunt-lambda-role ./scripts/create-lambda.sh
```

Expected: `Done. Lambda bughunt-leaderboard-updater is wired to DynamoDB Streams on bughunt-main.`

- [ ] **Step 5: [OPS] Verify the event source mapping is live**

Run: `aws lambda list-event-source-mappings --function-name bughunt-leaderboard-updater --region us-east-1 --query "EventSourceMappings[].State" --output text`
Expected: `Enabled`

- [ ] **Step 6: Commit**

```bash
git add scripts/create-table.ts scripts/enable-streams.sh
git commit -m "feat: enable DynamoDB Streams in table setup + idempotent enable-streams script"
```

### Task 5: [OPS] Rebuild the leaderboard from profiles (clears historical duplicates)

**Files:**
- Create: `scripts/rebuild-leaderboard.ts`

- [ ] **Step 1: Create `scripts/rebuild-leaderboard.ts`**

```typescript
/**
 * One-shot ops script: wipe all RANK# rows under LEADERBOARD#GLOBAL and
 * LEADERBOARD#SEASON#1, then rebuild them from current USER#…/PROFILE items.
 * Run after deploying the fixed Streams Lambda, or whenever the boards drift.
 *
 *   npx tsx scripts/rebuild-leaderboard.ts
 */
import { DynamoDBClient } from "@aws-sdk/client-dynamodb"
import {
  DynamoDBDocumentClient, ScanCommand, QueryCommand, DeleteCommand, PutCommand,
} from "@aws-sdk/lib-dynamodb"

const TABLE = process.env.DYNAMODB_TABLE_NAME ?? "bughunt-main"
const ddb = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: process.env.AWS_REGION ?? "us-east-1" }),
  { marshallOptions: { removeUndefinedValues: true } }
)
const BOARDS = ["LEADERBOARD#GLOBAL", "LEADERBOARD#SEASON#1"]
const zeroPad = (n: number) => String(n).padStart(6, "0")

async function wipeBoard(pk: string): Promise<number> {
  let removed = 0
  let lastKey: Record<string, unknown> | undefined
  do {
    const res = await ddb.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: { ":pk": pk },
      ExclusiveStartKey: lastKey,
    }))
    for (const item of res.Items ?? []) {
      await ddb.send(new DeleteCommand({ TableName: TABLE, Key: { pk, sk: item.sk as string } }))
      removed++
    }
    lastKey = res.LastEvaluatedKey
  } while (lastKey)
  return removed
}

async function main() {
  for (const board of BOARDS) {
    console.log(`wiped ${await wipeBoard(board)} rows from ${board}`)
  }

  let lastKey: Record<string, unknown> | undefined
  let written = 0
  do {
    const res = await ddb.send(new ScanCommand({
      TableName: TABLE,
      FilterExpression: "sk = :profile AND attribute_exists(elo) AND gamesPlayed > :zero",
      ExpressionAttributeValues: { ":profile": "PROFILE", ":zero": 0 },
      ExclusiveStartKey: lastKey,
    }))
    for (const item of res.Items ?? []) {
      const userId = item.userId as string
      if (!userId || userId.startsWith("bot-") || userId.startsWith("test-")) continue
      for (const board of BOARDS) {
        await ddb.send(new PutCommand({
          TableName: TABLE,
          Item: {
            pk: board,
            sk: `RANK#${zeroPad(item.elo as number)}#${userId}`,
            userId,
            elo: item.elo,
            displayName: item.displayName,
            avatar: (item.avatar as string | null) ?? null,
            gamesPlayed: item.gamesPlayed,
            gamesWon: item.gamesWon,
            updatedAt: Date.now(),
          },
        }))
        written++
      }
    }
    lastKey = res.LastEvaluatedKey
  } while (lastKey)
  console.log(`wrote ${written} rank rows`)
}

main().catch((err) => { console.error(err); process.exit(1) })
```

- [ ] **Step 2: [OPS] Run it against the live table**

Run: `npx tsx scripts/rebuild-leaderboard.ts`
Expected: `wiped N rows…` then `wrote M rank rows` with no errors.

- [ ] **Step 3: [OPS] End-to-end pipeline verification (THE demo moment)**

1. Open the production site, note the leaderboard state.
2. Play one ranked game to completion (use a second browser profile, or — after Phase 2 lands — just wait 10s for a bot match).
3. Within ~5s, run:
   `aws dynamodb query --table-name bughunt-main --region us-east-1 --key-condition-expression "pk = :pk" --expression-attribute-values '{":pk":{"S":"LEADERBOARD#GLOBAL"}}' --query "Items[].sk.S" --output text | tr '\t' '\n' | tail -5`
   Expected: exactly one `RANK#` row per player, at their NEW Elo; the old-Elo row is gone.
4. Refresh the landing page — the Top Players table reflects the game.

- [ ] **Step 4: Commit**

```bash
git add scripts/rebuild-leaderboard.ts
git commit -m "feat: rebuild-leaderboard ops script — wipes stale RANK rows and rematerializes from profiles"
```

---

## Phase 2 — Bot opponent (Jun 13–15)

**Why:** A multiplayer demo with an empty queue is a dead demo. Judges will visit with one account and zero concurrent users. The bot (a) guarantees every visitor gets a match in ~10s, (b) guarantees the video demo cannot stall, (c) is an architecture story ("bots with no servers — the human's own polling powers the bot's turns"), and (d) with `BOT_USE_BEDROCK=true` becomes "you're playing against Amazon Nova."

**Design:** Bot users are normal `USER#bot-*` profiles (lazily created, `isBot: true`). Matchmake falls back to a bot when the caller has been queued ≥ `BOT_MATCH_AFTER_MS` (default 10s). The bot's answer for round R of game G is computed deterministically from `sha256(G:R)` — correct with probability derived from bot Elo vs bug difficulty, after a "thinking" delay of 8–25s — so any number of concurrent requests agree on what the bot does, and `submitRoundAnswer`'s conditional write makes double-submission impossible. Bot turns are driven lazily from three hooks the human already triggers: `GET /api/game/status`, `POST /api/game/submit`, and the SSE poll tick.

### Task 6: `src/lib/bot.ts` — bot core + unit tests

**Files:**
- Create: `src/lib/bot.ts`
- Create: `src/lib/__tests__/bot.test.ts`
- Modify: `package.json` (`test:unit`)

- [ ] **Step 1: Write the failing unit tests**

Create `src/lib/__tests__/bot.test.ts` (plain tsx assertion script — house style):

```typescript
// bot.test.ts — deterministic bot behavior
import {
  seededRandom, botDelayMs, botCorrectProbability, chooseBotAnswer, pickBotForElo, isBotUser, BOT_USERS,
} from "../bot"
import type { Bug } from "../bugs"

function test(name: string, fn: () => void) {
  try {
    fn()
    console.log("✓", name)
  } catch (e) {
    console.error("✗", name, e)
    process.exit(1)
  }
}

const fakeBug: Bug = {
  bugId: "b1", language: "python", category: "logic", difficulty: 3,
  buggyCode: "x", correctCode: "y", bugLine: 1,
  options: ["a", "b", "c", "d"], correctAnswer: 2,
  explanation: "", hint: "", timesServed: 0, source: "manual", status: "active", createdAt: 0,
}

test("seededRandom is deterministic and in [0,1)", () => {
  const a = seededRandom("game-1:0:correct")
  const b = seededRandom("game-1:0:correct")
  if (a !== b) throw new Error("not deterministic")
  if (a < 0 || a >= 1) throw new Error(`out of range: ${a}`)
  if (seededRandom("other") === a) throw new Error("different seeds should differ (overwhelmingly)")
})

test("botDelayMs respects env overrides and is deterministic", () => {
  process.env.BOT_THINK_MIN_MS = "0"
  process.env.BOT_THINK_SPAN_MS = "0"
  if (botDelayMs("g", 0) !== 0) throw new Error("expected 0 delay with zeroed env")
  delete process.env.BOT_THINK_MIN_MS
  delete process.env.BOT_THINK_SPAN_MS
  const d1 = botDelayMs("g", 0)
  const d2 = botDelayMs("g", 0)
  if (d1 !== d2) throw new Error("not deterministic")
  if (d1 < 8000 || d1 >= 25000) throw new Error(`delay out of range: ${d1}`)
})

test("botCorrectProbability is clamped to [0.2, 0.95] and monotonic in Elo", () => {
  const weak = botCorrectProbability(800, 5)
  const strong = botCorrectProbability(2200, 5)
  if (weak < 0.2 || strong > 0.95) throw new Error("clamp failed")
  if (strong <= weak) throw new Error("stronger bot must have higher probability")
})

test("chooseBotAnswer is deterministic and returns a valid option index", () => {
  const a1 = chooseBotAnswer(fakeBug, 1300, "game-x", 1)
  const a2 = chooseBotAnswer(fakeBug, 1300, "game-x", 1)
  if (a1 !== a2) throw new Error("not deterministic")
  if (a1 < 0 || a1 > 3) throw new Error(`invalid option: ${a1}`)
})

test("pickBotForElo picks the nearest bot", () => {
  const picked = pickBotForElo(1750)
  const best = [...BOT_USERS].sort((x, y) => Math.abs(x.elo - 1750) - Math.abs(y.elo - 1750))[0]
  if (picked.userId !== best.userId) throw new Error(`picked ${picked.userId}, expected ${best.userId}`)
})

test("isBotUser matches only the bot- prefix", () => {
  if (!isBotUser("bot-nova-dev")) throw new Error("should match")
  if (isBotUser("test-user-1")) throw new Error("should not match")
  if (isBotUser(null)) throw new Error("null should not match")
})

console.log("All bot tests passed!")
```

- [ ] **Step 2: Run to verify it fails (module doesn't exist)**

Run: `npx tsx src/lib/__tests__/bot.test.ts`
Expected: FAIL — `Cannot find module '../bot'`.

- [ ] **Step 3: Create `src/lib/bot.ts` (full file)**

```typescript
/**
 * Bot opponents — serverless lazy evaluation.
 *
 * There is no bot process. The human's own requests (status poll, submit,
 * SSE poll tick) call maybePlayBotRound(); when the bot's deterministic
 * "thinking" delay for the current round has elapsed, that request writes the
 * bot's answer via the same conditional submitRoundAnswer path humans use.
 * All randomness is seeded from sha256(gameId:round), so concurrent requests
 * agree on the bot's behavior and the conditional write dedupes the rest.
 */
import { createHash } from "crypto"
import { getGamePlayer, submitRoundAnswer, advanceOrResolveRound, type Game } from "@/lib/game"
import { getBug, type Bug } from "@/lib/bugs"
import { publishGameEvent } from "@/lib/redis"
import { putItemIfNotExists } from "@/lib/dynamodb"
import { getRankFromElo } from "@/lib/users"

export const BOT_USERS = [
  { userId: "bot-nova-junior", displayName: "Nova Junior", elo: 1000 },
  { userId: "bot-nova-dev", displayName: "Nova Dev", elo: 1300 },
  { userId: "bot-nova-staff", displayName: "Nova Staff", elo: 1700 },
] as const

export type BotUser = (typeof BOT_USERS)[number]

export function isBotUser(userId: string | null | undefined): boolean {
  return typeof userId === "string" && userId.startsWith("bot-")
}

export function pickBotForElo(elo: number): BotUser {
  let best: BotUser = BOT_USERS[0]
  for (const b of BOT_USERS) {
    if (Math.abs(b.elo - elo) < Math.abs(best.elo - elo)) best = b
  }
  return best
}

/** Deterministic [0,1) from a seed string. */
export function seededRandom(seed: string): number {
  const h = createHash("sha256").update(seed).digest()
  return h.readUInt32BE(0) / 0x1_0000_0000
}

/** Bot "thinking" delay for a round — 8–25s by default, env-overridable for tests. */
export function botDelayMs(gameId: string, roundIndex: number): number {
  const min = Number(process.env.BOT_THINK_MIN_MS ?? 8000)
  const span = Number(process.env.BOT_THINK_SPAN_MS ?? 17000)
  return min + Math.floor(seededRandom(`${gameId}:${roundIndex}:delay`) * span)
}

/**
 * Probability the bot answers correctly: Elo expectation against a notional
 * "bug Elo" of difficulty*400 (the same scale selectBugsForGame uses), clamped
 * so bots are never hopeless (0.2) nor perfect (0.95).
 */
export function botCorrectProbability(botElo: number, difficulty: number): number {
  const bugElo = difficulty * 400
  const expected = 1 / (1 + Math.pow(10, (bugElo - botElo) / 400))
  return Math.min(0.95, Math.max(0.2, expected))
}

export function chooseBotAnswer(bug: Bug, botElo: number, gameId: string, roundIndex: number): number {
  const pCorrect = botCorrectProbability(botElo, bug.difficulty)
  if (seededRandom(`${gameId}:${roundIndex}:correct`) < pCorrect) return bug.correctAnswer
  const wrong = [0, 1, 2, 3].filter((i) => i !== bug.correctAnswer)
  return wrong[Math.floor(seededRandom(`${gameId}:${roundIndex}:wrong`) * wrong.length)]
}

/** Decide the bot's answer — optionally asking Bedrock Nova (Task 9), falling back to the scripted model. */
export async function decideBotAnswer(bug: Bug, botElo: number, gameId: string, roundIndex: number): Promise<number> {
  return chooseBotAnswer(bug, botElo, gameId, roundIndex)
}

/** Create the bot's USER profile if missing (idempotent putItemIfNotExists). */
export async function ensureBotProfile(bot: BotUser): Promise<void> {
  await putItemIfNotExists({
    pk: `USER#${bot.userId}`,
    sk: "PROFILE",
    gsi2pk: `EMAIL#${bot.userId}@bots.bughunt.dev`,
    gsi2sk: bot.userId,
    userId: bot.userId,
    email: `${bot.userId}@bots.bughunt.dev`,
    displayName: bot.displayName,
    avatar: null,
    isBot: true,
    elo: bot.elo,
    rank: getRankFromElo(bot.elo),
    gamesPlayed: 0,
    gamesWon: 0,
    currentStreak: 0,
    bestStreak: 0,
    bugsSeen: [],
    achievementsUnlocked: [],
    streakShields: 0,
    createdAt: Date.now(),
  })
}

/**
 * Lazy bot driver. Returns true when the bot acted (callers should re-read
 * the game). Safe to call from any request at any frequency:
 * - no bot in this game → no-op
 * - thinking delay not yet elapsed → no-op
 * - already answered (or a concurrent request won the conditional write) → no-op
 */
export async function maybePlayBotRound(game: Game): Promise<boolean> {
  if (game.status !== "active") return false
  const botId = isBotUser(game.player1Id)
    ? game.player1Id
    : isBotUser(game.player2Id)
      ? game.player2Id!
      : null
  if (!botId) return false

  const round = game.currentRound
  const roundStartedAt = game.roundStartedAt[round] ?? game.createdAt
  const now = Date.now()
  if (now - roundStartedAt < botDelayMs(game.gameId, round)) return false

  const record = await getGamePlayer(game.gameId, botId)
  if (record?.answers?.[round]?.submittedAt != null) return false

  const bug = await getBug(game.bugIds[round])
  if (!bug) return false

  const botElo = BOT_USERS.find((b) => b.userId === botId)?.elo ?? 1200
  const answer = await decideBotAnswer(bug, botElo, game.gameId, round)

  const result = await submitRoundAnswer(game.gameId, botId, round, bug, answer, now, roundStartedAt)
  if (!result.written) return false

  publishGameEvent(game.gameId, {
    type: "player_submitted",
    userId: botId,
    roundIndex: round,
    correct: result.correct,
    timeElapsedMs: result.timeElapsedMs,
  }).catch(() => {/* Redis failure must not break bot play */})

  await advanceOrResolveRound(game.gameId)
  return true
}
```

- [ ] **Step 4: Run unit tests to verify they pass**

Run: `npx tsx src/lib/__tests__/bot.test.ts`
Expected: `All bot tests passed!`

- [ ] **Step 5: Register in `test:unit`**

In root `package.json`, `test:unit`: insert `npx tsx src/lib/__tests__/bot.test.ts && ` immediately before `npm --prefix lambda/leaderboard-updater run test`.

Run: `npm run test:unit`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/bot.ts src/lib/__tests__/bot.test.ts package.json
git commit -m "feat: bot core — deterministic seeded answers, Elo-calibrated accuracy, lazy round driver"
```

### Task 7: Matchmake bot fallback (+ queue-wait tracking)

**Files:**
- Modify: `src/lib/redis.ts` (add queue-joined helpers)
- Modify: `src/app/api/game/matchmake/route.ts`
- Modify: `src/app/api/game/cancel/route.ts`
- Test: `tests/api/bot.test.ts` (create — also covers Task 8)

Queue-wait tracking uses a separate `queue_joined:<userId>` key with `NX` so re-polls don't reset the clock (the zset score can't be used — `enqueuePlayer` re-zadds on every poll, which would overwrite the score; we deliberately do NOT change `enqueuePlayer`, so its existing unit-test mocks stay valid).

- [ ] **Step 1: Add helpers to `src/lib/redis.ts`** (append after `dequeuePlayer`):

```typescript
/**
 * Queue-wait clock for the bot fallback. Stored separately from the zset
 * (whose score is refreshed on every matchmake poll) under NX so the FIRST
 * enqueue time survives re-polls. EX 300 self-heals abandoned entries.
 */
export async function markQueueJoined(userId: string): Promise<void> {
  await redis.set(`queue_joined:${userId}`, Date.now(), { nx: true, ex: 300 })
}

export async function getQueueJoinedAt(userId: string): Promise<number | null> {
  const v = await redis.get<number>(`queue_joined:${userId}`)
  return v ?? null
}

export async function clearQueueJoined(userId: string): Promise<void> {
  await redis.del(`queue_joined:${userId}`)
}
```

- [ ] **Step 2: Rewrite `src/app/api/game/matchmake/route.ts` (full file)**

```typescript
import { NextResponse } from "next/server"
import { getUser, updateUser } from "@/lib/users"
import { getActiveGameForUser, createGame } from "@/lib/game"
import { selectBugsForGame } from "@/lib/bugs"
import { safeAuth, getTestSession, getTestSessionFromCookies } from "@/lib/test-auth"
import {
  enqueuePlayer, findAndClaimMatch, dequeuePlayer, rateLimitCheck,
  markQueueJoined, getQueueJoinedAt, clearQueueJoined,
} from "@/lib/redis"
import { pickBotForElo, ensureBotProfile } from "@/lib/bot"

export async function POST(req: Request) {
  const session = (await safeAuth()) ?? getTestSession(req) ?? await getTestSessionFromCookies()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const userId = session.user.id

  // Rate limit: 10 matchmake calls per minute
  const allowed = await rateLimitCheck(userId, "matchmake", 10, 60)
  if (!allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  // Check if user already has an active/waiting game
  const activeGame = await getActiveGameForUser(userId)
  if (activeGame) {
    // If still waiting, ensure we're in the Redis queue so opponents can find us
    if (activeGame.status === "waiting") {
      const userProfile = await getUser(userId)
      if (userProfile) await enqueuePlayer(userId, userProfile.elo).catch(() => {})
    }
    return NextResponse.json({ gameId: activeGame.gameId, status: activeGame.status })
  }

  const userProfile = await getUser(userId)
  if (!userProfile) {
    return NextResponse.json({ error: "User not found" }, { status: 404 })
  }

  const elo = userProfile.elo
  // Atomically claims the opponent (zrem) at selection time so two concurrent
  // matchmake calls can't both pick the same queued player.
  const opponentId = await findAndClaimMatch(userId, elo)

  if (opponentId) {
    const opponentProfile = await getUser(opponentId)
    const avgElo = Math.round((elo + (opponentProfile?.elo ?? elo)) / 2)
    const bugsForGame = await selectBugsForGame(
      avgElo,
      userProfile.bugsSeen,
      opponentProfile?.bugsSeen ?? []
    )

    if (!bugsForGame) {
      // Opponent was already claimed (removed from queue) — re-enqueue them
      // so they aren't stranded, then fall back to waiting ourselves.
      await enqueuePlayer(opponentId, opponentProfile?.elo ?? elo)
      await enqueuePlayer(userId, elo)
      await markQueueJoined(userId)
      return NextResponse.json({ status: "waiting", gameId: null })
    }

    const bugIds = bugsForGame.map((b) => b.bugId)

    // Opponent is already removed from the queue (claimed atomically above);
    // only we still need to be dequeued before creating the game.
    await dequeuePlayer(userId, elo)

    let game
    try {
      game = await createGame(userId, opponentId, bugIds)
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "ConditionalCheckFailedException") {
        // Opponent was already claimed/removed from the queue — re-enqueue
        // them too so they aren't stranded by this failed attempt.
        await enqueuePlayer(opponentId, opponentProfile?.elo ?? elo)
        await enqueuePlayer(userId, elo)
        await markQueueJoined(userId)
        return NextResponse.json({ status: "waiting", gameId: null })
      }
      throw err
    }

    await clearQueueJoined(userId)
    await clearQueueJoined(opponentId)

    // Update bugsSeen for both players
    await Promise.all([
      updateUser(userId, { bugsSeen: [...new Set([...userProfile.bugsSeen, ...bugIds])] }),
      opponentProfile
        ? updateUser(opponentId, { bugsSeen: [...new Set([...opponentProfile.bugsSeen, ...bugIds])] })
        : Promise.resolve(),
    ])

    return NextResponse.json({ gameId: game.gameId, status: "active" })
  }

  // No human opponent — stay queued, and track how long we've been waiting.
  await enqueuePlayer(userId, elo)
  await markQueueJoined(userId)

  // Bot fallback: if we've waited long enough, summon a Nova bot near our Elo.
  const botAfterMs = Number(process.env.BOT_MATCH_AFTER_MS ?? 10_000)
  const joinedAt = await getQueueJoinedAt(userId)
  const waitedMs = joinedAt != null ? Date.now() - joinedAt : 0

  if (waitedMs >= botAfterMs) {
    const bot = pickBotForElo(elo)
    await ensureBotProfile(bot)
    const bugsForGame = await selectBugsForGame(
      Math.round((elo + bot.elo) / 2),
      userProfile.bugsSeen,
      [] // bots replay bugs freely
    )
    if (bugsForGame) {
      const bugIds = bugsForGame.map((b) => b.bugId)
      await dequeuePlayer(userId, elo)
      await clearQueueJoined(userId)
      const game = await createGame(userId, bot.userId, bugIds)
      await updateUser(userId, { bugsSeen: [...new Set([...userProfile.bugsSeen, ...bugIds])] })
      return NextResponse.json({ gameId: game.gameId, status: "active", opponentIsBot: true })
    }
  }

  return NextResponse.json({ status: "waiting", gameId: null })
}
```

- [ ] **Step 3: Clear the queue-wait clock on cancel**

Run: `grep -n "dequeuePlayer" src/app/api/game/cancel/route.ts`
Expected: one import line and one call site. Then:
1. Add `clearQueueJoined` to the existing `from "@/lib/redis"` import list in that file.
2. Immediately after the `await dequeuePlayer(userId, …)` call, add:

```typescript
  await clearQueueJoined(userId).catch(() => {})
```

- [ ] **Step 4: Run existing matchmake-related tests (regression gate)**

Run: `TEST_MODE=true npx tsx --tsconfig tsconfig.test.json --test tests/api/game.test.ts`
Expected: all PASS (default 10s threshold means the first matchmake call still returns `waiting`, exactly as before).

- [ ] **Step 5: Commit**

```bash
git add src/lib/redis.ts src/app/api/game/matchmake/route.ts src/app/api/game/cancel/route.ts
git commit -m "feat: matchmake falls back to a Nova bot after 10s queue wait (NX queue-wait clock in Redis)"
```

### Task 8: Bot turn hooks in status / submit / SSE-stream + full-loop API test

**Files:**
- Modify: `src/app/api/game/status/route.ts`
- Modify: `src/app/api/game/submit/route.ts`
- Modify: `src/app/api/game/stream/route.ts`
- Test: `tests/api/bot.test.ts` (create)

- [ ] **Step 1: Write the failing end-to-end bot test**

Create `tests/api/bot.test.ts`:

```typescript
import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { NextRequest } from "next/server"
import { DynamoDBClient } from "@aws-sdk/client-dynamodb"
import { DynamoDBDocumentClient, GetCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb"
import { seedTestUsers, cleanupTestUsers, cleanupTestGame } from "../helpers/db"
import { TEST_USER_1, TABLE_NAME } from "../helpers/fixtures"
import { POST as matchmake } from "../../src/app/api/game/matchmake/route"
import { GET as getStatus } from "../../src/app/api/game/status/route"
import { POST as submit } from "../../src/app/api/game/submit/route"

if (process.env.TEST_MODE !== "true") throw new Error("TEST_MODE=true required")

// Zero out all bot timing so the whole loop runs synchronously.
// (Read at call time inside the routes/bot lib, so setting here is safe.)
process.env.BOT_MATCH_AFTER_MS = "0"
process.env.BOT_THINK_MIN_MS = "0"
process.env.BOT_THINK_SPAN_MS = "0"

const client = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: process.env.AWS_REGION ?? "us-east-1" }),
  { marshallOptions: { removeUndefinedValues: true } }
)

function postReq(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-test-user-id": TEST_USER_1.userId },
    body: JSON.stringify(body),
  })
}

let gameId = ""
let botId = ""

before(async () => {
  await seedTestUsers()
})

after(async () => {
  if (gameId) await cleanupTestGame(gameId)
  if (botId) {
    await client.send(new DeleteCommand({
      TableName: TABLE_NAME, Key: { pk: `USER#${botId}`, sk: "PROFILE" },
    })).catch(() => {})
  }
  await cleanupTestUsers()
})

test("matchmake falls back to a bot when the wait threshold has passed", async () => {
  const req = new Request("http://localhost/api/game/matchmake", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-test-user-id": TEST_USER_1.userId },
    body: "{}",
  })
  const res = await matchmake(req)
  assert.equal(res.status, 200)
  const body = await res.json() as { status: string; gameId: string | null; opponentIsBot?: boolean }
  assert.equal(body.status, "active", "threshold=0 → bot match on first call")
  assert.ok(body.gameId, "gameId returned")
  assert.equal(body.opponentIsBot, true)
  gameId = body.gameId!
})

test("the bot plays every round lazily and the game resolves", async () => {
  for (let i = 0; i < 4; i++) {
    // Status poll powers the (zero-delay) bot's turn for the current round
    const statusRes = await getStatus(new NextRequest(
      `http://localhost/api/game/status?gameId=${gameId}`,
      { headers: { "x-test-user-id": TEST_USER_1.userId } }
    ))
    assert.equal(statusRes.status, 200)
    const status = await statusRes.json() as {
      game: { currentRound: number; status: string; player1Id: string; player2Id: string }
    }
    botId = status.game.player2Id
    assert.ok(botId.startsWith("bot-"), "opponent is a bot")
    if (status.game.status === "completed") break

    const submitRes = await submit(postReq("http://localhost/api/game/submit", {
      gameId, roundIndex: status.game.currentRound, answer: 0,
    }))
    assert.ok([200, 409].includes(submitRes.status), `submit returned ${submitRes.status}`)
  }

  const finalRes = await getStatus(new NextRequest(
    `http://localhost/api/game/status?gameId=${gameId}`,
    { headers: { "x-test-user-id": TEST_USER_1.userId } }
  ))
  const final = await finalRes.json() as { game: { status: string } }
  assert.equal(final.game.status, "completed", "game resolves after 3 rounds vs bot")
})

test("resolution stamped Elo audit fields and bot profile exists with isBot", async () => {
  const meta = await client.send(new GetCommand({
    TableName: TABLE_NAME, Key: { pk: `GAME#${gameId}`, sk: "META" },
  }))
  assert.equal(typeof meta.Item?.p1EloAfter, "number", "Task 2 fields present on bot games too")

  const bot = await client.send(new GetCommand({
    TableName: TABLE_NAME, Key: { pk: `USER#${botId}`, sk: "PROFILE" },
  }))
  assert.equal(bot.Item?.isBot, true, "bot profile is flagged isBot")
})
```

- [ ] **Step 2: Run it — the first test passes (Task 7), the loop test fails (bot never answers)**

Run: `TEST_MODE=true npx tsx --tsconfig tsconfig.test.json --test tests/api/bot.test.ts`
Expected: FAIL on "the bot plays every round lazily…" (round never advances because no hook drives the bot yet).

- [ ] **Step 3: Hook the bot into `GET /api/game/status`**

In `src/app/api/game/status/route.ts`:
1. Add import: `import { maybePlayBotRound } from "@/lib/bot"`
2. Immediately **after** the existing "Auto-advance/resolve timed-out rounds" `if (game.status === "active") { … }` block, insert:

```typescript
  // Lazy bot driver — the human's own poll powers the bot's turn.
  if (game.status === "active") {
    const botActed = await maybePlayBotRound(game).catch(() => false)
    if (botActed) game = (await getGame(gameId)) ?? game
  }
```

- [ ] **Step 4: Hook the bot into `POST /api/game/submit`**

In `src/app/api/game/submit/route.ts`:
1. Add import: `import { maybePlayBotRound } from "@/lib/bot"`
2. After the existing `await advanceOrResolveRound(gameId)` line, insert:

```typescript
  // If the opponent is a bot whose think-delay has elapsed, let it take its
  // turn in this same request (covers the SSE-only client that never polls status).
  const updatedGame = await getGame(gameId)
  if (updatedGame) await maybePlayBotRound(updatedGame).catch(() => {})
```

- [ ] **Step 5: Hook the bot into the SSE poll tick**

In `src/app/api/game/stream/route.ts`, inside `startPolling()`'s `setInterval` callback, after `const g = await getGame(gameId); if (!g) return`, insert:

```typescript
            maybePlayBotRound(g).catch(() => {/* next tick will retry */})
```

and add the import `import { maybePlayBotRound } from "@/lib/bot"` at the top.

- [ ] **Step 6: Run the bot test to verify it passes**

Run: `TEST_MODE=true npx tsx --tsconfig tsconfig.test.json --test tests/api/bot.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Register in `test:api` and run the full API suite**

In root `package.json`, append to `test:api`:
`&& TEST_MODE=true npx tsx --tsconfig tsconfig.test.json --test tests/api/bot.test.ts && TEST_MODE=true npx tsx --tsconfig tsconfig.test.json --test tests/api/resolve.test.ts`

Run: `npm run test:api`
Expected: all suites pass.

**E2E note:** the Playwright matchmaking specs pair two browser contexts within <10s, so the default `BOT_MATCH_AFTER_MS=10000` does not interfere. If a pairing spec ever flakes on a slow machine, start the dev server with `BOT_MATCH_AFTER_MS=600000` for E2E runs.

- [ ] **Step 8: Commit**

```bash
git add src/app/api/game/status/route.ts src/app/api/game/submit/route.ts src/app/api/game/stream/route.ts tests/api/bot.test.ts package.json
git commit -m "feat: lazy bot turns driven by status/submit/SSE hooks — full bot match loop with tests"
```

### Task 9: (Optional, flag-gated) Bedrock Nova picks the bot's answers

**Files:**
- Modify: `src/lib/bedrock.ts` (add `novaPickAnswer`)
- Modify: `src/lib/bot.ts` (`decideBotAnswer` consults Nova when `BOT_USE_BEDROCK=true`)

Default OFF; latency-bounded with a 2.5s race and scripted fallback, so it can never stall a poll.

- [ ] **Step 1: Append to `src/lib/bedrock.ts`** (uses the same client + Nova invoke pattern as `generateBug`):

```typescript
/**
 * Ask Nova to play a round: pick which option describes the bug.
 * Returns null on any failure — callers must fall back to the scripted model.
 */
export async function novaPickAnswer(
  buggyCode: string,
  language: string,
  options: [string, string, string, string]
): Promise<0 | 1 | 2 | 3 | null> {
  const prompt = `You are playing a spot-the-bug quiz. Here is ${language} code with exactly ONE bug:

${buggyCode}

Which option describes the bug?
0: ${options[0]}
1: ${options[1]}
2: ${options[2]}
3: ${options[3]}

Reply with ONLY the single digit 0, 1, 2, or 3.`

  try {
    const body = JSON.stringify({
      messages: [{ role: "user", content: prompt }],
      inferenceConfig: { maxNewTokens: 5, temperature: 0.4 },
    })
    const command = new InvokeModelCommand({
      modelId: "amazon.nova-lite-v1:0",
      contentType: "application/json",
      accept: "application/json",
      body,
    })
    const response = await client.send(command)
    const parsed = JSON.parse(new TextDecoder().decode(response.body))
    const text: string =
      parsed?.output?.message?.content?.[0]?.text ?? parsed?.content?.[0]?.text ?? ""
    const m = text.match(/[0-3]/)
    if (!m) return null
    return Number(m[0]) as 0 | 1 | 2 | 3
  } catch (err) {
    console.error("[bedrock] novaPickAnswer failed:", err)
    return null
  }
}
```

- [ ] **Step 2: Replace `decideBotAnswer` in `src/lib/bot.ts`** with:

```typescript
/** Decide the bot's answer — Nova when BOT_USE_BEDROCK=true (2.5s budget), scripted model otherwise/fallback. */
export async function decideBotAnswer(bug: Bug, botElo: number, gameId: string, roundIndex: number): Promise<number> {
  if (process.env.BOT_USE_BEDROCK === "true") {
    const nova = await Promise.race([
      novaPickAnswer(bug.buggyCode, bug.language, bug.options),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 2500)),
    ])
    if (nova !== null) return nova
  }
  return chooseBotAnswer(bug, botElo, gameId, roundIndex)
}
```

and add the import `import { novaPickAnswer } from "@/lib/bedrock"`.

- [ ] **Step 3: Verify nothing breaks with the flag off (default)**

Run: `npx tsx src/lib/__tests__/bot.test.ts && TEST_MODE=true npx tsx --tsconfig tsconfig.test.json --test tests/api/bot.test.ts`
Expected: all PASS (flag unset → identical behavior to before).

- [ ] **Step 4: [OPS] Manual smoke with the flag on (needs Bedrock access)**

Run: `BOT_USE_BEDROCK=true TEST_MODE=true npx tsx --tsconfig tsconfig.test.json --test tests/api/bot.test.ts`
Expected: still PASS (Nova answers or falls back). If Bedrock access is missing, skip — the flag stays off.

- [ ] **Step 5: Commit**

```bash
git add src/lib/bedrock.ts src/lib/bot.ts
git commit -m "feat: BOT_USE_BEDROCK flag — Nova literally plays the bot's rounds, scripted fallback within 2.5s"
```

### Task 10: Matchmaking overlay tells the bot story

**Files:**
- Modify: `src/components/game/MatchmakingOverlay.tsx`

- [ ] **Step 1: Add an elapsed-seconds counter and swap the subtitle copy**

In `MatchmakingOverlay.tsx`:
1. Change the react import line to: `import { useEffect, useState } from "react"`
2. Inside the `MatchmakingOverlay` function body, before `return`, add:

```typescript
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setElapsed((e) => e + 1), 1000)
    return () => clearInterval(id)
  }, [])
```

3. Replace `<p className="text-sm text-white/50">Usually &lt; 30 seconds</p>` with:

```tsx
          <p className="text-sm text-white/50">
            {elapsed >= 8
              ? "No humans nearby — summoning a Nova bot…"
              : "Usually < 30 seconds"}
          </p>
```

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/game/MatchmakingOverlay.tsx
git commit -m "feat: matchmaking overlay announces the incoming Nova bot after 8s"
```

---

## Phase 3 — Design sprint (Jun 16–20)

**Why:** Design is the weakest judging criterion right now. The play screen must feel like a *duel* (opponent identity, round pips, live status), the landing page must let a judge play in 10 seconds without OAuth, and the result page should celebrate.

### Task 11: DuelHeader — opponent identity, round pips, live status

**Files:**
- Create: `src/components/game/DuelHeader.tsx`
- Modify: `src/app/(game)/play/page.tsx`

**E2E compatibility:** the strings `Opponent submitted!` and `Opponent thinking...` move from the play page into DuelHeader **verbatim** — run `grep -rn "Opponent submitted\|Opponent thinking\|waiting for opponent" tests/e2e/` first; if any spec asserts these strings, they keep passing because the strings are preserved exactly.

- [ ] **Step 1: Create `src/components/game/DuelHeader.tsx` (full file)**

```tsx
"use client"

import { cn } from "@/lib/utils"

export interface DuelPlayerInfo {
  displayName: string
  elo: number
  avatar: string | null
}

export type RoundOutcome = "correct" | "wrong" | "current" | "pending"

interface DuelHeaderProps {
  me: DuelPlayerInfo | null
  opponent: DuelPlayerInfo | null
  opponentIsBot: boolean
  currentRound: number
  roundsPerGame: number
  myRoundOutcomes: RoundOutcome[]
  opponentSubmittedRounds: Set<number>
}

function PlayerCard({
  player,
  align,
  fallbackLabel,
  isBot,
}: {
  player: DuelPlayerInfo | null
  align: "left" | "right"
  fallbackLabel: string
  isBot?: boolean
}) {
  const initial = player?.displayName?.charAt(0)?.toUpperCase() ?? "?"
  return (
    <div className={cn("flex min-w-0 items-center gap-3", align === "right" && "flex-row-reverse text-right")}>
      <div className="relative flex size-10 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/10 font-bold text-white">
        {player?.avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={player.avatar} alt="" className="size-10 rounded-full object-cover" />
        ) : (
          initial
        )}
        {isBot && (
          <span className="absolute -bottom-1 -right-1 rounded-full bg-violet-600 px-1 text-[9px] font-bold uppercase leading-3 text-white">
            AI
          </span>
        )}
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-white">
          {player?.displayName ?? fallbackLabel}
        </p>
        <p className="font-mono text-xs text-white/50">{player ? `${player.elo} Elo` : "…"}</p>
      </div>
    </div>
  )
}

function RoundPips({ outcomes }: { outcomes: RoundOutcome[] }) {
  return (
    <div className="flex items-center gap-2" aria-label="Your round results">
      {outcomes.map((o, i) => (
        <span
          key={i}
          className={cn(
            "flex size-6 items-center justify-center rounded-full border text-xs font-bold transition-colors",
            o === "correct" && "border-emerald-500 bg-emerald-500/20 text-emerald-300",
            o === "wrong" && "border-red-500 bg-red-500/20 text-red-300",
            o === "current" && "animate-pulse border-blue-400 bg-blue-500/20 text-blue-200",
            o === "pending" && "border-white/15 bg-white/5 text-white/30"
          )}
        >
          {o === "correct" ? "✓" : o === "wrong" ? "✗" : i + 1}
        </span>
      ))}
    </div>
  )
}

export function DuelHeader({
  me,
  opponent,
  opponentIsBot,
  currentRound,
  roundsPerGame,
  myRoundOutcomes,
  opponentSubmittedRounds,
}: DuelHeaderProps) {
  const opponentSubmitted = opponentSubmittedRounds.has(currentRound)
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <PlayerCard player={me} align="left" fallbackLabel="You" />
        <div className="flex shrink-0 flex-col items-center gap-0.5">
          <span className="font-mono text-[10px] uppercase tracking-widest text-white/30">
            Round {currentRound + 1}/{roundsPerGame}
          </span>
          <span className="text-lg font-black text-white/70">VS</span>
        </div>
        <PlayerCard player={opponent} align="right" fallbackLabel="Opponent" isBot={opponentIsBot} />
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <RoundPips outcomes={myRoundOutcomes} />
        <span
          className={cn(
            "text-xs transition-colors",
            opponentSubmitted ? "font-semibold text-emerald-300" : "text-white/40"
          )}
        >
          {opponentSubmitted ? "Opponent submitted!" : "Opponent thinking..."}
        </span>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Wire profiles + DuelHeader into the play page**

In `src/app/(game)/play/page.tsx`:

**(a)** Add imports (top of file, with the other component imports):

```typescript
import { DuelHeader, type DuelPlayerInfo, type RoundOutcome } from "@/components/game/DuelHeader"
import { cn } from "@/lib/utils"
```

**(b)** Add state, next to the existing `const [userElo, setUserElo] = useState<number>(1200)`:

```typescript
  const [myProfile, setMyProfile] = useState<DuelPlayerInfo | null>(null)
  const [opponentProfile, setOpponentProfile] = useState<DuelPlayerInfo | null>(null)
```

**(c)** Extend the existing profile-fetch effect — replace its `.then((data) => { … })` body:

```typescript
        .then((data) => {
          if (typeof data?.elo === "number") {
            setUserElo(data.elo)
          }
          if (data?.displayName) {
            setMyProfile({
              displayName: data.displayName as string,
              elo: (data.elo as number) ?? 1200,
              avatar: (data.avatar as string | null) ?? null,
            })
          }
        })
```

**(d)** Add the opponent-profile effect directly after that effect (before any early returns — hooks must stay unconditional):

```typescript
  // Fetch the opponent's public profile for the duel header
  const player1Id = gameData?.player1Id ?? null
  const player2Id = gameData?.player2Id ?? null
  useEffect(() => {
    const myId = session?.user?.id
    if (!myId || !player1Id) return
    const oppId = player1Id === myId ? player2Id : player1Id
    if (!oppId) return
    let cancelled = false
    fetch(`/api/user/profile/${oppId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((p) => {
        if (cancelled || !p) return
        setOpponentProfile({
          displayName: (p.displayName as string) ?? "Opponent",
          elo: (p.elo as number) ?? 1200,
          avatar: (p.avatar as string | null) ?? null,
        })
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [session?.user?.id, player1Id, player2Id])
```

**(e)** Replace the entire "Render: playing / submitting" block (from `if ((playState === "playing" || playState === "submitting") && gameData && bugData) {` through its closing `}` before the "Render: idle" comment) with:

```tsx
  if ((playState === "playing" || playState === "submitting") && gameData && bugData) {
    const currentRound = gameData.currentRound
    const hasSubmitted =
      roundAnswers[currentRound] !== undefined ||
      playerRecord?.answers?.[currentRound]?.submittedAt != null
    const isSubmitting = playState === "submitting"
    const answersDisabled = hasSubmitted || isSubmitting
    const roundStartedAt = gameData.roundStartedAt[currentRound] ?? gameData.createdAt

    const myId = session?.user?.id
    const oppId = gameData.player1Id === myId ? gameData.player2Id : gameData.player1Id
    const opponentIsBot = !!oppId && oppId.startsWith("bot-")

    const myRoundOutcomes: RoundOutcome[] = Array.from({ length: ROUNDS_PER_GAME }, (_, i) => {
      const local = roundAnswers[i]
      const record = playerRecord?.answers?.[i]
      const submitted = local !== undefined || record?.submittedAt != null
      if (submitted) return (local?.correct ?? record?.correct) ? "correct" : "wrong"
      return i === currentRound ? "current" : "pending"
    })

    const lastVerdict = roundAnswers[currentRound]

    return (
      <main className="min-h-screen px-4 py-6 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl space-y-6">
          {/* Duel header: players, round pips, opponent status */}
          <DuelHeader
            me={myProfile}
            opponent={opponentProfile}
            opponentIsBot={opponentIsBot}
            currentRound={currentRound}
            roundsPerGame={ROUNDS_PER_GAME}
            myRoundOutcomes={myRoundOutcomes}
            opponentSubmittedRounds={opponentSubmittedRounds}
          />

          {/* Meta row: language, difficulty, timer */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Badge variant="secondary" className="font-mono text-xs uppercase">
                {bugData.language}
              </Badge>
              <DifficultyStars difficulty={bugData.difficulty} />
            </div>
            <GameTimer
              key={currentRound}
              createdAt={roundStartedAt}
              onExpire={handleTimerExpire}
            />
          </div>

          {/* Error banner */}
          {error && (
            <div className="rounded-lg border border-red-500/40 bg-red-900/20 px-4 py-3 text-sm text-red-300">
              {error}
              <button
                className="ml-3 underline"
                onClick={() => setError(null)}
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Code viewer */}
          <CodeViewer
            code={bugData.buggyCode}
            language={bugData.language}
            bugLine={bugData.bugLine}
            revealed={false}
          />

          {/* Answer options + submitting indicator */}
          <div className="space-y-3">
            {isSubmitting && (
              <div className="flex items-center gap-2 text-sm text-white/50">
                <svg
                  className="size-4 animate-spin"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  aria-hidden="true"
                >
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
                Submitting...
              </div>
            )}

            <AnswerOptions
              options={bugData.options}
              selectedAnswer={selectedAnswer ?? playerRecord?.answers?.[currentRound]?.answer ?? undefined}
              disabled={answersDisabled}
              onAnswer={handleAnswer}
            />
          </div>

          {/* Post-submit verdict flash */}
          {hasSubmitted && !isSubmitting && (
            lastVerdict ? (
              <div
                className={cn(
                  "rounded-xl border px-4 py-3 text-center text-sm font-semibold animate-in fade-in slide-in-from-bottom-2 duration-300",
                  lastVerdict.correct
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                    : "border-red-500/40 bg-red-500/10 text-red-300"
                )}
              >
                {lastVerdict.correct ? "✓ Correct!" : "✗ Not quite."} Waiting for opponent...
              </div>
            ) : (
              <p className="text-center text-sm text-white/40">
                Answer submitted — waiting for opponent...
              </p>
            )
          )}
        </div>
      </main>
    )
  }
```

- [ ] **Step 3: Lint + build**

Run: `npm run lint && npm run build`
Expected: both succeed.

- [ ] **Step 4: Manual verify (with the bot!)**

Start `TEST_MODE=true npm run dev`, sign in via test cookie or OAuth, click Find Match, wait 10s for the bot. Confirm: opponent card shows "Nova …" with the AI badge, pips fill as you answer, "Opponent submitted!" lights up when the bot answers.

- [ ] **Step 5: Commit**

```bash
git add src/components/game/DuelHeader.tsx "src/app/(game)/play/page.tsx"
git commit -m "feat: duel header — opponent identity, round pips, live status, verdict flash"
```

### Task 12: Honest timeouts (stop auto-guessing option A)

**Files:**
- Modify: `src/app/(game)/play/page.tsx` (`handleTimerExpire`)

The current handler submits `selectedAnswer ?? 0` — an unselected timeout becomes a 25%-lucky guess of option A. The server already supports real timeouts (`answer: null` → incorrect, full duration) via the status route's grace handler.

- [ ] **Step 1: Replace `handleTimerExpire`**

Replace:

```typescript
  async function handleTimerExpire() {
    if (!gameId || !gameData) return
    // Submit with the currently selected answer (or 0 as fallback if nothing selected)
    const answer = selectedAnswer ?? 0
    // Only auto-submit if this round hasn't been submitted yet
    if (roundAnswers[gameData.currentRound] === undefined) {
      await handleAnswer(answer)
    }
  }
```

with:

```typescript
  async function handleTimerExpire() {
    if (!gameId || !gameData) return
    if (roundAnswers[gameData.currentRound] !== undefined) return
    if (selectedAnswer !== undefined) {
      // Lock in whatever the player had highlighted when time ran out
      await handleAnswer(selectedAnswer)
      return
    }
    // Nothing selected: don't fabricate a guess. The status route's timeout
    // path records a null answer (incorrect, full duration) after its 5s
    // grace — poke it once so SSE-only clients still advance the round.
    setTimeout(() => {
      fetch(`/api/game/status?gameId=${gameId}`).catch(() => {})
    }, 6000)
  }
```

- [ ] **Step 2: Lint, then commit**

Run: `npm run lint`

```bash
git add "src/app/(game)/play/page.tsx"
git commit -m "fix: round timeout records an honest null answer instead of auto-guessing option A"
```

### Task 13: Landing-page "spot the bug" teaser (judges play in 10s, no login)

**Files:**
- Create: `src/components/landing/BugTeaser.tsx`
- Modify: `src/app/page.tsx`

`/api/bugs/random` already works unauthenticated and has a `?reveal=1&bugId=` mode — no API changes needed.

- [ ] **Step 1: Create `src/components/landing/BugTeaser.tsx` (full file)**

```tsx
"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { CodeViewer } from "@/components/game/CodeViewer"
import { AnswerOptions } from "@/components/game/AnswerOptions"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface TeaserBug {
  bugId: string
  language: string
  difficulty: number
  buggyCode: string
  bugLine?: number
  options: [string, string, string, string]
}

export function BugTeaser() {
  const [bug, setBug] = useState<TeaserBug | null>(null)
  const [failed, setFailed] = useState(false)
  const [selected, setSelected] = useState<number | undefined>(undefined)
  const [revealed, setRevealed] = useState(false)
  const [verdict, setVerdict] = useState<{ correctAnswer: number; explanation: string } | null>(null)
  const loadedAtRef = useRef<number>(0)
  const [elapsedMs, setElapsedMs] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch("/api/bugs/random?difficulty=2")
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => {
        if (cancelled) return
        if (b?.buggyCode && Array.isArray(b.options)) {
          setBug(b as TeaserBug)
          loadedAtRef.current = Date.now()
        } else {
          setFailed(true)
        }
      })
      .catch(() => { if (!cancelled) setFailed(true) })
    return () => { cancelled = true }
  }, [])

  async function handleAnswer(index: number) {
    if (!bug || revealed) return
    setSelected(index)
    setElapsedMs(Date.now() - loadedAtRef.current)
    try {
      const res = await fetch(`/api/bugs/random?reveal=1&bugId=${bug.bugId}`)
      if (!res.ok) throw new Error("reveal failed")
      const full = (await res.json()) as { correctAnswer: number; explanation: string }
      setVerdict({ correctAnswer: full.correctAnswer, explanation: full.explanation })
    } catch {
      setVerdict(null)
    } finally {
      setRevealed(true)
    }
  }

  // Never block the landing page on API trouble
  if (failed) return null

  const wasCorrect = revealed && verdict !== null && selected === verdict.correctAnswer

  return (
    <section className="px-4 py-16 sm:px-6">
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="space-y-2 text-center">
          <h2 className="text-3xl font-bold text-white">Can you spot the bug?</h2>
          <p className="text-gray-400">No sign-up needed — this is what a round feels like.</p>
        </div>

        {!bug ? (
          <div className="h-64 animate-pulse rounded-xl border border-white/10 bg-white/5" />
        ) : (
          <>
            <CodeViewer
              code={bug.buggyCode}
              language={bug.language}
              bugLine={bug.bugLine}
              revealed={revealed}
            />
            <AnswerOptions
              options={bug.options}
              selectedAnswer={selected}
              correctAnswer={verdict?.correctAnswer}
              revealed={revealed && verdict !== null}
              disabled={revealed}
              onAnswer={handleAnswer}
            />
            {revealed && (
              <div
                className={cn(
                  "space-y-3 rounded-xl border px-5 py-4 animate-in fade-in slide-in-from-bottom-2 duration-300",
                  wasCorrect
                    ? "border-emerald-500/40 bg-emerald-500/10"
                    : "border-red-500/40 bg-red-500/10"
                )}
              >
                <p className={cn("font-semibold", wasCorrect ? "text-emerald-300" : "text-red-300")}>
                  {wasCorrect
                    ? `✓ Found it${elapsedMs != null ? ` in ${(elapsedMs / 1000).toFixed(1)}s` : ""} — now imagine doing that against a live opponent.`
                    : "✗ Not quite — your future opponents hope you stay this way."}
                </p>
                {verdict?.explanation && (
                  <p className="text-sm text-white/70">{verdict.explanation}</p>
                )}
                <Link href="/play" className={cn(buttonVariants({ size: "lg" }), "font-semibold")}>
                  Play a real match →
                </Link>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  )
}
```

- [ ] **Step 2: Insert into the landing page**

In `src/app/page.tsx`:
1. Add import: `import { BugTeaser } from "@/components/landing/BugTeaser"`
2. Between the closing `</section>` of the Hero block and the `{/* Features */}` comment, insert:

```tsx
      {/* ------------------------------------------------------------------ */}
      {/* Interactive teaser                                                  */}
      {/* ------------------------------------------------------------------ */}
      <BugTeaser />
```

- [ ] **Step 3: Lint + build + manual verify**

Run: `npm run lint && npm run build`
Then load `/` logged-out: teaser renders a bug, answering reveals the bug line + explanation + CTA. The e2e landing spec (if it asserts "Why BugHunt?") still passes — that section is untouched.

- [ ] **Step 4: Commit**

```bash
git add src/components/landing/BugTeaser.tsx src/app/page.tsx
git commit -m "feat: no-login 'spot the bug' teaser on the landing page"
```

### Task 14: Result page celebration — rank-up chip + entrance animation

**Files:**
- Modify: `src/components/game/GameResult.tsx`

- [ ] **Step 1: Add a local rank helper** (after the `OPTION_LABELS` constant — do NOT import from `@/lib/users`, that would pull the DynamoDB client into the client bundle):

```typescript
// Local copy of the rank thresholds (lib/users imports the DynamoDB client,
// which must not enter the client bundle).
function rankFromElo(elo: number): string {
  if (elo >= 2000) return "Grandmaster"
  if (elo >= 1800) return "Master"
  if (elo >= 1600) return "Diamond"
  if (elo >= 1400) return "Platinum"
  if (elo >= 1200) return "Gold"
  if (elo >= 1000) return "Silver"
  return "Bronze"
}
```

- [ ] **Step 2: Compute rank-up** — after `const eloBefore = newElo - eloChange`, add:

```typescript
  const rankBefore = rankFromElo(eloBefore)
  const rankAfter = rankFromElo(newElo)
  const rankedUp = isWin && rankAfter !== rankBefore
```

- [ ] **Step 3: Animate the banner** — in the banner `<div>` replace:

```typescript
        className={cn(
          "flex items-center justify-between rounded-2xl border px-6 py-5",
          bannerConfig.bg
        )}
```

with:

```typescript
        className={cn(
          "flex items-center justify-between rounded-2xl border px-6 py-5 animate-in fade-in zoom-in-95 duration-500",
          bannerConfig.bg
        )}
```

- [ ] **Step 4: Add the rank-up chip** — replace the banner's `<h1>` block:

```tsx
        <h1 className={cn("text-2xl font-bold sm:text-3xl", bannerConfig.text)}>
          {bannerConfig.title}
        </h1>
```

with:

```tsx
        <div className="space-y-1">
          <h1 className={cn("text-2xl font-bold sm:text-3xl", bannerConfig.text)}>
            {bannerConfig.title}
          </h1>
          {rankedUp && (
            <span className="inline-flex items-center gap-1 rounded-full border border-yellow-500/50 bg-yellow-500/15 px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide text-yellow-300 animate-in slide-in-from-bottom-2 fade-in duration-700">
              ⬆ Rank up: {rankBefore} → {rankAfter}
            </span>
          )}
        </div>
```

- [ ] **Step 5: Lint + commit**

Run: `npm run lint`

```bash
git add src/components/game/GameResult.tsx
git commit -m "feat: result banner entrance animation + rank-up chip"
```

### Task 15: Extract leaderboard helpers to `src/lib/leaderboard.ts` with a 60s cache

**Files:**
- Create: `src/lib/leaderboard.ts`
- Modify: `src/app/api/leaderboard/route.ts` (thin handler)
- Modify: `src/app/page.tsx`, `src/app/(social)/leaderboard/page.tsx`, `src/components/leaderboard/LeaderboardTabs.tsx` (imports)

Pages currently import data helpers **from a route file** — works, but it's a smell, and every landing-page view hits DynamoDB. Move to a lib with the house in-memory cache (60s), so the landing page costs ~1 query/min/instance.

- [ ] **Step 1: Create `src/lib/leaderboard.ts` (full file)**

```typescript
import { queryItems, cacheGet, cacheSet } from "@/lib/dynamodb"
import { getCurrentSeason } from "@/lib/seasons"

export type LeaderboardPlayer = {
  rank: number
  userId: string
  displayName: string
  elo: number
  gamesPlayed: number
  gamesWon: number
  winRate: number
}

const LEADERBOARD_CACHE_TTL_MS = 60_000

async function queryLeaderboard(pk: string): Promise<LeaderboardPlayer[]> {
  const cacheKey = `leaderboard:${pk}`
  const cached = cacheGet(cacheKey)
  if (cached !== undefined) return cached as LeaderboardPlayer[]

  const { items } = await queryItems(
    "pk = :pk AND begins_with(sk, :skPrefix)",
    { ":pk": pk, ":skPrefix": "RANK#" },
    { limit: 100, scanIndexForward: false }
  )

  const players: LeaderboardPlayer[] = items.map((item, idx) => {
    const gamesPlayed = (item.gamesPlayed as number) ?? 0
    const gamesWon = (item.gamesWon as number) ?? 0
    const winRate = gamesPlayed > 0 ? Math.round((gamesWon / gamesPlayed) * 100) : 0
    return {
      rank: idx + 1,
      userId: item.userId as string,
      displayName: (item.displayName as string) ?? "Unknown",
      elo: (item.elo as number) ?? 1200,
      gamesPlayed,
      gamesWon,
      winRate,
    }
  })

  cacheSet(cacheKey, players, LEADERBOARD_CACHE_TTL_MS)
  return players
}

export async function getLeaderboardPlayers(): Promise<LeaderboardPlayer[]> {
  return queryLeaderboard("LEADERBOARD#GLOBAL")
}

export async function getSeasonLeaderboardPlayers(): Promise<LeaderboardPlayer[]> {
  const season = await getCurrentSeason()
  if (!season) return []
  return queryLeaderboard(`LEADERBOARD#SEASON#${season.seasonId}`)
}
```

- [ ] **Step 2: Replace `src/app/api/leaderboard/route.ts` (full file)**

```typescript
import { getLeaderboardPlayers, getSeasonLeaderboardPlayers } from "@/lib/leaderboard"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const seasonParam = searchParams.get("season")
    const players =
      seasonParam === "current"
        ? await getSeasonLeaderboardPlayers()
        : await getLeaderboardPlayers()
    return Response.json({ players })
  } catch (err) {
    console.error("Leaderboard GET error:", err)
    return Response.json({ error: "Failed to load leaderboard" }, { status: 500 })
  }
}
```

- [ ] **Step 3: Update the three import sites**

1. `src/app/page.tsx`: change `import { getLeaderboardPlayers } from "@/app/api/leaderboard/route"` → `import { getLeaderboardPlayers } from "@/lib/leaderboard"`
2. `src/app/(social)/leaderboard/page.tsx`: change `import { getLeaderboardPlayers, getSeasonLeaderboardPlayers } from "@/app/api/leaderboard/route"` → same names `from "@/lib/leaderboard"`
3. `src/components/leaderboard/LeaderboardTabs.tsx`: change `import type { LeaderboardPlayer } from "@/app/api/leaderboard/route"` → `from "@/lib/leaderboard"`

Then run: `grep -rn "api/leaderboard/route" src/` — Expected: **no matches**.

- [ ] **Step 4: Verify**

Run: `npm run build && TEST_MODE=true npx tsx --tsconfig tsconfig.test.json --test tests/api/leaderboard.test.ts`
Expected: build passes, leaderboard API tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/leaderboard.ts src/app/api/leaderboard/route.ts src/app/page.tsx "src/app/(social)/leaderboard/page.tsx" src/components/leaderboard/LeaderboardTabs.tsx
git commit -m "refactor: leaderboard helpers in lib with 60s in-memory cache (landing page no longer queries per view)"
```

### Task 16 (OPTIONAL — do only if on schedule by Jun 19): Shareable result cards

**Files:**
- Create: `src/app/api/og/result/route.tsx`
- Create: `src/app/share/result/[gameId]/page.tsx`
- Modify: `src/components/game/GameResult.tsx` (Share button)

The README already advertises "Shareable Results — auto-generated OG images for match results", but only `/api/og/daily` exists. **Either implement this task or soften that README bullet** (change it to "Shareable daily-challenge cards") — the claim and the product must match before judging.

- [ ] **Step 1: Create `src/app/api/og/result/route.tsx`**

```tsx
import { ImageResponse } from "@vercel/og"

export const runtime = "edge"

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const outcomeParam = searchParams.get("outcome")
  const outcome = outcomeParam === "loss" ? "DEFEAT" : outcomeParam === "draw" ? "DRAW" : "VICTORY"
  const name = (searchParams.get("name") ?? "A bug hunter").slice(0, 24)
  const elo = (searchParams.get("elo") ?? "1200").slice(0, 5)
  const accent = outcome === "VICTORY" ? "#34d399" : outcome === "DEFEAT" ? "#f87171" : "#9ca3af"

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          background: "#030712",
          color: "white",
          fontFamily: "monospace",
        }}
      >
        <div style={{ display: "flex", fontSize: 36, color: "#34d399", marginBottom: 24 }}>🐛 BugHunt</div>
        <div style={{ display: "flex", fontSize: 96, fontWeight: 800, color: accent }}>{outcome}</div>
        <div style={{ display: "flex", fontSize: 40, marginTop: 24 }}>{name}</div>
        <div style={{ display: "flex", fontSize: 32, color: "#9ca3af", marginTop: 12 }}>{elo} Elo</div>
        <div style={{ display: "flex", fontSize: 24, color: "#6b7280", marginTop: 40 }}>
          Race to find bugs faster than anyone — bughunt.vercel.app
        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  )
}
```

- [ ] **Step 2: Create `src/app/share/result/[gameId]/page.tsx`** (server page so crawlers get OG meta):

```tsx
import type { Metadata } from "next"
import Link from "next/link"
import { getGame } from "@/lib/game"
import { getUser } from "@/lib/users"
import { buttonVariants } from "@/components/ui/button"

interface Props {
  params: Promise<{ gameId: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { gameId } = await params
  const game = await getGame(gameId)
  if (!game || game.status !== "completed") return { title: "BugHunt match" }
  const winner = game.winnerId ? await getUser(game.winnerId) : null
  const title = winner
    ? `${winner.displayName} won a BugHunt duel`
    : "A BugHunt duel ended in a draw"
  const og = `/api/og/result?outcome=${game.winnerId ? "win" : "draw"}&name=${encodeURIComponent(winner?.displayName ?? "Bug hunters")}&elo=${winner?.elo ?? 1200}`
  return {
    title,
    openGraph: { title, images: [og] },
    twitter: { card: "summary_large_image", title, images: [og] },
  }
}

export default async function ShareResultPage({ params }: Props) {
  const { gameId } = await params
  const game = await getGame(gameId)
  const winner = game?.winnerId ? await getUser(game.winnerId) : null

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-4 text-center">
      <p className="text-sm uppercase tracking-widest text-emerald-400">BugHunt duel</p>
      <h1 className="text-3xl font-bold text-white sm:text-4xl">
        {game?.status !== "completed"
          ? "This match isn't finished yet"
          : winner
            ? `${winner.displayName} found the bugs first 🏆`
            : "Dead even — a draw"}
      </h1>
      <p className="max-w-md text-white/60">
        Two developers, three buggy snippets, 120 seconds each. Think you'd have been faster?
      </p>
      <Link href="/play" className={buttonVariants({ size: "lg" })}>
        Challenge someone →
      </Link>
    </main>
  )
}
```

- [ ] **Step 3: Add the Share button to `GameResult.tsx`**

1. Next to the rematch state declarations, add: `const [shareCopied, setShareCopied] = useState(false)`
2. In the Actions row, after the rematch `<Button>` block, add:

```tsx
        <Button
          size="lg"
          variant="outline"
          className="min-w-48"
          onClick={async () => {
            const url = `${window.location.origin}/share/result/${game.gameId}`
            try {
              if (navigator.share) {
                await navigator.share({ title: "BugHunt result", url })
              } else {
                await navigator.clipboard.writeText(url)
                setShareCopied(true)
                setTimeout(() => setShareCopied(false), 1500)
              }
            } catch { /* user cancelled */ }
          }}
        >
          {shareCopied ? "✓ Link copied" : "Share result"}
        </Button>
```

- [ ] **Step 4: Verify + commit**

Run: `npm run lint && npm run build`, then load `/share/result/<a-real-completed-gameId>` and `/api/og/result?outcome=win&name=Test&elo=1234` locally.

```bash
git add src/app/api/og/result/route.tsx "src/app/share/result/[gameId]/page.tsx" src/components/game/GameResult.tsx
git commit -m "feat: shareable result cards — OG image route, public share page, share button"
```

---

## Phase 4 — Million-scale evidence (Jun 21–24)

**Why:** all 8 judges are AWS Databases people. Claims impress nobody; capacity math, documented limits, and load-test numbers do.

### Task 17: Write `docs/ARCHITECTURE.md` (the document the judges actually read)

**Files:**
- Create: `docs/ARCHITECTURE.md`
- Modify: `README.md` (link it under the Architecture heading: `See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for access patterns, capacity math, and known limits.`)

- [ ] **Step 1: Create `docs/ARCHITECTURE.md` with exactly this content** (update numbers only if the implementation changed):

````markdown
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
````

- [ ] **Step 2: Commit**

```bash
git add docs/ARCHITECTURE.md README.md
git commit -m "docs: ARCHITECTURE.md — access patterns, capacity math @1M DAU, known limits with mitigation paths"
```

### Task 18: BUG#INDEX size guard

**Files:**
- Modify: `src/lib/bugs.ts` (`putBugIndex`)

- [ ] **Step 1:** In `putBugIndex`, immediately after `const newIndex: BugIndex = { ...index, version: expectedVersion + 1 }`, add:

```typescript
  // 400KB DynamoDB item-size ceiling — warn loudly at 50% so we migrate to
  // per-difficulty shard items (docs/ARCHITECTURE.md, Limit 2) before it bites.
  const approxBytes = JSON.stringify(newIndex).length
  if (approxBytes > 200_000) {
    console.warn(`[bugs] BUG#INDEX is ~${approxBytes}B — past 50% of the 400KB item limit; shard by difficulty soon`)
  }
```

- [ ] **Step 2:** Run: `npx tsx src/lib/__tests__/bugs-logic.test.ts` — Expected: passes. Commit:

```bash
git add src/lib/bugs.ts
git commit -m "feat: BUG#INDEX item-size guard warns at 50% of the 400KB cap"
```

### Task 19: [OPS] Enable Global Tables for real + align README claims

- [ ] **Step 1: [OPS]** Run `./scripts/enable-global-tables.sh`, wait 30–60 min, then verify:
`aws dynamodb describe-table --table-name bughunt-main --region us-east-1 --query "Table.Replicas[].{Region:RegionName,Status:ReplicaStatus}" --output table`
Expected: `eu-west-1` and `ap-southeast-1` both `ACTIVE`. Screenshot the DynamoDB console "Global tables" tab for the video/Devpost.

- [ ] **Step 2:** In `README.md`, replace the bullet:

```markdown
- A `scripts/enable-global-tables.sh` script exists to optionally enable DynamoDB Global Tables (multi-region replicas) for a demo, but **this is not wired into the deploy pipeline or enabled by default** — the table runs single-region unless you run that script manually.
```

with:

```markdown
- **DynamoDB Global Tables are enabled**: `bughunt-main` replicates to eu-west-1 and ap-southeast-1 (`scripts/enable-global-tables.sh` for fresh deployments). `src/lib/dynamodb.ts` routes reads to the nearest replica via `VERCEL_REGION`; writes are pinned to us-east-1 while Vercel functions run single-region — see docs/ARCHITECTURE.md, Limit 4, for the honest multi-region write story.
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: README reflects enabled Global Tables with the honest multi-region caveat"
```

### Task 20: [OPS] Load test against production, capture evidence

- [ ] **Step 1:** `mkdir -p docs/loadtest`
- [ ] **Step 2:** Run (off-peak; it's our own app — note Upstash free-tier command quotas, downgrade the 1000 req/s phase to 300 in `scripts/load-test.yml` if on the free tier):

```bash
TARGET_URL=https://bughunt.vercel.app npx artillery run scripts/load-test.yml | tee docs/loadtest/2026-06-prod-run.txt
```

Expected: completes all phases; note `http.response_time` p95/p99 and error counts from the summary.

- [ ] **Step 3:** Create `docs/loadtest/SUMMARY.md` with a 10-line digest: phases, peak RPS, p50/p95/p99, error rate, plus screenshots of the Vercel function metrics + DynamoDB consumed-capacity graphs during the run (drop the images in `docs/loadtest/`).
- [ ] **Step 4: Commit**

```bash
git add docs/loadtest
git commit -m "test: production load-test evidence — sustained 100rps, peak 1000rps arrival phases"
```

### Task 21 (STRETCH — only if Phases 0–4 are done by Jun 23): Push-based SSE via TCP pub/sub

**Files:**
- Create: `src/lib/redis-sub.ts`
- Modify: `src/app/api/game/stream/route.ts`
- Modify: `package.json` (add `ioredis`)

`publishGameEvent` already publishes via the Upstash REST client; only subscribing needs TCP. **Deploy to a Vercel preview first; promote only if SSE latency visibly improves and nothing regresses. The polling fallback must remain intact — it is the safety net.**

- [ ] **Step 1:** `npm install ioredis`
- [ ] **Step 2: Create `src/lib/redis-sub.ts`**

```typescript
/**
 * TCP subscriber for push-based SSE. The Upstash REST client can publish but
 * not subscribe; this uses the rediss:// TCP URL (REDIS_URL). Callers must
 * fall back to DynamoDB polling when this returns null.
 */
import Redis from "ioredis"

let subscriber: Redis | null = null

function getSubscriber(): Redis | null {
  const url = process.env.REDIS_URL
  if (!url) return null
  if (!subscriber) {
    subscriber = new Redis(url, { maxRetriesPerRequest: 2 })
    subscriber.on("error", (err) => console.error("[redis-sub]", err.message))
  }
  return subscriber
}

/** Subscribe to a channel; resolves to an unsubscribe fn, or null when no TCP Redis is configured. */
export async function subscribeToChannel(
  channel: string,
  onMessage: (message: string) => void
): Promise<(() => void) | null> {
  const client = getSubscriber()
  if (!client) return null
  const handler = (ch: string, message: string) => {
    if (ch === channel) onMessage(message)
  }
  client.on("message", handler)
  await client.subscribe(channel)
  return () => {
    client.removeListener("message", handler)
    client.unsubscribe(channel).catch(() => {})
  }
}
```

- [ ] **Step 3:** In `src/app/api/game/stream/route.ts`: add imports `import { subscribeToChannel } from "@/lib/redis-sub"` and `import { maybePlayBotRound } from "@/lib/bot"` (the latter exists from Task 8), add `export const maxDuration = 300` next to `export const runtime = "nodejs"`, and replace the whole `// Try Redis pub/sub first; fall back to DynamoDB polling` block (the `hasSubscribe` if/else) with:

```typescript
      // Push first (TCP pub/sub), pull as fallback (DynamoDB polling).
      subscribeToChannel(`game:${gameId}`, (message) => {
        if (state.closed) return
        try {
          const parsed = JSON.parse(message) as { type?: string }
          send(parsed)
          if (parsed.type === "game_resolved") resolve()
        } catch { /* ignore malformed */ }
      })
        .then((unsubscribe) => {
          if (!unsubscribe) {
            startPolling()
            return
          }
          if (state.closed) {
            unsubscribe()
            return
          }
          state.subscriber = { unsubscribe }
          startHeartbeat()
          // Safety net: pub/sub is fire-and-forget — a slow poll catches any
          // dropped game_resolved (and keeps bot turns moving) so clients
          // can't hang forever.
          state.pollTimer = setInterval(async () => {
            if (state.closed) return
            try {
              const g = await getGame(gameId)
              if (!g) return
              maybePlayBotRound(g).catch(() => {})
              if (g.status === "completed") resolve()
            } catch { /* ignore transient errors */ }
          }, 10_000)
        })
        .catch(() => startPolling())
```

- [ ] **Step 4:** Run `npm run build && TEST_MODE=true npx tsx --tsconfig tsconfig.test.json --test tests/api/bot.test.ts`, deploy to preview, play a full bot match there, watch the function logs for `[redis-sub]` errors. Promote only when clean.
- [ ] **Step 5: Commit**

```bash
git add src/lib/redis-sub.ts src/app/api/game/stream/route.ts package.json package-lock.json
git commit -m "feat: push-based SSE via TCP pub/sub with 10s safety poll (polling fallback preserved)"
```

---

## Phase 5 — Submission artifacts (Jun 25–28)

### Task 22: Architecture diagram (required artifact)

**Files:**
- Create: `docs/architecture.mmd`
- Modify: `README.md` (replace the ASCII diagram with the mermaid block — GitHub renders it)

- [ ] **Step 1: Create `docs/architecture.mmd`**

```text
flowchart TB
  subgraph Clients
    B["Browser (play / daily / tournaments / orgs)"]
    V["VS Code extension (API token)"]
  end
  subgraph Vercel["Vercel — global edge"]
    CDN["Edge CDN + static assets"]
    F["Next.js 16 App Router\nserverless functions: SSR · API · SSE"]
    CRON["Vercel Cron\ntournament-tick */5"]
  end
  subgraph AWS["AWS us-east-1 (replicas: eu-west-1 · ap-southeast-1)"]
    DDB[("DynamoDB bughunt-main\nsingle-table · on-demand · TTL\nGSI1 active-games · GSI2 email\nGlobal Tables")]
    STR[["DynamoDB Streams"]]
    L["Lambda leaderboard-updater\nmaterializes RANK# rows"]
    NOVA["Bedrock Nova Lite\nbug QA · bug generation · bot answers"]
  end
  subgraph Upstash["Upstash Redis (TLS)"]
    Q[("Matchmaking queue\nElo-bucketed zsets")]
    RL[("Rate limits")]
    PS[("Game-event pub/sub")]
  end
  B --> CDN
  V --> CDN
  CDN --> F
  CRON --> F
  F <--> DDB
  F <--> Q
  F <--> RL
  F <--> PS
  F --> NOVA
  DDB --> STR
  STR --> L
  L --> DDB
```

- [ ] **Step 2:** In `README.md`, replace the ASCII architecture code block with a ` ```mermaid ` block containing exactly the content above.
- [ ] **Step 3:** Export a PNG for Devpost: `npx -y @mermaid-js/mermaid-cli -i docs/architecture.mmd -o docs/architecture.png -b transparent` (if mmdc/chromium fails in WSL, paste the file into https://mermaid.live and export PNG manually into `docs/architecture.png`).
- [ ] **Step 4: Commit**

```bash
git add docs/architecture.mmd docs/architecture.png README.md
git commit -m "docs: mermaid architecture diagram (README render + PNG for Devpost)"
```

### Task 23: Demo video script (3:00, required artifact)

**Files:**
- Create: `docs/demo-video-script.md` — exactly this content, then record against it:

````markdown
# BugHunt — 3:00 demo script

Record at 1080p, dark theme, no dead air. Pre-stage: logged-in browser, second
incognito window, DynamoDB console (Streams + Global tables tabs), VS Code
with the extension installed, terminal with `aws dynamodb query` ready.

| Time | Shot | Script |
|---|---|---|
| 0:00–0:12 | Landing page hero | "Every developer debugs. BugHunt makes it a sport. Two players, the same buggy code, 120 seconds — fastest accurate eye wins." |
| 0:12–0:25 | Scroll to teaser, answer it live | "You don't even need an account to feel it — spot the bug, get the explanation. Now let's play for real." |
| 0:25–0:50 | Click Find Match → 10s → bot match → DuelHeader | "Matchmaking runs on Elo-bucketed Redis queues. No humans near my rating right now — so after ten seconds, BugHunt summons a Nova bot at my level. No bot servers exist: my own requests power its turns." |
| 0:50–1:25 | Play rounds 1–2, show pips + 'Opponent submitted!' + verdict flash | "Three rounds. Every submit is a DynamoDB conditional write — double-submits are physically impossible. The duel header streams my opponent's progress live." |
| 1:25–1:45 | Round 3 → result page, rank-up chip, Elo, explanations | "Win, Elo, per-round breakdown with explanations — every bug teaches you something. Rematch and post-game chat are one click." |
| 1:45–2:05 | Landing page leaderboard refresh + DynamoDB console Streams tab | "Here's the part database people will like: the leaderboard never aggregates at read time. Game resolution stamps Elo audit fields, DynamoDB Streams trigger a Lambda, and it moves my RANK row — materialized, idempotent, top-100 is one Query." |
| 2:05–2:25 | Global tables tab + ARCHITECTURE.md capacity table | "Single table, on-demand, replicated to three regions. The architecture doc does the math at a million DAU — including the honest limits and their mitigation paths." |
| 2:25–2:45 | Quick cuts: daily challenge, tournament bracket, org leaderboard, social feed, community submit w/ Nova QA | "Beyond 1v1: daily challenges, brackets, org leaderboards, a social layer, and community-submitted bugs that Bedrock Nova quality-screens before review." |
| 2:45–3:00 | VS Code extension practicing a bug → end card | "It even lives in your editor. BugHunt — Next.js on Vercel, DynamoDB underneath, built to scale to everyone who's ever shipped a bug. Which is all of us." |

End card: BugHunt logo · live URL · GitHub URL · "Vercel + AWS Databases — H0 Hackathon".
````

- [ ] **Step 2: Commit** (`git add docs/demo-video-script.md && git commit -m "docs: 3-minute demo video shot script"`), then **record, upload (YouTube unlisted), and put the link in the README header and Devpost**.

### Task 24: builder.aws blog post (bonus points)

**Files:**
- Create: `docs/blog-builder-aws.md` — full draft below; publish on builder.aws with tag `#H0Hackathon`, then link it in Devpost.

````markdown
# Chess.com for debugging: how BugHunt runs a real-time game on DynamoDB with zero servers

*Built for the H0 Hackathon (Vercel + AWS Databases), Track 3: million-scale global apps.*

BugHunt is a competitive debugging game: two players get the same three buggy
snippets, 120 seconds each; most correct answers wins, total time breaks ties,
Elo on the line. The interesting part isn't the game — it's that a real-time
multiplayer game runs entirely on serverless primitives: Next.js on Vercel,
one DynamoDB table, a Streams Lambda, and Upstash Redis for coordination.

## One table, every entity

Everything lives in `bughunt-main`: users, games, per-player answers, bugs,
daily challenges, tournaments, orgs, follows, notifications, chat. Two GSIs
cover the non-key access patterns (active-game-by-user, user-by-email). Every
hot-path read is a key lookup or single-partition Query; nothing aggregates at
read time. [Include the key-pattern table from the repo README.]

## Concurrency without transactions: ConditionExpressions everywhere

A multiplayer game is a pile of races: both players submitting in the same
millisecond, resolve being triggered twice, a rematch accepted at both ends.
Every one of those is settled by a conditional write — `status = :active` to
claim resolution exactly once, `attribute_not_exists(answers[2].submittedAt)`
to make double-submits a no-op, optimistic `version` checks (with an
`attribute_not_exists(version)` clause for legacy items!) on the shared bug
index. The loser of a race gets a clean 409, never a corrupted game.

## The leaderboard is a materialized view, courtesy of Streams

Naive leaderboards scan-and-sort; ours is written, never computed. When a game
resolves we stamp `p1EloBefore/After`, `p2EloBefore/After` onto the game item
*after* profiles update; a Streams-triggered Lambda moves each player's
`RANK#<zero-padded-elo>#<userId>` row. Top-100 is one descending Query. The
zero-padding trick turns DynamoDB's lexicographic sort into a numeric ranking.

## Bots with no servers

Hackathon demos die on empty matchmaking queues. Our bots have no process:
when a human's request touches a game (status poll, submit, SSE tick), it
checks whether the bot's deterministic think-delay — seeded from
sha256(gameId:round) — has elapsed and, if so, writes the bot's answer through
the same conditional path humans use. Any number of concurrent requests agree
on what the bot does; the conditional write dedupes the rest. Optionally,
Amazon Nova Lite literally picks the bot's answers.

## The honest scale math

[Summarize the 1M-DAU table and the three limits + mitigations from
docs/ARCHITECTURE.md — leaderboard partition write gating, BUG#INDEX item-size
sharding path, SSE push upgrade via TCP pub/sub.]

The thing I'd tell other builders: on-demand DynamoDB makes the *easy* 95% of
scale free, and single-table design forces you to know your access patterns
before you write a line. The remaining 5% — hot partitions, item-size
ceilings, held-open connections — is where the real architecture lives. Do
that math in the open; your future self (and apparently hackathon judges) will
thank you.

*Try it: [live URL] · Source: [GitHub URL]*
````

- [ ] **Step 2: Commit + publish** (`git add docs/blog-builder-aws.md && git commit -m "docs: builder.aws blog draft"`). Publish by Jun 27; paste the live blog URL into Devpost.

### Task 25: Devpost submission + final gate

**Files:**
- Create: `docs/devpost.md`

- [ ] **Step 1: Create `docs/devpost.md`**

````markdown
# Devpost submission — BugHunt

**Tagline:** Chess.com for debugging — race a rival (or Amazon Nova) to find the bug. DynamoDB keeps score for millions.

**Track:** 3 — Million-scale global app (gaming/social/entertainment)

## Inspiration
Every developer has stared at code hunting a bug under time pressure. We made that feeling a competitive sport — because the skill is real, trainable, and weirdly fun head-to-head.

## What it does
Ranked 1v1 debugging duels (3 rounds × 120s) with chess-style Elo and rank tiers; bot opponents powered by lazy serverless evaluation (optionally answered by Bedrock Nova) so there's always a match; daily challenges with streaks; bracketed tournaments; org/team leaderboards; a social layer (follow, feed, direct challenges); community bug submissions quality-screened by Nova; a VS Code extension; shareable result cards.

## How we built it
Next.js 16 App Router on Vercel; one DynamoDB table (on-demand, TTL, 2 GSIs, Global Tables to 3 regions) as the source of truth; DynamoDB Streams → Lambda materializing the leaderboard as RANK# rows (top-100 = one Query); Upstash Redis for Elo-bucketed matchmaking queues, rate limits, and game-event pub/sub with DynamoDB-polling fallback; Bedrock Nova for content QA, generation, and bot play. 180+ tests (unit, API-against-real-DynamoDB, Playwright E2E) and a production artillery load test.

## Challenges
Multiplayer on serverless is a pile of races: double-submits, double-resolution, rematch races, queue claim races. We settled every one with DynamoDB ConditionExpressions (and one optimistic-versioned index with bounded retries) rather than locks — the loser of any race gets a clean no-op. The second challenge was real-time without WebSockets: SSE with layered fallbacks (TCP pub/sub → DynamoDB polling → client polling).

## Accomplishments
A leaderboard that is written, never computed; bots that need no servers; honest million-DAU capacity math published in docs/ARCHITECTURE.md — including the system's three real limits and their designed mitigations.

## What we learned
Single-table design is a forcing function: you must know every access pattern up front. On-demand mode makes 95% of scale free; the engineering is in the other 5% (hot partitions, item ceilings, held-open functions).

## What's next
Top-N write gating on the leaderboard Lambda, per-difficulty index sharding, multi-region writes once functions go multi-region, mobile PWA, language-specific ladders.

**Links:** Live app · GitHub (public) · 3-min video · Architecture diagram · builder.aws blog post (#H0Hackathon)
````

- [ ] **Step 2: Final gate checklist — every box checked before submitting:**
  - [ ] **Jun 26 hard deadline: AWS + v0 credits requested** (do this regardless, today if not done).
  - [ ] Repo is **public**; `git log -p | grep -cE "AKIA[0-9A-Z]{16}"` returns 0; `.env*` never committed.
  - [ ] Live URL works **logged-out** (teaser plays, leaderboard renders) and logged-in (bot match completes end-to-end).
  - [ ] Fresh-account dry run: brand-new Google account → OAuth → Find Match → bot game → result → leaderboard moved. Time it; judges get ~5 minutes.
  - [ ] Video ≤3:00, link works in incognito; diagram PNG uploaded; blog URL pasted.
  - [ ] README quick-skim: every claim is true of the deployed app (share cards, global tables, test counts).
  - [ ] `npm test` green; `npm run build` green; production deploy is the same commit you submit.
  - [ ] **Submit on Devpost by Jun 28 evening** — never deadline day.

- [ ] **Step 3: Commit**

```bash
git add docs/devpost.md
git commit -m "docs: Devpost submission text + final gate checklist"
```

---

## Timeline / dependency notes for the executor

- Execute tasks in numeric order; Task 8's test asserts the Elo audit fields from Task 2, and Tasks 11–12 edit JSX introduced as a whole block in Task 11.
- Tasks 4, 5, 19, 20 and parts of 23–25 are **[OPS]** (live AWS / recording / publishing) — if credentials or tooling are missing, do every code step, leave the ops step unchecked, and flag it in the task report rather than faking it.
- Tasks 9, 16, 21 are optional: skip them if behind schedule — but if Task 16 is skipped, apply its README-claim softening step.
- Suggested calendar: T1–T5 by Jun 13 · T6–T10 by Jun 15 · T11–T15 by Jun 19 (T16 Jun 19) · T17–T20 by Jun 23 (T21 Jun 23) · T22–T24 by Jun 27 · T25 gate + submit Jun 28.

## Self-review (performed at planning time)

- **Coverage vs the strategic review:** leaderboard pipeline bug → T2–T5; Streams not enabled → T4; resolveGame delete window → T2; bot opponent + demo insurance → T6–T10; Bedrock-as-player → T9; design gap (duel UI, teaser, result, overlay) → T10–T14; timer auto-guess → T12; route-import smell + landing query cost → T15; README/product claim mismatches → T1, T16, T19; scale math + limits doc → T17–T18; Global Tables reality → T19; load evidence → T20; SSE upgrade path → T21; required artifacts (video, diagram, public repo, blog bonus, credits deadline) → T22–T25.
- **Type consistency:** `DuelPlayerInfo`/`RoundOutcome` defined in T11 and used only there; `maybePlayBotRound(game: Game): Promise<boolean>` consistent across T6/T8/T21; `markQueueJoined/getQueueJoinedAt/clearQueueJoined` consistent across T7; `shouldProcessImage` matches its test in T3; `LeaderboardPlayer` shape identical to the pre-refactor type in T15.
- **Known judgment calls:** bot games affect Elo (intentional — progression works on an empty platform; bots' own ratings drift, which is fine); bots are excluded from leaderboards (T3) and from the rebuild script (T5); `enqueuePlayer` deliberately untouched so existing redis-helper unit-test mocks stay valid (queue-wait clock is a separate NX key).
