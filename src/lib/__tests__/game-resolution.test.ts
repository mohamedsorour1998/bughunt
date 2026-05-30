// game-resolution.test.ts — tests for winner determination and Elo properties
import { computeElo } from "../game"

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

// ---------------------------------------------------------------------------
// Winner determination logic (inline, no DynamoDB dependency)
// ---------------------------------------------------------------------------

type Sub = { correct: boolean | null; timeElapsedMs: number | null }

function winner(p1: Sub, p2: Sub): "p1" | "p2" | "draw" {
  if (p1.correct && p2.correct)
    return (p1.timeElapsedMs ?? Infinity) < (p2.timeElapsedMs ?? Infinity) ? "p1" : "p2"
  if (p1.correct) return "p1"
  if (p2.correct) return "p2"
  return "draw"
}

// Winner determination tests
test("both correct, p1 faster → p1 wins", () => {
  const result = winner(
    { correct: true, timeElapsedMs: 5000 },
    { correct: true, timeElapsedMs: 8000 }
  )
  assert(result === "p1", `Expected p1, got ${result}`)
})

test("both correct, p2 faster → p2 wins", () => {
  const result = winner(
    { correct: true, timeElapsedMs: 9000 },
    { correct: true, timeElapsedMs: 3000 }
  )
  assert(result === "p2", `Expected p2, got ${result}`)
})

test("only p1 correct → p1 wins", () => {
  const result = winner(
    { correct: true, timeElapsedMs: 10000 },
    { correct: false, timeElapsedMs: 10000 }
  )
  assert(result === "p1", `Expected p1, got ${result}`)
})

test("only p2 correct → p2 wins", () => {
  const result = winner(
    { correct: false, timeElapsedMs: 10000 },
    { correct: true, timeElapsedMs: 10000 }
  )
  assert(result === "p2", `Expected p2, got ${result}`)
})

test("neither correct → draw", () => {
  const result = winner(
    { correct: false, timeElapsedMs: 10000 },
    { correct: false, timeElapsedMs: 10000 }
  )
  assert(result === "draw", `Expected draw, got ${result}`)
})

test("both null/timeout → draw", () => {
  const result = winner(
    { correct: null, timeElapsedMs: null },
    { correct: null, timeElapsedMs: null }
  )
  assert(result === "draw", `Expected draw, got ${result}`)
})

// ---------------------------------------------------------------------------
// Elo property tests (computeElo from game.ts)
// ---------------------------------------------------------------------------

test("winner gains elo (equal players, win)", () => {
  // 1200 vs 1200, win, 20 games played → K=32, E=0.5 → 1200 + 16 = 1216
  const result = computeElo(1200, 1200, 1, 20)
  assert(result > 1200, `Expected result > 1200, got ${result}`)
})

test("loser loses elo (equal players, loss)", () => {
  // 1200 vs 1200, loss, 20 games played → K=32, E=0.5 → 1200 - 16 = 1184
  const result = computeElo(1200, 1200, 0, 20)
  assert(result < 1200, `Expected result < 1200, got ${result}`)
})

test("Elo conservation: winner + loser === 2400 for equal 1200 vs 1200", () => {
  // Both use 20 games played (K=32), equal elo → symmetric result
  const winnerElo = computeElo(1200, 1200, 1, 20)
  const loserElo = computeElo(1200, 1200, 0, 20)
  assert(
    winnerElo + loserElo === 2400,
    `Expected winner + loser = 2400, got ${winnerElo} + ${loserElo} = ${winnerElo + loserElo}`
  )
})

console.log("\nAll game-resolution tests passed!")
