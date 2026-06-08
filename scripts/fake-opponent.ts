/**
 * Fake opponent script for local testing.
 *
 * Usage:
 *   1. Run: npx tsx scripts/fake-opponent.ts
 *   2. Click "Find Match" in your browser
 *   3. After ~3s you'll be matched — the bot plays through all 3 rounds,
 *      thinking for a few seconds before each submission
 *   4. Submit your answers — once both players finish round 3 the game resolves
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb"
import {
  DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand
} from "@aws-sdk/lib-dynamodb"
import { Redis } from "@upstash/redis"
import { getGame, getGamePlayer, submitRoundAnswer, advanceOrResolveRound, ROUNDS_PER_GAME } from "../src/lib/game"
import { getBug } from "../src/lib/bugs"

const TABLE = process.env.DYNAMODB_TABLE_NAME ?? "bughunt-main"
const REGION = process.env.AWS_REGION ?? "us-east-1"

const ddb = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: REGION }),
  { marshallOptions: { removeUndefinedValues: true } }
)

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
})

const FAKE_USER_ID = "fake-opponent-001"
const FAKE_ELO = 1200
const ELO_RANGE = Math.floor(FAKE_ELO / 200) * 200

async function ensureProfile() {
  const existing = await ddb.send(new GetCommand({
    TableName: TABLE,
    Key: { pk: `USER#${FAKE_USER_ID}`, sk: "PROFILE" },
  }))
  if (!existing.Item) {
    await ddb.send(new PutCommand({
      TableName: TABLE,
      Item: {
        pk: `USER#${FAKE_USER_ID}`,
        sk: "PROFILE",
        gsi2pk: `EMAIL#fake@bughunt.test`,
        gsi2sk: FAKE_USER_ID,
        userId: FAKE_USER_ID,
        email: "fake@bughunt.test",
        displayName: "Bot Opponent",
        avatar: null,
        elo: FAKE_ELO,
        rank: "Gold",
        gamesPlayed: 42,
        gamesWon: 20,
        currentStreak: 0,
        bestStreak: 5,
        bugsSeen: [],
        achievementsUnlocked: [],
        createdAt: Date.now(),
      },
    }))
    console.log("✓ Bot profile created")
  }
}

async function joinQueue() {
  // Matchmaking runs through Upstash Redis sorted sets (queue:<eloRange>),
  // not DynamoDB — must mirror enqueuePlayer() in src/lib/redis.ts exactly.
  const score = Math.floor(Date.now() / 1000)
  await redis.zadd(`queue:${ELO_RANGE}`, { score, member: FAKE_USER_ID })
  await redis.expire(`queue:${ELO_RANGE}`, 300)
  console.log(`✓ Bot joined Redis queue (Elo range ${ELO_RANGE})`)
}

async function findBotActiveGame(): Promise<string | null> {
  // Query GSI1 for ACTIVE_GAME#fake-opponent-001
  const res = await ddb.send(new QueryCommand({
    TableName: TABLE,
    IndexName: "gsi1",
    KeyConditionExpression: "gsi1pk = :pk",
    ExpressionAttributeValues: { ":pk": `ACTIVE_GAME#${FAKE_USER_ID}` },
    Limit: 1,
  }))
  return (res.Items?.[0]?.gsi1sk as string) ?? null
}

// Bot always picks option A (index 0) — usually wrong, so the human can win.
// Change botAnswer below if you want the bot to play to win instead.
const botAnswer = 0

async function playRound(gameId: string, roundIndex: number): Promise<void> {
  const game = await getGame(gameId)
  if (!game) throw new Error("Game disappeared mid-match")

  const bugId = game.bugIds[roundIndex]
  const bug = await getBug(bugId)
  if (!bug) throw new Error(`Bug ${bugId} not found`)

  const roundStartedAt = game.roundStartedAt[roundIndex] ?? game.createdAt

  // Already answered this round? (e.g. resumed mid-game) — just wait for advance.
  const existing = await getGamePlayer(gameId, FAKE_USER_ID)
  if (existing?.answers?.[roundIndex]?.submittedAt == null) {
    console.log(`  Round ${roundIndex + 1}/${ROUNDS_PER_GAME}: bot is thinking for 5 seconds...`)
    await new Promise(r => setTimeout(r, 5000))

    const now = Date.now()
    const { correct, timeElapsedMs } = await submitRoundAnswer(
      gameId, FAKE_USER_ID, roundIndex, bug, botAnswer, now, roundStartedAt
    )
    console.log(
      `  ✓ Bot submitted answer ${botAnswer} for round ${roundIndex + 1} ` +
      `(${correct ? "correct ✓" : "wrong ✗"} — correct was ${bug.correctAnswer}, took ${timeElapsedMs}ms)`
    )
    await advanceOrResolveRound(gameId)
  }

  console.log("  Waiting for your submission to advance/resolve the round...")
  const humanId = game.player1Id === FAKE_USER_ID ? game.player2Id : game.player1Id
  if (!humanId) throw new Error("No human opponent found")

  for (let i = 0; i < 90; i++) {
    const current = await getGame(gameId)
    if (!current) throw new Error("Game disappeared mid-match")
    if (current.status === "completed") return
    if (current.currentRound > roundIndex) return

    const humanRecord = await getGamePlayer(gameId, humanId)
    if (humanRecord?.answers?.[roundIndex]?.submittedAt != null) {
      // Both have submitted — try to advance ourselves in case the route
      // (which normally drives this) hasn't run yet.
      await advanceOrResolveRound(gameId)
    }
    await new Promise(r => setTimeout(r, 2000))
  }
  console.log(`  ✗ Gave up waiting for round ${roundIndex + 1} to advance after 180s`)
}

async function playMatch(gameId: string) {
  // Always re-derive the round to play from the server's currentRound — never
  // guess ahead. If playRound times out waiting on a slow human, looping back
  // re-fetches the (still current) round instead of corrupting a future slot.
  // Bound the retries so a genuinely-stuck game (e.g. opponent vanished) doesn't
  // spin forever — give up after a few stalled rounds.
  let stalledRound = -1
  let stallCount = 0
  for (;;) {
    const game = await getGame(gameId)
    if (!game) throw new Error("Game disappeared mid-match")
    if (game.status === "completed") break
    if (game.currentRound >= ROUNDS_PER_GAME) break

    if (game.currentRound === stalledRound) {
      stallCount++
      if (stallCount >= 3) {
        console.log(`  ✗ Round ${game.currentRound + 1} hasn't advanced after ${stallCount} attempts — giving up on this match.`)
        return
      }
    } else {
      stalledRound = game.currentRound
      stallCount = 0
    }
    await playRound(gameId, game.currentRound)
  }

  const final = await getGame(gameId)
  if (final?.status === "completed") {
    console.log("✓ Game resolved — check the result page!")
  } else {
    console.log("  Match did not reach completion within the wait window.")
  }
}

async function run() {
  await ensureProfile()
  await joinQueue()
  console.log("")
  console.log("Waiting for match to be created...")
  console.log("→ Click 'Find Match' in your browser now")
  console.log("")

  // Poll for a game being created for the bot
  let gameId: string | null = null
  let attempts = 0
  while (!gameId && attempts < 40) {
    await new Promise(r => setTimeout(r, 2000))
    gameId = await findBotActiveGame()
    attempts++
    if (attempts % 5 === 0) console.log(`  Still waiting... (${attempts * 2}s)`)
  }

  if (!gameId) {
    console.error("✗ No game found after 80s — did you click Find Match?")
    process.exit(1)
  }

  console.log(`✓ Game found: ${gameId}`)
  await playMatch(gameId)
}

run().catch(err => { console.error(err); process.exit(1) })
