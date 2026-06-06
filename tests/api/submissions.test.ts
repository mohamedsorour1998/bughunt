import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { NextRequest } from "next/server"
import { seedTestUsers, cleanupTestUsers, getFirstActiveBugId } from "../helpers/db"
import { TEST_USER_1 } from "../helpers/fixtures"
import { POST as submitBug } from "../../src/app/api/bugs/submit/route"
import { GET as getMySubmissions } from "../../src/app/api/bugs/my-submissions/route"
import { POST as rateBug } from "../../src/app/api/bugs/[id]/rate/route"

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

before(async () => {
  await seedTestUsers()
  testBugId = await getFirstActiveBugId()
})

after(async () => { await cleanupTestUsers() })

const validSubmission = {
  language: "javascript",
  category: "logic",
  difficulty: 2,
  buggyCode: 'function add(a, b) { return a - b; }',
  correctCode: 'function add(a, b) { return a + b; }',
  bugLine: 1,
  options: ["Return type is wrong", "Should use + not -", "Missing return statement", "Wrong parameter names"],
  correctAnswer: 1,
  explanation: "The function subtracts instead of adding.",
  hint: "Look at the operator.",
}

// ---- POST /api/bugs/submit ----

test("POST /api/bugs/submit returns 401 without auth", async () => {
  const req = anonNextReq("http://localhost/api/bugs/submit", "POST", validSubmission)
  const res = await submitBug(req)
  assert.equal(res.status, 401)
})

test("POST /api/bugs/submit returns 400 for missing required fields", async () => {
  const req = authNextReq("http://localhost/api/bugs/submit", TEST_USER_1.userId, "POST", { language: "js" })
  const res = await submitBug(req)
  assert.equal(res.status, 400)
})

test("POST /api/bugs/submit returns 400 for correctAnswer out of range", async () => {
  const body = { ...validSubmission, correctAnswer: 5 }
  const req = authNextReq("http://localhost/api/bugs/submit", TEST_USER_1.userId, "POST", body)
  const res = await submitBug(req)
  assert.equal(res.status, 400)
})

test("POST /api/bugs/submit returns 400 for options not length 4", async () => {
  const body = { ...validSubmission, options: ["a", "b"] }
  const req = authNextReq("http://localhost/api/bugs/submit", TEST_USER_1.userId, "POST", body)
  const res = await submitBug(req)
  assert.equal(res.status, 400)
})

test("POST /api/bugs/submit accepts valid submission (200 or 429)", async () => {
  const req = authNextReq("http://localhost/api/bugs/submit", TEST_USER_1.userId, "POST", validSubmission)
  const res = await submitBug(req)
  // 200 on success, 429 if rate limited, 503 if Bedrock unavailable
  assert.ok([200, 429, 503].includes(res.status), `expected 200, 429, or 503, got ${res.status}`)
})

// ---- GET /api/bugs/my-submissions ----

test("GET /api/bugs/my-submissions returns 401 without auth", async () => {
  const req = anonNextReq("http://localhost/api/bugs/my-submissions")
  const res = await getMySubmissions(req)
  assert.equal(res.status, 401)
})

test("GET /api/bugs/my-submissions returns submissions array", async () => {
  const req = authNextReq("http://localhost/api/bugs/my-submissions", TEST_USER_1.userId)
  const res = await getMySubmissions(req)
  assert.equal(res.status, 200)
  const body = await res.json() as { submissions: unknown[] }
  assert.ok(Array.isArray(body.submissions), "submissions should be array")
})

// ---- POST /api/bugs/[id]/rate ----

test("POST /api/bugs/[id]/rate returns 401 without auth", async () => {
  const req = anonNextReq(`http://localhost/api/bugs/${testBugId}/rate`, "POST", { rating: 2 })
  const res = await rateBug(req, { params: Promise.resolve({ id: testBugId }) })
  assert.equal(res.status, 401)
})

test("POST /api/bugs/[id]/rate returns 400 for invalid rating (0)", async () => {
  const req = authNextReq(`http://localhost/api/bugs/${testBugId}/rate`, TEST_USER_1.userId, "POST", { rating: 0 })
  const res = await rateBug(req, { params: Promise.resolve({ id: testBugId }) })
  assert.equal(res.status, 400)
})

test("POST /api/bugs/[id]/rate returns 400 for invalid rating (4)", async () => {
  const req = authNextReq(`http://localhost/api/bugs/${testBugId}/rate`, TEST_USER_1.userId, "POST", { rating: 4 })
  const res = await rateBug(req, { params: Promise.resolve({ id: testBugId }) })
  assert.equal(res.status, 400)
})

test("POST /api/bugs/[id]/rate accepts valid rating (1-3)", async () => {
  const req = authNextReq(`http://localhost/api/bugs/${testBugId}/rate`, TEST_USER_1.userId, "POST", { rating: 2 })
  const res = await rateBug(req, { params: Promise.resolve({ id: testBugId }) })
  // 200 on first rating, 409 if already rated
  assert.ok([200, 409].includes(res.status), `expected 200 or 409, got ${res.status}`)
  if (res.status === 200) {
    const body = await res.json() as { ok: boolean }
    assert.equal(body.ok, true)
  }
})
