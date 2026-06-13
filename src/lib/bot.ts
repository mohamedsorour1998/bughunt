/**
 * Bot opponents — serverless lazy evaluation.
 *
 * There is no bot process. The human's own requests (status poll, submit,
 * SSE poll tick) call maybePlayBotRound(); when the bot's deterministic
 * "thinking" delay for the current round has elapsed, that request writes the
 * bot's answer via the same conditional submitRoundAnswer path humans use.
 * All randomness is seeded from sha256(gameId:round), so concurrent requests
 * agree on the bot's behavior and the conditional write dedupes the rest.
 */
import { createHash } from "crypto"
import { getGamePlayer, submitRoundAnswer, advanceOrResolveRound, type Game } from "@/lib/game"
import { getBug, type Bug } from "@/lib/bugs"
import { publishGameEvent } from "@/lib/redis"
import { putItemIfNotExists } from "@/lib/dynamodb"
import { getRankFromElo } from "@/lib/users"
import { novaPickAnswer } from "@/lib/bedrock"

export const BOT_USERS = [
  { userId: "bot-nova-junior", displayName: "Nova Junior", elo: 1000 },
  { userId: "bot-nova-dev", displayName: "Nova Dev", elo: 1300 },
  { userId: "bot-nova-staff", displayName: "Nova Staff", elo: 1700 },
] as const

export type BotUser = (typeof BOT_USERS)[number]

export function isBotUser(userId: string | null | undefined): boolean {
  return typeof userId === "string" && userId.startsWith("bot-")
}

export function pickBotForElo(elo: number): BotUser {
  let best: BotUser = BOT_USERS[0]
  for (const b of BOT_USERS) {
    if (Math.abs(b.elo - elo) < Math.abs(best.elo - elo)) best = b
  }
  return best
}

/** Deterministic [0,1) from a seed string. */
export function seededRandom(seed: string): number {
  const h = createHash("sha256").update(seed).digest()
  return h.readUInt32BE(0) / 0x1_0000_0000
}

/** Bot "thinking" delay for a round — 8–25s by default, env-overridable for tests. */
export function botDelayMs(gameId: string, roundIndex: number): number {
  const min = Number(process.env.BOT_THINK_MIN_MS ?? 8000)
  const span = Number(process.env.BOT_THINK_SPAN_MS ?? 17000)
  return min + Math.floor(seededRandom(`${gameId}:${roundIndex}:delay`) * span)
}

/**
 * Probability the bot answers correctly: Elo expectation against a notional
 * "bug Elo" of difficulty*400 (the same scale selectBugsForGame uses), clamped
 * so bots are never hopeless (0.2) nor perfect (0.95).
 */
export function botCorrectProbability(botElo: number, difficulty: number): number {
  const bugElo = difficulty * 400
  const expected = 1 / (1 + Math.pow(10, (bugElo - botElo) / 400))
  return Math.min(0.95, Math.max(0.2, expected))
}

export function chooseBotAnswer(bug: Bug, botElo: number, gameId: string, roundIndex: number): number {
  const pCorrect = botCorrectProbability(botElo, bug.difficulty)
  if (seededRandom(`${gameId}:${roundIndex}:correct`) < pCorrect) return bug.correctAnswer
  const wrong = [0, 1, 2, 3].filter((i) => i !== bug.correctAnswer)
  return wrong[Math.floor(seededRandom(`${gameId}:${roundIndex}:wrong`) * wrong.length)]
}

/** Decide the bot's answer — Nova when BOT_USE_BEDROCK=true (2.5s budget), scripted model otherwise/fallback. */
export async function decideBotAnswer(bug: Bug, botElo: number, gameId: string, roundIndex: number): Promise<number> {
  if (process.env.BOT_USE_BEDROCK === "true") {
    const nova = await Promise.race([
      novaPickAnswer(bug.buggyCode, bug.language, bug.options),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 2500)),
    ])
    if (nova !== null) return nova
  }
  return chooseBotAnswer(bug, botElo, gameId, roundIndex)
}

/** Create the bot's USER profile if missing (idempotent putItemIfNotExists). */
export async function ensureBotProfile(bot: BotUser): Promise<void> {
  await putItemIfNotExists({
    pk: `USER#${bot.userId}`,
    sk: "PROFILE",
    gsi2pk: `EMAIL#${bot.userId}@bots.bughunt.dev`,
    gsi2sk: bot.userId,
    userId: bot.userId,
    email: `${bot.userId}@bots.bughunt.dev`,
    displayName: bot.displayName,
    avatar: null,
    isBot: true,
    elo: bot.elo,
    rank: getRankFromElo(bot.elo),
    gamesPlayed: 0,
    gamesWon: 0,
    currentStreak: 0,
    bestStreak: 0,
    bugsSeen: [],
    achievementsUnlocked: [],
    streakShields: 0,
    dailyStreak: 0,
    lastDailyDate: null,
    bugsSubmitted: 0,
    bugsRejected: 0,
    followerCount: 0,
    followingCount: 0,
    createdAt: Date.now(),
  })
}

/**
 * Lazy bot driver. Returns true when the bot acted (callers should re-read
 * the game). Safe to call from any request at any frequency:
 * - no bot in this game → no-op
 * - thinking delay not yet elapsed → no-op
 * - already answered (or a concurrent request won the conditional write) → no-op
 */
export async function maybePlayBotRound(game: Game): Promise<boolean> {
  if (game.status !== "active") return false
  const botId = isBotUser(game.player1Id)
    ? game.player1Id
    : isBotUser(game.player2Id)
      ? game.player2Id!
      : null
  if (!botId) return false

  const round = game.currentRound
  const roundStartedAt = game.roundStartedAt[round] ?? game.createdAt
  const now = Date.now()
  if (now - roundStartedAt < botDelayMs(game.gameId, round)) return false

  const record = await getGamePlayer(game.gameId, botId)
  if (record?.answers?.[round]?.submittedAt != null) return false

  const bug = await getBug(game.bugIds[round])
  if (!bug) return false

  const botElo = BOT_USERS.find((b) => b.userId === botId)?.elo ?? 1200
  const answer = await decideBotAnswer(bug, botElo, game.gameId, round)

  const result = await submitRoundAnswer(game.gameId, botId, round, bug, answer, now, roundStartedAt)
  if (!result.written) return false

  publishGameEvent(game.gameId, {
    type: "player_submitted",
    userId: botId,
    roundIndex: round,
    correct: result.correct,
    timeElapsedMs: result.timeElapsedMs,
  }).catch(() => {/* Redis failure must not break bot play */})

  await advanceOrResolveRound(game.gameId)
  return true
}
