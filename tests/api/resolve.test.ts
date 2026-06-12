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
