// rank.test.ts — tests for getRankFromElo rank boundary logic
import { getRankFromElo } from "../users"

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

// Bronze: elo < 1000
test("elo 0 → Bronze", () => {
  assert(getRankFromElo(0) === "Bronze", `Expected Bronze, got ${getRankFromElo(0)}`)
})
test("elo 999 → Bronze", () => {
  assert(getRankFromElo(999) === "Bronze", `Expected Bronze, got ${getRankFromElo(999)}`)
})

// Silver: 1000–1199
test("elo 1000 → Silver", () => {
  assert(getRankFromElo(1000) === "Silver", `Expected Silver, got ${getRankFromElo(1000)}`)
})
test("elo 1199 → Silver", () => {
  assert(getRankFromElo(1199) === "Silver", `Expected Silver, got ${getRankFromElo(1199)}`)
})

// Gold: 1200–1399
test("elo 1200 → Gold", () => {
  assert(getRankFromElo(1200) === "Gold", `Expected Gold, got ${getRankFromElo(1200)}`)
})
test("elo 1399 → Gold", () => {
  assert(getRankFromElo(1399) === "Gold", `Expected Gold, got ${getRankFromElo(1399)}`)
})

// Platinum: 1400–1599
test("elo 1400 → Platinum", () => {
  assert(getRankFromElo(1400) === "Platinum", `Expected Platinum, got ${getRankFromElo(1400)}`)
})

// Diamond: 1600–1799
test("elo 1600 → Diamond", () => {
  assert(getRankFromElo(1600) === "Diamond", `Expected Diamond, got ${getRankFromElo(1600)}`)
})

// Master: 1800–1999
test("elo 1800 → Master", () => {
  assert(getRankFromElo(1800) === "Master", `Expected Master, got ${getRankFromElo(1800)}`)
})

// Grandmaster: >= 2000
test("elo 2000 → Grandmaster", () => {
  assert(getRankFromElo(2000) === "Grandmaster", `Expected Grandmaster, got ${getRankFromElo(2000)}`)
})
test("elo 9999 → Grandmaster", () => {
  assert(getRankFromElo(9999) === "Grandmaster", `Expected Grandmaster, got ${getRankFromElo(9999)}`)
})

console.log("\nAll rank tests passed!")
