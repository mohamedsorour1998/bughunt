// Plain tsx assertion script (matches src/lib/__tests__ style).
import { shouldProcessImage } from "./index"

function test(name: string, fn: () => void) {
  try {
    fn()
    console.log("✓", name)
  } catch (e) {
    console.error("✗", name, e)
    process.exit(1)
  }
}

function expect(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg)
}

const base = { sk: "META", status: "completed", p1EloAfter: 1216, p1EloBefore: 1200, affectsElo: true }

test("processes the final resolve update (META + completed + p1EloAfter)", () => {
  expect(shouldProcessImage(base) === true, "should process")
})

test("skips non-META items", () => {
  expect(shouldProcessImage({ ...base, sk: "PLAYER#u1" }) === false, "should skip")
})

test("skips non-completed status", () => {
  expect(shouldProcessImage({ ...base, status: "active" }) === false, "should skip")
})

test("skips the early status-flip update that lacks Elo fields", () => {
  const { p1EloAfter: _omit, ...withoutElo } = base
  expect(shouldProcessImage(withoutElo) === false, "should skip until p1EloAfter present")
})

test("skips private games (affectsElo=false)", () => {
  expect(shouldProcessImage({ ...base, affectsElo: false }) === false, "should skip private")
})

console.log("All leaderboard-lambda predicate tests passed!")
