import { test } from "node:test"
import assert from "node:assert/strict"
import { GET as checkAdmin } from "../../src/app/api/admin/check/route"
import { GET as getPendingBugs, POST as createBug } from "../../src/app/api/admin/bugs/route"

if (process.env.TEST_MODE !== "true") throw new Error("TEST_MODE=true required")

test("GET /api/admin/check returns isAdmin:false for unauthenticated user", async () => {
  // With auth mock returning null, should return false
  const res = await checkAdmin()
  assert.equal(res.status, 200)
  const body = await res.json() as { isAdmin: boolean }
  assert.equal(body.isAdmin, false)
})

test("GET /api/admin/bugs returns 401/403 for unauthenticated user", async () => {
  const res = await getPendingBugs()
  assert.ok([401, 403].includes(res.status), `expected 401 or 403, got ${res.status}`)
})

test("POST /api/admin/bugs returns 401/403 for unauthenticated user", async () => {
  const req = new Request("http://localhost/api/admin/bugs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ language: "python", category: "test", difficulty: 1 }),
  })
  const res = await createBug(req as never)
  assert.ok([401, 403].includes(res.status), `expected 401 or 403, got ${res.status}`)
})
