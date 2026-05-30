import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { NextRequest } from "next/server"
import { seedTestUsers, cleanupTestUsers } from "../helpers/db"
import { TEST_USER_1 } from "../helpers/fixtures"
import { GET as getProfile } from "../../src/app/api/user/profile/route"
import { GET as getPublicProfile } from "../../src/app/api/user/profile/[userId]/route"
import { GET as getHistory } from "../../src/app/api/user/history/route"

// TEST_MODE is set via the npm script / shell env prefix before this module loads.
// If running directly, ensure TEST_MODE=true is exported.
if (process.env.TEST_MODE !== "true") {
  throw new Error("TEST_MODE must be 'true' to run API tests")
}

// Helper: authenticated plain Request (for routes that take Request)
function authReq(url: string, userId: string): Request {
  return new Request(url, { headers: { "x-test-user-id": userId } })
}

// Helper: authenticated NextRequest (for routes that use request.nextUrl)
function authNextReq(url: string, userId: string): NextRequest {
  return new NextRequest(url, { headers: { "x-test-user-id": userId } })
}

before(async () => { await seedTestUsers() })
after(async () => { await cleanupTestUsers() })

// ---- Tests ----

test("GET /api/user/profile returns 401 without auth", async () => {
  const req = new Request("http://localhost/api/user/profile")
  const res = await getProfile(req)
  assert.equal(res.status, 401)
})

test("GET /api/user/profile/[userId] returns public profile (no email)", async () => {
  const req = new Request(`http://localhost/api/user/profile/${TEST_USER_1.userId}`)
  const res = await getPublicProfile(req, { params: Promise.resolve({ userId: TEST_USER_1.userId }) })
  assert.equal(res.status, 200)
  const body = await res.json() as Record<string, unknown>
  assert.equal(body.displayName, TEST_USER_1.displayName)
  assert.equal(body.elo, TEST_USER_1.elo)
  assert.equal(body.email, undefined, "email must not be in public profile")
})

test("GET /api/user/profile/[userId] returns 404 for nonexistent user", async () => {
  const req = new Request("http://localhost/api/user/profile/nonexistent-user-xyz-abc")
  const res = await getPublicProfile(req, { params: Promise.resolve({ userId: "nonexistent-user-xyz-abc" }) })
  assert.equal(res.status, 404)
})

test("GET /api/user/history returns 401 without auth", async () => {
  const req = new NextRequest("http://localhost/api/user/history")
  const res = await getHistory(req)
  assert.equal(res.status, 401)
})

test("GET /api/user/history returns entries array for authed user", async () => {
  const req = authNextReq("http://localhost/api/user/history", TEST_USER_1.userId)
  const res = await getHistory(req)
  assert.equal(res.status, 200)
  const body = await res.json() as { entries: unknown[] }
  assert.ok(Array.isArray(body.entries), "entries should be an array")
})

test("GET /api/user/profile returns full profile for authed user", async () => {
  const req = authReq("http://localhost/api/user/profile", TEST_USER_1.userId)
  const res = await getProfile(req)
  assert.equal(res.status, 200)
  const body = await res.json() as Record<string, unknown>
  assert.equal(body.userId, TEST_USER_1.userId)
  assert.equal(body.email, TEST_USER_1.email, "own profile should include email")
})
