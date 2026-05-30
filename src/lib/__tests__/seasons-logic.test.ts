// seasons-logic.test.ts — tests for getDaysRemaining
import { getDaysRemaining } from "../seasons"
import type { Season } from "../seasons"

function test(name: string, fn: () => void) {
  try {
    fn()
    console.log("✓", name)
  } catch (e) {
    console.error("✗", name, e)
    process.exit(1)
  }
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg)
}

function makeSeason(endDate: string): Season {
  return {
    seasonId: "test-season",
    seasonNumber: 1,
    name: "Test Season",
    startDate: "2024-01-01",
    endDate,
    status: "active",
  }
}

test("future end date (year 2099) → positive integer", () => {
  const season = makeSeason("2099-12-31")
  const result = getDaysRemaining(season)
  assert(result > 0, `Expected positive days remaining, got ${result}`)
  assert(Number.isInteger(result), `Expected integer, got ${result}`)
})

test("past end date (year 2020) → 0 (never negative)", () => {
  const season = makeSeason("2020-01-01")
  const result = getDaysRemaining(season)
  assert(result === 0, `Expected 0 for past season, got ${result}`)
})

test("today as end date → 0 or 1 (boundary)", () => {
  const today = new Date()
  const yyyy = today.getUTCFullYear()
  const mm = String(today.getUTCMonth() + 1).padStart(2, "0")
  const dd = String(today.getUTCDate()).padStart(2, "0")
  const todayStr = `${yyyy}-${mm}-${dd}`
  const season = makeSeason(todayStr)
  const result = getDaysRemaining(season)
  assert(result >= 0 && result <= 1, `Expected 0 or 1 for today boundary, got ${result}`)
})

console.log("\nAll seasons-logic tests passed!")
