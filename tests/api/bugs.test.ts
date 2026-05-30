import { test } from "node:test"
import assert from "node:assert/strict"
import { GET as getRandom } from "../../src/app/api/bugs/random/route"

if (process.env.TEST_MODE !== "true") throw new Error("TEST_MODE=true required")

test("GET /api/bugs/random returns 200 with a bug", async () => {
  const req = new Request("http://localhost/api/bugs/random")
  const res = await getRandom(req as never)
  assert.equal(res.status, 200)
  const body = await res.json() as Record<string, unknown>
  assert.ok(body.bugId, "bugId should be present")
  assert.ok(body.buggyCode, "buggyCode should be present")
  assert.ok(Array.isArray(body.options) && (body.options as unknown[]).length === 4, "should have 4 options")
})

test("GET /api/bugs/random does NOT expose correctAnswer", async () => {
  const req = new Request("http://localhost/api/bugs/random")
  const res = await getRandom(req as never)
  assert.equal(res.status, 200)
  const body = await res.json() as Record<string, unknown>
  assert.equal(body.correctAnswer, undefined, "correctAnswer must not be in response")
})

test("GET /api/bugs/random?difficulty=3 returns a difficulty-3 bug", async () => {
  const req = new Request("http://localhost/api/bugs/random?difficulty=3")
  const res = await getRandom(req as never)
  assert.equal(res.status, 200)
  const body = await res.json() as { difficulty: number }
  assert.equal(body.difficulty, 3)
})
