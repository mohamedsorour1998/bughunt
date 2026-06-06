import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { NextRequest } from "next/server"
import { seedTestUsers, cleanupTestUsers } from "../helpers/db"
import { TEST_USER_1 } from "../helpers/fixtures"
import { GET as getToken, POST as generateToken, DELETE as revokeToken } from "../../src/app/api/user/token/route"

if (process.env.TEST_MODE !== "true") throw new Error("TEST_MODE=true required")

function authNextReq(url: string, userId: string, method = "GET", body?: unknown): NextRequest {
  return new NextRequest(url, {
    method,
    headers: { "Content-Type": "application/json", "x-test-user-id": userId },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

function anonNextReq(url: string, method = "GET"): NextRequest {
  return new NextRequest(url, { method, headers: { "Content-Type": "application/json" } })
}

before(async () => { await seedTestUsers() })
after(async () => { await cleanupTestUsers() })

// ---- GET /api/user/token ----

test("GET /api/user/token returns 401 without auth", async () => {
  const req = anonNextReq("http://localhost/api/user/token")
  const res = await getToken(req)
  assert.equal(res.status, 401)
})

test("GET /api/user/token returns token info for authed user", async () => {
  const req = authNextReq("http://localhost/api/user/token", TEST_USER_1.userId)
  const res = await getToken(req)
  assert.equal(res.status, 200)
  const body = await res.json() as Record<string, unknown>
  // Either created fresh (has token) or already exists (exists:true)
  assert.ok(body.token || body.exists, "should return token or exists:true")
})

// ---- POST /api/user/token (regenerate) ----

test("POST /api/user/token returns 401 without auth", async () => {
  const req = anonNextReq("http://localhost/api/user/token", "POST")
  const res = await generateToken(req)
  assert.equal(res.status, 401)
})

test("POST /api/user/token generates and returns a new token", async () => {
  const req = authNextReq("http://localhost/api/user/token", TEST_USER_1.userId, "POST")
  const res = await generateToken(req)
  assert.equal(res.status, 200)
  const body = await res.json() as { token: string }
  assert.ok(typeof body.token === "string" && body.token.length > 0, "should return a token string")
})

// ---- DELETE /api/user/token ----

test("DELETE /api/user/token returns 401 without auth", async () => {
  const req = anonNextReq("http://localhost/api/user/token", "DELETE")
  const res = await revokeToken(req)
  assert.equal(res.status, 401)
})

test("DELETE /api/user/token revokes token and returns {ok:true}", async () => {
  const req = authNextReq("http://localhost/api/user/token", TEST_USER_1.userId, "DELETE")
  const res = await revokeToken(req)
  assert.equal(res.status, 200)
  const body = await res.json() as { ok: boolean }
  assert.equal(body.ok, true)
})
