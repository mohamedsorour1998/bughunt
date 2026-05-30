import { test, before, after, describe } from "node:test"
import assert from "node:assert/strict"
import { NextRequest } from "next/server"
import { seedTestUsers, cleanupTestUsers, seedTestGame, cleanupTestGame, getFirstActiveBugId } from "../helpers/db"
import { TEST_USER_1, TEST_USER_2 } from "../helpers/fixtures"
import { POST as matchmake } from "../../src/app/api/game/matchmake/route"
import { GET as getStatus } from "../../src/app/api/game/status/route"
import { POST as submit } from "../../src/app/api/game/submit/route"
import { GET as getGame } from "../../src/app/api/game/[gameId]/route"
import { POST as cancel } from "../../src/app/api/game/cancel/route"

if (process.env.TEST_MODE !== "true") throw new Error("TEST_MODE=true required")

function authReq(url: string, userId: string, method = "GET", body?: unknown): Request {
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json", "x-test-user-id": userId },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

function authNextReq(url: string, userId: string, method = "GET", body?: unknown): NextRequest {
  return new NextRequest(url, {
    method,
    headers: { "Content-Type": "application/json", "x-test-user-id": userId },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

let testBugId: string

before(async () => {
  await seedTestUsers()
  testBugId = await getFirstActiveBugId()
})

after(async () => {
  await cleanupTestUsers()
})

// ---- Auth guard tests ----

test("POST /api/game/matchmake returns 401 without auth", async () => {
  const req = new Request("http://localhost/api/game/matchmake", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
  const res = await matchmake(req)
  assert.equal(res.status, 401)
})

test("GET /api/game/status returns 401 without auth", async () => {
  const req = new NextRequest("http://localhost/api/game/status?gameId=abc")
  const res = await getStatus(req)
  assert.equal(res.status, 401)
})

test("GET /api/game/status returns 404 for nonexistent game", async () => {
  const req = authNextReq("http://localhost/api/game/status?gameId=nonexistent-game-xyz", TEST_USER_1.userId)
  const res = await getStatus(req)
  assert.equal(res.status, 404)
})

test("POST /api/game/cancel returns 401 without auth", async () => {
  const req = new Request("http://localhost/api/game/cancel", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
  const res = await cancel(req)
  assert.equal(res.status, 401)
})

test("POST /api/game/cancel returns {cancelled:true} for authed user", async () => {
  const req = authReq("http://localhost/api/game/cancel", TEST_USER_1.userId, "POST", {})
  const res = await cancel(req)
  assert.equal(res.status, 200)
  const body = await res.json() as { cancelled: boolean }
  assert.equal(body.cancelled, true)
})

// ---- Submit flow with pre-seeded game ----

// Use a describe block with its own before/after for the submit flow
const SUBMIT_GAME_ID = `test-submit-${Date.now()}`

describe("submit flow", () => {
  before(async () => {
    await seedTestGame(SUBMIT_GAME_ID, TEST_USER_1.userId, TEST_USER_2.userId, testBugId, "active")
  })

  after(async () => {
    await cleanupTestGame(SUBMIT_GAME_ID)
  })

  test("GET /api/game/status returns active game with bug (no correctAnswer)", async () => {
    const req = authNextReq(`http://localhost/api/game/status?gameId=${SUBMIT_GAME_ID}`, TEST_USER_1.userId)
    const res = await getStatus(req)
    assert.equal(res.status, 200)
    const body = await res.json() as { game: { status: string }, bug: Record<string, unknown> }
    assert.equal(body.game.status, "active")
    assert.ok(body.bug, "bug should be present for active game")
    assert.equal(body.bug.correctAnswer, undefined, "correctAnswer must not be exposed during game")
  })

  test("POST /api/game/submit returns 401 without auth", async () => {
    const req = new NextRequest("http://localhost/api/game/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gameId: SUBMIT_GAME_ID, answer: 0 }),
    })
    const res = await submit(req)
    assert.equal(res.status, 401)
  })

  test("POST /api/game/submit accepts answer and returns correct boolean", async () => {
    const req = authNextReq("http://localhost/api/game/submit", TEST_USER_1.userId, "POST", { gameId: SUBMIT_GAME_ID, answer: 0 })
    const res = await submit(req)
    assert.ok([200, 409].includes(res.status), `expected 200 or 409, got ${res.status}`)
    if (res.status === 200) {
      const body = await res.json() as { correct: boolean }
      assert.equal(typeof body.correct, "boolean")
    }
  })

  test("POST /api/game/submit returns 409 on double-submit", async () => {
    // First submit (may already be done from previous test)
    const req1 = authNextReq("http://localhost/api/game/submit", TEST_USER_1.userId, "POST", { gameId: SUBMIT_GAME_ID, answer: 1 })
    await submit(req1) // ignore result — may be 200 or 409
    // Second submit must always be 409
    const req2 = authNextReq("http://localhost/api/game/submit", TEST_USER_1.userId, "POST", { gameId: SUBMIT_GAME_ID, answer: 2 })
    const res2 = await submit(req2)
    assert.equal(res2.status, 409)
  })
})
