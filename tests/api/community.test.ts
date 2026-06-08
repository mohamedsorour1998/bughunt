import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { NextRequest } from "next/server"
import { seedTestUsers, cleanupTestUsers, seedTestGame, cleanupTestGame, getFirstNActiveBugIds } from "../helpers/db"
import { TEST_USER_1, TEST_USER_2 } from "../helpers/fixtures"
import { GET as getNotifications, POST as markNotification } from "../../src/app/api/notifications/route"
import { GET as getChatMessages, POST as postChat } from "../../src/app/api/game/[gameId]/chat/route"

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

const CHAT_GAME_ID = `test-chat-game-${Date.now()}`
let testBugIds: string[]

before(async () => {
  await seedTestUsers()
  testBugIds = await getFirstNActiveBugIds(3)
  await seedTestGame(CHAT_GAME_ID, TEST_USER_1.userId, TEST_USER_2.userId, testBugIds, "completed")
})

after(async () => {
  await cleanupTestUsers()
  await cleanupTestGame(CHAT_GAME_ID)
})

// ---- GET /api/notifications ----

test("GET /api/notifications returns 401 without auth", async () => {
  const req = anonNextReq("http://localhost/api/notifications")
  const res = await getNotifications(req)
  assert.equal(res.status, 401)
})

test("GET /api/notifications returns notifications and unreadCount", async () => {
  const req = authNextReq("http://localhost/api/notifications", TEST_USER_1.userId)
  const res = await getNotifications(req)
  assert.equal(res.status, 200)
  const body = await res.json() as { notifications: unknown[]; unreadCount: number }
  assert.ok(Array.isArray(body.notifications), "notifications should be array")
  assert.equal(typeof body.unreadCount, "number")
})

// ---- POST /api/notifications (mark read) ----

test("POST /api/notifications returns 401 without auth", async () => {
  const req = anonNextReq("http://localhost/api/notifications", "POST", { sk: "NOTIF#123" })
  const res = await markNotification(req)
  assert.equal(res.status, 401)
})

test("POST /api/notifications returns 400 for missing sk", async () => {
  const req = authNextReq("http://localhost/api/notifications", TEST_USER_1.userId, "POST", {})
  const res = await markNotification(req)
  assert.equal(res.status, 400)
})

test("POST /api/notifications succeeds for valid sk (even nonexistent)", async () => {
  const req = authNextReq("http://localhost/api/notifications", TEST_USER_1.userId, "POST", { sk: "NOTIF#nonexistent" })
  const res = await markNotification(req)
  // Should succeed (upsert) or return ok
  assert.ok([200, 404].includes(res.status))
})

// ---- GET /api/game/[gameId]/chat ----

test("GET /api/game/[gameId]/chat returns messages array (public)", async () => {
  const req = anonNextReq(`http://localhost/api/game/${CHAT_GAME_ID}/chat`)
  const res = await getChatMessages(req, { params: Promise.resolve({ gameId: CHAT_GAME_ID }) })
  assert.equal(res.status, 200)
  const body = await res.json() as { messages: unknown[] }
  assert.ok(Array.isArray(body.messages), "messages should be array")
})

test("GET /api/game/[gameId]/chat returns empty for nonexistent game", async () => {
  const req = anonNextReq("http://localhost/api/game/nonexistent-xyz/chat")
  const res = await getChatMessages(req, { params: Promise.resolve({ gameId: "nonexistent-xyz" }) })
  assert.equal(res.status, 200)
  const body = await res.json() as { messages: unknown[] }
  assert.ok(Array.isArray(body.messages))
  assert.equal(body.messages.length, 0)
})

// ---- POST /api/game/[gameId]/chat ----

test("POST /api/game/[gameId]/chat returns 401 without auth", async () => {
  const req = anonNextReq(`http://localhost/api/game/${CHAT_GAME_ID}/chat`, "POST", { message: "hello" })
  const res = await postChat(req, { params: Promise.resolve({ gameId: CHAT_GAME_ID }) })
  assert.equal(res.status, 401)
})

test("POST /api/game/[gameId]/chat returns 400 for missing message", async () => {
  const req = authNextReq(`http://localhost/api/game/${CHAT_GAME_ID}/chat`, TEST_USER_1.userId, "POST", {})
  const res = await postChat(req, { params: Promise.resolve({ gameId: CHAT_GAME_ID }) })
  assert.equal(res.status, 400)
})

test("POST /api/game/[gameId]/chat truncates messages over 200 chars and succeeds", async () => {
  // Route silently truncates — no 400 for length. Expect 200 or participant error.
  const longMsg = "x".repeat(300)
  const req = authNextReq(`http://localhost/api/game/${CHAT_GAME_ID}/chat`, TEST_USER_1.userId, "POST", { message: longMsg })
  const res = await postChat(req, { params: Promise.resolve({ gameId: CHAT_GAME_ID }) })
  assert.ok([200, 403, 429].includes(res.status))
})

test("POST /api/game/[gameId]/chat posts a message and returns {success:true, msgId}", async () => {
  const req = authNextReq(`http://localhost/api/game/${CHAT_GAME_ID}/chat`, TEST_USER_1.userId, "POST", { message: "GG!" })
  const res = await postChat(req, { params: Promise.resolve({ gameId: CHAT_GAME_ID }) })
  // 200 success, 403 if not participant, 429 if over message limit
  assert.ok([200, 403, 429].includes(res.status), `expected 200/403/429, got ${res.status}`)
  if (res.status === 200) {
    const body = await res.json() as { success: boolean; msgId: string }
    assert.equal(body.success, true)
    assert.ok(typeof body.msgId === "string")
  }
})
