// bot.test.ts — deterministic bot behavior
import {
  seededRandom, botDelayMs, botCorrectProbability, chooseBotAnswer, pickBotForElo, isBotUser, BOT_USERS,
} from "../bot"
import type { Bug } from "../bugs"

function test(name: string, fn: () => void) {
  try {
    fn()
    console.log("✓", name)
  } catch (e) {
    console.error("✗", name, e)
    process.exit(1)
  }
}

const fakeBug: Bug = {
  bugId: "b1", language: "python", category: "logic", difficulty: 3,
  buggyCode: "x", correctCode: "y", bugLine: 1,
  options: ["a", "b", "c", "d"], correctAnswer: 2,
  explanation: "", hint: "", timesServed: 0, source: "manual", status: "active", createdAt: 0,
}

test("seededRandom is deterministic and in [0,1)", () => {
  const a = seededRandom("game-1:0:correct")
  const b = seededRandom("game-1:0:correct")
  if (a !== b) throw new Error("not deterministic")
  if (a < 0 || a >= 1) throw new Error(`out of range: ${a}`)
  if (seededRandom("other") === a) throw new Error("different seeds should differ (overwhelmingly)")
})

test("botDelayMs respects env overrides and is deterministic", () => {
  process.env.BOT_THINK_MIN_MS = "0"
  process.env.BOT_THINK_SPAN_MS = "0"
  if (botDelayMs("g", 0) !== 0) throw new Error("expected 0 delay with zeroed env")
  delete process.env.BOT_THINK_MIN_MS
  delete process.env.BOT_THINK_SPAN_MS
  const d1 = botDelayMs("g", 0)
  const d2 = botDelayMs("g", 0)
  if (d1 !== d2) throw new Error("not deterministic")
  if (d1 < 8000 || d1 >= 25000) throw new Error(`delay out of range: ${d1}`)
})

test("botCorrectProbability is clamped to [0.2, 0.95] and monotonic in Elo", () => {
  const weak = botCorrectProbability(800, 5)
  const strong = botCorrectProbability(2200, 5)
  if (weak < 0.2 || strong > 0.95) throw new Error("clamp failed")
  if (strong <= weak) throw new Error("stronger bot must have higher probability")
})

test("chooseBotAnswer is deterministic and returns a valid option index", () => {
  const a1 = chooseBotAnswer(fakeBug, 1300, "game-x", 1)
  const a2 = chooseBotAnswer(fakeBug, 1300, "game-x", 1)
  if (a1 !== a2) throw new Error("not deterministic")
  if (a1 < 0 || a1 > 3) throw new Error(`invalid option: ${a1}`)
})

test("pickBotForElo picks the nearest bot", () => {
  const picked = pickBotForElo(1750)
  const best = [...BOT_USERS].sort((x, y) => Math.abs(x.elo - 1750) - Math.abs(y.elo - 1750))[0]
  if (picked.userId !== best.userId) throw new Error(`picked ${picked.userId}, expected ${best.userId}`)
})

test("isBotUser matches only the bot- prefix", () => {
  if (!isBotUser("bot-nova-dev")) throw new Error("should match")
  if (isBotUser("test-user-1")) throw new Error("should not match")
  if (isBotUser(null)) throw new Error("null should not match")
})

console.log("All bot tests passed!")
