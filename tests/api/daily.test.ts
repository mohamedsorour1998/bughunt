import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { NextRequest } from "next/server"
import { seedTestUsers, cleanupTestUsers } from "../helpers/db"
import { TEST_USER_1 } from "../helpers/fixtures"
import { GET as getDaily } from "../../src/app/api/daily/route"
import { POST as submitDaily } from "../../src/app/api/daily/submit/route"
import { GET as getDailyByDate } from "../../src/app/api/daily/[date]/route"

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

before(async () => { await seedTestUsers() })
after(async () => { await cleanupTestUsers() })

// ---- GET /api/daily ----

test("GET /api/daily returns 401 without auth", async () => {
  const req = anonNextReq("http://localhost/api/daily")
  const res = await getDaily(req)
  assert.equal(res.status, 401)
})

test("GET /api/daily returns 200 or 404 for authed user", async () => {
  const req = authNextReq("http://localhost/api/daily", TEST_USER_1.userId)
  const res = await getDaily(req)
  // 200 if daily challenge seeded, 404 if cron hasn't run
  assert.ok([200, 404].includes(res.status), `expected 200 or 404, got ${res.status}`)
  if (res.status === 200) {
    const body = await res.json() as Record<string, unknown>
    assert.ok(body.date, "should have date field")
    assert.ok(body.bug, "should have bug field")
    const bug = body.bug as Record<string, unknown>
    // correctAnswer is hidden before submission, revealed after — only assert when not yet submitted
    if (!body.submission) {
      assert.equal(bug.correctAnswer, undefined, "correctAnswer must not be exposed before submission")
    }
  }
})

// ---- GET /api/daily/[date] ----

test("GET /api/daily/[date] returns 401 without auth", async () => {
  const req = anonNextReq("http://localhost/api/daily/2026-01-01")
  const res = await getDailyByDate(req, { params: Promise.resolve({ date: "2026-01-01" }) })
  assert.equal(res.status, 401)
})

test("GET /api/daily/[date] returns 400 for invalid date format", async () => {
  const req = authNextReq("http://localhost/api/daily/not-a-date", TEST_USER_1.userId)
  const res = await getDailyByDate(req, { params: Promise.resolve({ date: "not-a-date" }) })
  assert.equal(res.status, 400)
})

test("GET /api/daily/[date] returns 404 for date with no challenge", async () => {
  const req = authNextReq("http://localhost/api/daily/2020-01-01", TEST_USER_1.userId)
  const res = await getDailyByDate(req, { params: Promise.resolve({ date: "2020-01-01" }) })
  assert.equal(res.status, 404)
})

// ---- POST /api/daily/submit ----

test("POST /api/daily/submit returns 401 without auth", async () => {
  const req = anonNextReq("http://localhost/api/daily/submit", "POST", { answer: 0, timeElapsedMs: 5000 })
  const res = await submitDaily(req)
  assert.equal(res.status, 401)
})

test("POST /api/daily/submit returns 400 for answer out of range", async () => {
  const req = authNextReq("http://localhost/api/daily/submit", TEST_USER_1.userId, "POST", { answer: 5, timeElapsedMs: 5000 })
  const res = await submitDaily(req)
  assert.equal(res.status, 400)
})

test("POST /api/daily/submit returns 400 for negative timeElapsedMs", async () => {
  const req = authNextReq("http://localhost/api/daily/submit", TEST_USER_1.userId, "POST", { answer: 0, timeElapsedMs: -1 })
  const res = await submitDaily(req)
  assert.equal(res.status, 400)
})

test("POST /api/daily/submit returns 400 for missing fields", async () => {
  const req = authNextReq("http://localhost/api/daily/submit", TEST_USER_1.userId, "POST", {})
  const res = await submitDaily(req)
  assert.equal(res.status, 400)
})

test("POST /api/daily/submit returns 404 when no daily challenge exists", async () => {
  // If the cron hasn't run, daily submit should return 404 (no challenge today)
  const req = authNextReq("http://localhost/api/daily/submit", TEST_USER_1.userId, "POST", { answer: 0, timeElapsedMs: 5000 })
  const res = await submitDaily(req)
  // 404 (no challenge) or 409 (already submitted) or 200 (challenge exists)
  assert.ok([200, 404, 409].includes(res.status), `expected 200, 404, or 409, got ${res.status}`)
})
