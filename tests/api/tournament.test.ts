import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { NextRequest } from "next/server"
import { seedTestUsers, cleanupTestUsers } from "../helpers/db"
import { TEST_USER_1 } from "../helpers/fixtures"
import { GET as getTournaments } from "../../src/app/api/tournaments/route"
import { GET as getTournament } from "../../src/app/api/tournaments/[id]/route"
import { POST as registerForTournament } from "../../src/app/api/tournaments/[id]/register/route"

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

// ---- GET /api/tournaments (public) ----

test("GET /api/tournaments returns tournaments array", async () => {
  const res = await getTournaments()
  assert.equal(res.status, 200)
  const body = await res.json() as { tournaments: unknown[] }
  assert.ok(Array.isArray(body.tournaments), "tournaments should be array")
})

// ---- GET /api/tournaments/[id] ----

test("GET /api/tournaments/[id] returns 404 for nonexistent tournament", async () => {
  const res = await getTournament(new NextRequest("http://localhost/api/tournaments/nonexistent"), {
    params: Promise.resolve({ id: "nonexistent-tournament-xyz" }),
  })
  assert.equal(res.status, 404)
})

// ---- POST /api/tournaments/[id]/register ----

test("POST /api/tournaments/[id]/register returns 401 without auth", async () => {
  const req = anonNextReq("http://localhost/api/tournaments/test-id/register", "POST")
  const res = await registerForTournament(req, { params: Promise.resolve({ id: "test-id" }) })
  assert.equal(res.status, 401)
})

// Note: registerForTournament uses safeAuth() only (no x-test-user-id fallback),
// so all authed paths require a real session and cannot be tested in TEST_MODE.
