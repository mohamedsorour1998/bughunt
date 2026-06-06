import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { NextRequest } from "next/server"
import { seedTestUsers, cleanupTestUsers } from "../helpers/db"
import { TEST_USER_1, TEST_USER_2 } from "../helpers/fixtures"
import { POST as follow } from "../../src/app/api/social/follow/route"
import { GET as getFollowing } from "../../src/app/api/social/following/route"
import { GET as getFollowers } from "../../src/app/api/social/followers/route"
import { GET as getFeed } from "../../src/app/api/social/feed/route"
import { POST as sendChallenge } from "../../src/app/api/social/challenge/route"
import { GET as getPendingChallenges } from "../../src/app/api/social/challenges/pending/route"
import { POST as respondChallenge } from "../../src/app/api/social/challenge/respond/route"

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

// ---- POST /api/social/follow ----

test("POST /api/social/follow returns 401 without auth", async () => {
  const req = anonNextReq("http://localhost/api/social/follow", "POST", { followeeId: TEST_USER_2.userId })
  const res = await follow(req)
  assert.equal(res.status, 401)
})

test("POST /api/social/follow returns 400 for missing followeeId", async () => {
  const req = authNextReq("http://localhost/api/social/follow", TEST_USER_1.userId, "POST", {})
  const res = await follow(req)
  assert.equal(res.status, 400)
})

test("POST /api/social/follow returns 400 when following self", async () => {
  const req = authNextReq("http://localhost/api/social/follow", TEST_USER_1.userId, "POST", { followeeId: TEST_USER_1.userId })
  const res = await follow(req)
  assert.equal(res.status, 400)
})

test("POST /api/social/follow returns 404 for nonexistent user", async () => {
  const req = authNextReq("http://localhost/api/social/follow", TEST_USER_1.userId, "POST", { followeeId: "nonexistent-xyz" })
  const res = await follow(req)
  assert.equal(res.status, 404)
})

test("POST /api/social/follow succeeds and returns {ok:true}", async () => {
  const req = authNextReq("http://localhost/api/social/follow", TEST_USER_1.userId, "POST", { followeeId: TEST_USER_2.userId })
  const res = await follow(req)
  assert.equal(res.status, 200)
  const body = await res.json() as { ok: boolean }
  assert.equal(body.ok, true)
})

// ---- GET /api/social/following ----

test("GET /api/social/following returns 401 without auth", async () => {
  const req = anonNextReq("http://localhost/api/social/following")
  const res = await getFollowing(req)
  assert.equal(res.status, 401)
})

test("GET /api/social/following returns following array", async () => {
  const req = authNextReq("http://localhost/api/social/following", TEST_USER_1.userId)
  const res = await getFollowing(req)
  assert.equal(res.status, 200)
  const body = await res.json() as { following: unknown[] }
  assert.ok(Array.isArray(body.following))
})

// ---- GET /api/social/followers ----

test("GET /api/social/followers returns 401 without auth", async () => {
  const req = anonNextReq("http://localhost/api/social/followers")
  const res = await getFollowers(req)
  assert.equal(res.status, 401)
})

test("GET /api/social/followers returns followers array", async () => {
  const req = authNextReq("http://localhost/api/social/followers", TEST_USER_2.userId)
  const res = await getFollowers(req)
  assert.equal(res.status, 200)
  const body = await res.json() as { followers: unknown[] }
  assert.ok(Array.isArray(body.followers))
})

// ---- GET /api/social/feed ----

test("GET /api/social/feed returns 401 without auth", async () => {
  const req = anonNextReq("http://localhost/api/social/feed")
  const res = await getFeed(req)
  assert.equal(res.status, 401)
})

test("GET /api/social/feed returns feed array", async () => {
  const req = authNextReq("http://localhost/api/social/feed", TEST_USER_1.userId)
  const res = await getFeed(req)
  assert.equal(res.status, 200)
  const body = await res.json() as { feed: unknown[] }
  assert.ok(Array.isArray(body.feed))
})

// ---- POST /api/social/challenge ----

test("POST /api/social/challenge returns 401 without auth", async () => {
  const req = anonNextReq("http://localhost/api/social/challenge", "POST", { challengedId: TEST_USER_2.userId })
  const res = await sendChallenge(req)
  assert.equal(res.status, 401)
})

test("POST /api/social/challenge returns 400 for invalid challengedId", async () => {
  const req = authNextReq("http://localhost/api/social/challenge", TEST_USER_1.userId, "POST", {})
  const res = await sendChallenge(req)
  assert.equal(res.status, 400)
})

test("POST /api/social/challenge returns 400 when challenging self", async () => {
  const req = authNextReq("http://localhost/api/social/challenge", TEST_USER_1.userId, "POST", { challengedId: TEST_USER_1.userId })
  const res = await sendChallenge(req)
  assert.equal(res.status, 400)
})

test("POST /api/social/challenge returns {challengeId} for valid request", async () => {
  const req = authNextReq("http://localhost/api/social/challenge", TEST_USER_1.userId, "POST", { challengedId: TEST_USER_2.userId })
  const res = await sendChallenge(req)
  assert.equal(res.status, 200)
  const body = await res.json() as { challengeId: string }
  assert.ok(typeof body.challengeId === "string" && body.challengeId.length > 0)
})

// ---- GET /api/social/challenges/pending ----

test("GET /api/social/challenges/pending returns 401 without auth", async () => {
  const req = anonNextReq("http://localhost/api/social/challenges/pending")
  const res = await getPendingChallenges(req)
  assert.equal(res.status, 401)
})

test("GET /api/social/challenges/pending returns challenges array", async () => {
  const req = authNextReq("http://localhost/api/social/challenges/pending", TEST_USER_1.userId)
  const res = await getPendingChallenges(req)
  assert.equal(res.status, 200)
  const body = await res.json() as { challenges: unknown[] }
  assert.ok(Array.isArray(body.challenges), "challenges should be array")
})

// ---- POST /api/social/challenge/respond ----

test("POST /api/social/challenge/respond returns 401 without auth", async () => {
  const req = anonNextReq("http://localhost/api/social/challenge/respond", "POST", { challengeId: "abc", action: "accept" })
  const res = await respondChallenge(req)
  assert.equal(res.status, 401)
})

test("POST /api/social/challenge/respond returns 400 for invalid action", async () => {
  const req = authNextReq("http://localhost/api/social/challenge/respond", TEST_USER_2.userId, "POST", { challengeId: "abc", action: "invalid" })
  const res = await respondChallenge(req)
  assert.equal(res.status, 400)
})

test("POST /api/social/challenge/respond returns 404 for nonexistent challenge", async () => {
  const req = authNextReq("http://localhost/api/social/challenge/respond", TEST_USER_2.userId, "POST", { challengeId: "nonexistent-xyz", action: "decline" })
  const res = await respondChallenge(req)
  assert.equal(res.status, 404)
})
