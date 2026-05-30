// bugs-logic.test.ts — tests for difficulty mapping formula
// Formula: Math.min(5, Math.ceil(avgElo / 400))

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

function targetDifficulty(avgElo: number): number {
  return Math.min(5, Math.ceil(avgElo / 400))
}

test("elo=1 → difficulty 1", () => {
  assert(targetDifficulty(1) === 1, `Expected 1, got ${targetDifficulty(1)}`)
})
test("elo=400 → difficulty 1", () => {
  assert(targetDifficulty(400) === 1, `Expected 1, got ${targetDifficulty(400)}`)
})
test("elo=401 → difficulty 2", () => {
  assert(targetDifficulty(401) === 2, `Expected 2, got ${targetDifficulty(401)}`)
})
test("elo=800 → difficulty 2", () => {
  assert(targetDifficulty(800) === 2, `Expected 2, got ${targetDifficulty(800)}`)
})
test("elo=801 → difficulty 3", () => {
  assert(targetDifficulty(801) === 3, `Expected 3, got ${targetDifficulty(801)}`)
})
test("elo=1200 → difficulty 3", () => {
  assert(targetDifficulty(1200) === 3, `Expected 3, got ${targetDifficulty(1200)}`)
})
test("elo=1201 → difficulty 4", () => {
  assert(targetDifficulty(1201) === 4, `Expected 4, got ${targetDifficulty(1201)}`)
})
test("elo=1600 → difficulty 4", () => {
  assert(targetDifficulty(1600) === 4, `Expected 4, got ${targetDifficulty(1600)}`)
})
test("elo=1601 → difficulty 5", () => {
  assert(targetDifficulty(1601) === 5, `Expected 5, got ${targetDifficulty(1601)}`)
})
test("elo=2000 → difficulty 5", () => {
  assert(targetDifficulty(2000) === 5, `Expected 5, got ${targetDifficulty(2000)}`)
})
test("elo=9999 → difficulty 5 (capped)", () => {
  assert(targetDifficulty(9999) === 5, `Expected 5, got ${targetDifficulty(9999)}`)
})

console.log("\nAll bugs-logic tests passed!")
