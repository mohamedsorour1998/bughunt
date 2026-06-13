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
