import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { NextRequest } from "next/server"
import { seedTestUsers, cleanupTestUsers, seedTestGame, cleanupTestGame, getFirstActiveBugId } from "../helpers/db"
import { TEST_USER_1, TEST_USER_2 } from "../helpers/fixtures"
import { POST as rematch } from "../../src/app/api/game/rematch/route"
import { GET as rematchStatus } from "../../src/app/api/game/rematch/status/route"
import { POST as privateGame } from "../../src/app/api/game/private/route"
import { POST as joinGame } from "../../src/app/api/game/join/[gameId]/route"

if (process.env.TEST_MODE !== "true") throw new Error("TEST_MODE=true required")

function authNextReq(url: string, userId: string, method = "GET", body?: unknown): NextRequest {
  return new NextRequest(url, {
    method,
    headers: { "Content-Type": "application/json", "x-test-user-id": userId },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

function anonNextReq(url: string, method = "GET", body?: unknown): NextRequest {
  return new NextRequest(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

let testBugId: string
const PRIVATE_GAME_ID = `test-private-${Date.now()}`

before(async () => {
  await seedTestUsers()
  testBugId = await getFirstActiveBugId()
})

after(async () => {
  await cleanupTestUsers()
  await cleanupTestGame(PRIVATE_GAME_ID)
})

// ---- rematch POST ----

test("POST /api/game/rematch returns 401 without auth", async () => {
  const req = anonNextReq("http://localhost/api/game/rematch", "POST", { opponentId: TEST_USER_2.userId })
  const res = await rematch(req)
  assert.equal(res.status, 401)
})

test("POST /api/game/rematch returns 400 for missing opponentId", async () => {
  const req = authNextReq("http://localhost/api/game/rematch", TEST_USER_1.userId, "POST", {})
  const res = await rematch(req)
  assert.equal(res.status, 400)
})

test("POST /api/game/rematch returns 400 when rematching self", async () => {
  const req = authNextReq("http://localhost/api/game/rematch", TEST_USER_1.userId, "POST", { opponentId: TEST_USER_1.userId })
  const res = await rematch(req)
  assert.equal(res.status, 400)
})

test("POST /api/game/rematch returns {rematching:true} for valid request", async () => {
  const req = authNextReq("http://localhost/api/game/rematch", TEST_USER_1.userId, "POST", { opponentId: TEST_USER_2.userId })
  const res = await rematch(req)
  assert.equal(res.status, 200)
  const body = await res.json() as { rematching: boolean; status: string }
  assert.equal(body.rematching, true)
  assert.equal(body.status, "pending")
})

// ---- rematch/status GET ----

test("GET /api/game/rematch/status returns 401 without auth", async () => {
  const req = anonNextReq("http://localhost/api/game/rematch/status?opponentId=xyz")
  const res = await rematchStatus(req)
  assert.equal(res.status, 401)
})

test("GET /api/game/rematch/status returns 400 without opponentId", async () => {
  const req = authNextReq("http://localhost/api/game/rematch/status", TEST_USER_1.userId)
  const res = await rematchStatus(req)
  assert.equal(res.status, 400)
})

test("GET /api/game/rematch/status returns expired when no mutual rematch", async () => {
  const req = authNextReq("http://localhost/api/game/rematch/status?opponentId=nonexistent-xyz", TEST_USER_1.userId)
  const res = await rematchStatus(req)
  assert.ok([200, 400].includes(res.status))
  if (res.status === 200) {
    const body = await res.json() as { status: string }
    assert.ok(["expired", "pending"].includes(body.status))
  }
})

// ---- game/private POST ----

test("POST /api/game/private returns 401 without auth", async () => {
  const req = anonNextReq("http://localhost/api/game/private", "POST")
  const res = await privateGame(req)
  assert.equal(res.status, 401)
})

test("POST /api/game/private creates a private game with joinUrl", async () => {
  const req = authNextReq("http://localhost/api/game/private", TEST_USER_1.userId, "POST")
  const res = await privateGame(req)
  assert.ok([200, 404].includes(res.status), `expected 200 or 404 (no bugs), got ${res.status}`)
  if (res.status === 200) {
    const body = await res.json() as { gameId: string; joinUrl: string }
    assert.ok(body.gameId, "should return gameId")
    assert.ok(body.joinUrl.includes(body.gameId), "joinUrl should contain gameId")
  }
})

// ---- game/join/[gameId] POST ----

test("POST /api/game/join/[gameId] returns 401 without auth", async () => {
  const req = anonNextReq("http://localhost/api/game/join/nonexistent", "POST")
  const res = await joinGame(req, { params: Promise.resolve({ gameId: "nonexistent" }) })
  assert.equal(res.status, 401)
})

test("POST /api/game/join/[gameId] returns 404 for nonexistent game", async () => {
  const req = authNextReq("http://localhost/api/game/join/nonexistent-xyz", TEST_USER_2.userId, "POST")
  const res = await joinGame(req, { params: Promise.resolve({ gameId: "nonexistent-xyz" }) })
  assert.equal(res.status, 404)
})

test("POST /api/game/join/[gameId] returns 400 for non-private game", async () => {
  await seedTestGame(PRIVATE_GAME_ID, TEST_USER_1.userId, TEST_USER_2.userId, testBugId, "active")
  const req = authNextReq(`http://localhost/api/game/join/${PRIVATE_GAME_ID}`, TEST_USER_2.userId, "POST")
  const res = await joinGame(req, { params: Promise.resolve({ gameId: PRIVATE_GAME_ID }) })
  assert.equal(res.status, 400)
})
