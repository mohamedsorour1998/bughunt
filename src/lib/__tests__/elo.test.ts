// elo.test.ts — simple assertion script
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

test("K-factor is 40 for placement games (< 10 games)", () => {
  // 1200 vs 1200, win, game 5 → K=40, E=0.5, new = 1200 + 40*(1-0.5) = 1220
  const result = computeElo(1200, 1200, 1, 5)
  if (result !== 1220) throw new Error(`Expected 1220, got ${result}`)
})

test("K-factor is 32 for elo < 1400", () => {
  // 1300 vs 1300, win, game 15 → K=32, E=0.5, new = 1300 + 32*(1-0.5) = 1316
  const result = computeElo(1300, 1300, 1, 15)
  if (result !== 1316) throw new Error(`Expected 1316, got ${result}`)
})

test("K-factor is 24 for elo 1400-2000", () => {
  // 1500 vs 1500, win, game 20 → K=24, E=0.5, new = 1500 + 24*(1-0.5) = 1512
  const result = computeElo(1500, 1500, 1, 20)
  if (result !== 1512) throw new Error(`Expected 1512, got ${result}`)
})

test("K-factor is 16 for elo > 2000", () => {
  // 2100 vs 2100, win, game 50 → K=16, E=0.5, new = 2100 + 16*(1-0.5) = 2108
  const result = computeElo(2100, 2100, 1, 50)
  if (result !== 2108) throw new Error(`Expected 2108, got ${result}`)
})

test("underdog win gives more Elo", () => {
  // 1000 vs 1400, win for 1000 player, game 20
  // E = 1/(1+10^((1400-1000)/400)) = 1/(1+10) ≈ 0.0909
  // K=32 (elo<1400), new = 1000 + 32*(1-0.0909) ≈ 1000 + 29.09 = 1029
  const result = computeElo(1000, 1400, 1, 20)
  if (result !== 1029) throw new Error(`Expected 1029, got ${result}`)
})

test("draw gives no elo change for equal players", () => {
  // 1200 vs 1200, draw, game 20 → K=32, E=0.5, new = 1200 + 32*(0.5-0.5) = 1200
  const result = computeElo(1200, 1200, 0.5, 20)
  if (result !== 1200) throw new Error(`Expected 1200, got ${result}`)
})

console.log("\nAll Elo tests passed!")
