import { v4 as uuidv4 } from "uuid"
import { UpdateCommand } from "@aws-sdk/lib-dynamodb"
import {
  getItem,
  putItem,
  updateItem,
  deleteItem,
  queryItems,
  ddb,
  TABLE_NAME,
} from "@/lib/dynamodb"
import { getUser, updateUser, getRankFromElo, UserProfile } from "@/lib/users"
import { markBugServed, type Bug } from "@/lib/bugs"
import { publishGameEvent } from "@/lib/redis"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GameStatus = "waiting" | "active" | "completed"

/** Number of bug rounds played per ranked match. */
export const ROUNDS_PER_GAME = 3

/** Time allotted per round before it auto-times-out. */
export const ROUND_DURATION_MS = 120_000

export type Game = {
  gameId: string
  player1Id: string
  player2Id: string | null
  /** All bugs played this match, in round order (length ROUNDS_PER_GAME). */
  bugIds: string[]
  /** @deprecated kept for back-compat — equals bugIds[0] */
  bugId: string
  /** 0-indexed pointer to the round currently being played. */
  currentRound: number
  /** Epoch ms each round started; roundStartedAt[0] === createdAt. 0 = not started yet. */
  roundStartedAt: number[]
  status: GameStatus
  winnerId: string | null
  createdAt: number
  expiresAt: number
  isPrivate: boolean
  affectsElo: boolean
}

export interface CreateGameOptions {
  isPrivate?: boolean
  affectsElo?: boolean
  /** When isPrivate=true and no player2 yet, game starts as "waiting" */
  waitForPlayer2?: boolean
}

export type RoundAnswer = {
  bugId: string
  answer: number | null
  correct: boolean | null
  submittedAt: number | null
  timeElapsedMs: number | null
}

export type GamePlayer = {
  gameId: string
  userId: string
  /** One slot per round (length ROUNDS_PER_GAME), pre-filled with nulls. */
  answers: RoundAnswer[]
}

function emptyRoundAnswer(bugId: string): RoundAnswer {
  return { bugId, answer: null, correct: null, submittedAt: null, timeElapsedMs: null }
}

/** Aggregate a player's round answers into (correctCount, totalTimeMs). Missing rounds make totalTimeMs = Infinity so they always lose tiebreaks. */
function aggregatePlayer(record: GamePlayer | null): { correctCount: number; totalTimeMs: number } {
  let correctCount = 0
  let totalTimeMs = 0
  let anyMissing = false
  for (const a of record?.answers ?? []) {
    if (a.correct) correctCount++
    if (a.timeElapsedMs != null) totalTimeMs += a.timeElapsedMs
    else anyMissing = true
  }
  return { correctCount, totalTimeMs: anyMissing ? Infinity : totalTimeMs }
}

// ---------------------------------------------------------------------------
// Achievement checking
// ---------------------------------------------------------------------------

function checkAchievements(
  profile: UserProfile,
  newProfile: { gamesPlayed: number; gamesWon: number; currentStreak: number; elo: number }
): { achievements: string[]; shieldGrant: number } {
  const already = new Set(profile.achievementsUnlocked ?? [])
  const newOnes: string[] = []
  let shieldGrant = 0

  if (!already.has("first_win") && newProfile.gamesWon >= 1) newOnes.push("first_win")
  if (!already.has("games_10") && newProfile.gamesPlayed >= 10) {
    newOnes.push("games_10")
    shieldGrant += 1 // every 10 games: +1 shield
  }
  if (!already.has("games_100") && newProfile.gamesPlayed >= 100) newOnes.push("games_100")
  if (!already.has("streak_5") && newProfile.currentStreak >= 5) newOnes.push("streak_5")
  if (!already.has("streak_10") && newProfile.currentStreak >= 10) newOnes.push("streak_10")

  // Rank tier unlocks grant +2 shields each
  const RANK_THRESHOLDS: Record<string, number> = {
    elo_1400: 1400,
    elo_1600: 1600,
    elo_2000: 2000,
  }
  for (const [key, threshold] of Object.entries(RANK_THRESHOLDS)) {
    if (!already.has(key) && newProfile.elo >= threshold) {
      newOnes.push(key)
      shieldGrant += 2 // new rank tier: +2 shields
    }
  }

  return { achievements: newOnes, shieldGrant }
}

// ---------------------------------------------------------------------------
// Elo computation
// ---------------------------------------------------------------------------

export function computeElo(
  playerElo: number,
  opponentElo: number,
  score: 0 | 0.5 | 1,
  gamesPlayed: number
): number {
  const K =
    gamesPlayed < 10 ? 40 : playerElo < 1400 ? 32 : playerElo < 2000 ? 24 : 16
  const E = 1 / (1 + Math.pow(10, (opponentElo - playerElo) / 400))
  return Math.round(playerElo + K * (score - E))
}

// ---------------------------------------------------------------------------
// getGame
// ---------------------------------------------------------------------------

export async function getGame(gameId: string): Promise<Game | null> {
  const item = await getItem(`GAME#${gameId}`, "META")
  if (!item) return null
  return itemToGame(item)
}

// ---------------------------------------------------------------------------
// getActiveGameForUser
// ---------------------------------------------------------------------------

/**
 * Query GSI1 for ACTIVE_GAME#<userId> to find an in-progress or waiting game.
 * Returns the first match or null.
 */
export async function getActiveGameForUser(userId: string): Promise<Game | null> {
  const { items } = await queryItems(
    "gsi1pk = :pk",
    { ":pk": `ACTIVE_GAME#${userId}` },
    { indexName: "gsi1" }
  )

  if (items.length === 0) return null

  // ACTIVE_PLAYER tracking items mean this user was matched as the opponent in
  // an active game — those take priority over a stale waiting META item.
  const trackingItems = items.filter((i) => (i.sk as string).startsWith("ACTIVE_PLAYER#"))
  for (const tracking of trackingItems) {
    const gid = (tracking.gsi1sk as string) ?? (tracking.gameId as string)
    if (gid) {
      const g = await getGame(gid)
      if (g && g.status === "active") return g
    }
  }

  // Fall back to the META item (this user is player1 in a waiting or active game)
  for (const item of items) {
    if (item.sk === "META") {
      return itemToGame(item)
    }
  }

  // Last resort: derive gameId from the first GSI item
  const fallback = items[0]
  const gameId = (fallback.gsi1sk as string) ?? (fallback.gameId as string)
  if (!gameId) return null

  return getGame(gameId)
}

// ---------------------------------------------------------------------------
// createGame
// ---------------------------------------------------------------------------

export async function createGame(
  player1Id: string,
  player2Id: string | null,
  bugIds: string[],
  options: CreateGameOptions = {}
): Promise<Game> {
  if (bugIds.length !== ROUNDS_PER_GAME) {
    throw new Error(`createGame requires exactly ${ROUNDS_PER_GAME} bugIds, got ${bugIds.length}`)
  }
  const { isPrivate = false, affectsElo = true, waitForPlayer2 = false } = options

  const gameId = uuidv4()
  const now = Date.now()
  const expiresAt = Math.floor((now + 90 * 24 * 60 * 60 * 1000) / 1000) // 90 days TTL (epoch seconds for DDB TTL)
  const status: GameStatus = waitForPlayer2 ? "waiting" : "active"
  const bugId = bugIds[0]
  const roundStartedAt = [now, ...Array(ROUNDS_PER_GAME - 1).fill(0)]

  const game: Game = {
    gameId,
    player1Id,
    player2Id,
    bugIds,
    bugId,
    currentRound: 0,
    roundStartedAt,
    status,
    winnerId: null,
    createdAt: now,
    expiresAt,
    isPrivate,
    affectsElo,
  }

  // Write main game META item (gsi1pk tracks player1)
  await putItem({
    pk: `GAME#${gameId}`,
    sk: "META",
    gameId,
    player1Id,
    player2Id,
    bugIds,
    bugId,
    currentRound: 0,
    roundStartedAt,
    status,
    winnerId: null,
    createdAt: now,
    expiresAt,
    isPrivate,
    affectsElo,
    gsi1pk: `ACTIVE_GAME#${player1Id}`,
    gsi1sk: gameId,
  })

  // Pre-create player1's answer record (round slots filled with nulls)
  await createGamePlayerRecord(gameId, player1Id, bugIds)

  // Write tracking item for player2 (separate item so GSI1 can index both)
  if (player2Id) {
    await putItem({
      pk: `GAME#${gameId}`,
      sk: `ACTIVE_PLAYER#${player2Id}`,
      gameId,
      userId: player2Id,
      expiresAt,
      gsi1pk: `ACTIVE_GAME#${player2Id}`,
      gsi1sk: gameId,
    })
    await createGamePlayerRecord(gameId, player2Id, bugIds)
  }

  return game
}

// ---------------------------------------------------------------------------
// createGamePlayerRecord
// ---------------------------------------------------------------------------

/** Pre-create a player's PLAYER# answer record with null-filled round slots. */
export async function createGamePlayerRecord(
  gameId: string,
  userId: string,
  bugIds: string[]
): Promise<void> {
  const answers = bugIds.map(emptyRoundAnswer)
  await putItem(
    {
      pk: `GAME#${gameId}`,
      sk: `PLAYER#${userId}`,
      gameId,
      userId,
      answers,
    },
    "attribute_not_exists(pk)"
  ).catch((err: unknown) => {
    if (err instanceof Error && err.name === "ConditionalCheckFailedException") return
    throw err
  })
}

// ---------------------------------------------------------------------------
// getGamePlayer
// ---------------------------------------------------------------------------

export async function getGamePlayer(
  gameId: string,
  userId: string
): Promise<GamePlayer | null> {
  const item = await getItem(`GAME#${gameId}`, `PLAYER#${userId}`)
  if (!item) return null
  return itemToGamePlayer(item)
}

// ---------------------------------------------------------------------------
// submitRoundAnswer
// ---------------------------------------------------------------------------

/**
 * Conditionally write a player's answer for a single round slot.
 * Fails (written: false) if that slot was already submitted — guards against
 * double-submits racing each other (mirrors putItemIfNotExists for list slots,
 * since updateItem doesn't support ConditionExpression or list-index SET).
 *
 * Pass answer=null to record a timeout (counts as incorrect, full round duration elapsed).
 */
export async function submitRoundAnswer(
  gameId: string,
  userId: string,
  roundIndex: number,
  bug: Bug,
  answer: number | null,
  now: number,
  roundStartedAt: number
): Promise<{ written: boolean; correct: boolean; timeElapsedMs: number }> {
  const correct = answer != null && answer === bug.correctAnswer
  const timeElapsedMs = answer == null ? ROUND_DURATION_MS : now - roundStartedAt
  const value: RoundAnswer = { bugId: bug.bugId, answer, correct, submittedAt: now, timeElapsedMs }

  try {
    await ddb.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { pk: `GAME#${gameId}`, sk: `PLAYER#${userId}` },
        UpdateExpression: `SET answers[${roundIndex}] = :val`,
        ConditionExpression: `attribute_exists(pk) AND (attribute_not_exists(answers[${roundIndex}].submittedAt) OR answers[${roundIndex}].submittedAt = :null)`,
        ExpressionAttributeValues: { ":val": value, ":null": null },
      })
    )
    return { written: true, correct, timeElapsedMs }
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "ConditionalCheckFailedException") {
      return { written: false, correct, timeElapsedMs }
    }
    throw err
  }
}

// ---------------------------------------------------------------------------
// advanceOrResolveRound
// ---------------------------------------------------------------------------

/**
 * Called after a player submits a round answer. If both players have now
 * answered the current round, either advances to the next round (publishing
 * round_advanced) or resolves the game if that was the final round.
 */
export async function advanceOrResolveRound(gameId: string): Promise<void> {
  const game = await getGame(gameId)
  if (!game || game.status !== "active") return

  const round = game.currentRound
  const [p1Record, p2Record] = await Promise.all([
    getGamePlayer(gameId, game.player1Id),
    game.player2Id ? getGamePlayer(gameId, game.player2Id) : Promise.resolve(null),
  ])

  const p1Done = p1Record?.answers?.[round]?.submittedAt != null
  const p2Done = !game.player2Id || p2Record?.answers?.[round]?.submittedAt != null
  if (!p1Done || !p2Done) return

  if (round + 1 >= ROUNDS_PER_GAME) {
    await resolveGame(gameId)
    return
  }

  const now = Date.now()
  const nextRound = round + 1
  const roundStartedAt = [...game.roundStartedAt]
  roundStartedAt[nextRound] = now

  await updateItem(`GAME#${gameId}`, "META", { currentRound: nextRound, roundStartedAt })

  publishGameEvent(gameId, {
    type: "round_advanced",
    round: nextRound,
  }).catch(() => {/* Redis failure must not break round progression */})
}

// ---------------------------------------------------------------------------
// resolveGame
// ---------------------------------------------------------------------------

export async function resolveGame(gameId: string): Promise<void> {
  const game = await getGame(gameId)
  if (!game || game.status === "completed") return

  // Atomically claim resolution by flipping status active -> completed. Two
  // concurrent callers (submit + status-timeout paths) can both reach this
  // point; only the one whose conditional update succeeds proceeds to apply
  // Elo/history/notification side effects — the other returns early.
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { pk: `GAME#${gameId}`, sk: "META" },
        UpdateExpression: "SET #status = :completed",
        ConditionExpression: "#status = :active",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: { ":completed": "completed", ":active": "active" },
      })
    )
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "ConditionalCheckFailedException") {
      return
    }
    throw err
  }

  const [p1Record, p2Record] = await Promise.all([
    getGamePlayer(gameId, game.player1Id),
    game.player2Id ? getGamePlayer(gameId, game.player2Id) : Promise.resolve(null),
  ])

  const [p1Profile, p2Profile] = await Promise.all([
    getUser(game.player1Id),
    game.player2Id ? getUser(game.player2Id) : Promise.resolve(null),
  ])

  if (!p1Profile) return

  // ---------------------------------------------------------------------------
  // Determine winner
  // ---------------------------------------------------------------------------
  let winnerId: string | null = null
  let p1Score: 0 | 0.5 | 1 = 0.5
  let p2Score: 0 | 0.5 | 1 = 0.5

  if (!game.player2Id || !p2Profile) {
    // Solo game or opponent never showed — no meaningful resolution
    winnerId = null
    p1Score = 0.5
    p2Score = 0.5
  } else {
    const p1Agg = aggregatePlayer(p1Record)
    const p2Agg = aggregatePlayer(p2Record)

    if (p1Agg.correctCount > p2Agg.correctCount) {
      winnerId = game.player1Id
      p1Score = 1
      p2Score = 0
    } else if (p2Agg.correctCount > p1Agg.correctCount) {
      winnerId = game.player2Id
      p1Score = 0
      p2Score = 1
    } else if (p1Agg.totalTimeMs < p2Agg.totalTimeMs) {
      // Tied on correct count — faster aggregate time wins
      winnerId = game.player1Id
      p1Score = 1
      p2Score = 0
    } else if (p2Agg.totalTimeMs < p1Agg.totalTimeMs) {
      winnerId = game.player2Id
      p1Score = 0
      p2Score = 1
    } else {
      // Exact tie on both correctCount and totalTimeMs: draw
      winnerId = null
      p1Score = 0.5
      p2Score = 0.5
    }
  }

  // ---------------------------------------------------------------------------
  // Compute new Elo
  // ---------------------------------------------------------------------------
  const shouldAffectElo = game.affectsElo !== false

  const p1EloBefore = p1Profile.elo
  const p2EloBefore = p2Profile?.elo ?? 1200

  const p1EloAfter = shouldAffectElo
    ? computeElo(p1EloBefore, p2EloBefore, p1Score, p1Profile.gamesPlayed)
    : p1EloBefore
  const p2EloAfter = shouldAffectElo && p2Profile
    ? computeElo(p2EloBefore, p1EloBefore, p2Score, p2Profile.gamesPlayed)
    : p2EloBefore

  const now = Date.now()
  const nowSec = Math.floor(now / 1000)

  // ---------------------------------------------------------------------------
  // Update game status
  // ---------------------------------------------------------------------------
  await updateItem(`GAME#${gameId}`, "META", {
    status: "completed",
    winnerId,
  })

  publishGameEvent(gameId, {
    type: "game_resolved",
    winnerId,
    p1EloAfter,
    p2EloAfter,
  }).catch(() => {/* Redis failure must not break game resolution */})

  // ---------------------------------------------------------------------------
  // Update player1 stats
  // ---------------------------------------------------------------------------
  const p1Won = winnerId === game.player1Id
  const p1Drew = winnerId === null
  const p1NewGamesPlayed = p1Profile.gamesPlayed + 1
  const p1NewGamesWon = p1Profile.gamesWon + (p1Won ? 1 : 0)

  // Win: streak +1, Draw: streak unchanged, Loss: reset (unless shielded)
  let p1NewStreak: number
  let p1ShieldUsed = false
  let p1NewShieldsBase = p1Profile.streakShields ?? 0

  if (p1Won) {
    p1NewStreak = p1Profile.currentStreak + 1
  } else if (p1Drew) {
    p1NewStreak = p1Profile.currentStreak
  } else {
    // Loss: consume a shield if available and streak is worth protecting
    if ((p1Profile.streakShields ?? 0) > 0 && p1Profile.currentStreak > 0) {
      p1NewStreak = p1Profile.currentStreak  // shield absorbs the loss
      p1NewShieldsBase = (p1Profile.streakShields ?? 0) - 1
      p1ShieldUsed = true
    } else {
      p1NewStreak = 0
    }
  }

  const p1NewBestStreak = Math.max(p1Profile.bestStreak, p1NewStreak)
  const p1NewRank = shouldAffectElo ? getRankFromElo(p1EloAfter) : p1Profile.rank

  const { achievements: p1NewAchievements, shieldGrant: p1ShieldGrant } = checkAchievements(p1Profile, {
    gamesPlayed: p1NewGamesPlayed,
    gamesWon: p1NewGamesWon,
    currentStreak: p1NewStreak,
    elo: p1EloAfter,
  })

  // Cap shields at 3
  const p1NewShields = Math.min(3, p1NewShieldsBase + p1ShieldGrant)

  await updateUser(game.player1Id, {
    ...(shouldAffectElo ? { elo: p1EloAfter, rank: p1NewRank } : {}),
    gamesPlayed: p1NewGamesPlayed,
    gamesWon: p1NewGamesWon,
    currentStreak: p1NewStreak,
    bestStreak: p1NewBestStreak,
    streakShields: p1NewShields,
    achievementsUnlocked: [
      ...(p1Profile.achievementsUnlocked ?? []),
      ...p1NewAchievements,
    ],
  })

  // ---------------------------------------------------------------------------
  // Update player2 stats (if exists)
  // ---------------------------------------------------------------------------
  let p2NewAchievements: string[] = []
  let p2ShieldUsed = false
  if (game.player2Id && p2Profile) {
    const p2Won = winnerId === game.player2Id
    const p2Drew = winnerId === null
    const p2NewGamesPlayed = p2Profile.gamesPlayed + 1
    const p2NewGamesWon = p2Profile.gamesWon + (p2Won ? 1 : 0)

    // Win: streak +1, Draw: streak unchanged, Loss: reset (unless shielded)
    let p2NewStreak: number
    let p2NewShieldsBase = p2Profile.streakShields ?? 0

    if (p2Won) {
      p2NewStreak = p2Profile.currentStreak + 1
    } else if (p2Drew) {
      p2NewStreak = p2Profile.currentStreak
    } else {
      if ((p2Profile.streakShields ?? 0) > 0 && p2Profile.currentStreak > 0) {
        p2NewStreak = p2Profile.currentStreak
        p2NewShieldsBase = (p2Profile.streakShields ?? 0) - 1
        p2ShieldUsed = true
      } else {
        p2NewStreak = 0
      }
    }

    const p2NewBestStreak = Math.max(p2Profile.bestStreak, p2NewStreak)
    const p2NewRank = shouldAffectElo ? getRankFromElo(p2EloAfter) : p2Profile.rank

    const { achievements: p2Achievements, shieldGrant: p2ShieldGrant } = checkAchievements(p2Profile, {
      gamesPlayed: p2NewGamesPlayed,
      gamesWon: p2NewGamesWon,
      currentStreak: p2NewStreak,
      elo: p2EloAfter,
    })
    p2NewAchievements = p2Achievements

    const p2NewShields = Math.min(3, p2NewShieldsBase + p2ShieldGrant)

    await updateUser(game.player2Id, {
      ...(shouldAffectElo ? { elo: p2EloAfter, rank: p2NewRank } : {}),
      gamesPlayed: p2NewGamesPlayed,
      gamesWon: p2NewGamesWon,
      currentStreak: p2NewStreak,
      bestStreak: p2NewBestStreak,
      streakShields: p2NewShields,
      achievementsUnlocked: [
        ...(p2Profile.achievementsUnlocked ?? []),
        ...p2NewAchievements,
      ],
    })
  }

  // ---------------------------------------------------------------------------
  // Write match history for player1
  // ---------------------------------------------------------------------------
  const p1Result: "win" | "loss" | "draw" = p1Won ? "win" : p1Drew ? "draw" : "loss"
  const p1HistoryFields = {
    gameId,
    opponentId: game.player2Id ?? "bot",
    opponentName: p2Profile?.displayName ?? "Unknown",
    result: p1Result,
    eloBefore: p1EloBefore,
    eloAfter: p1EloAfter,
    eloChange: p1EloAfter - p1EloBefore,
    newAchievements: p1NewAchievements,
    shieldUsed: p1ShieldUsed,
    createdAt: now,
    expiresAt: Math.floor((now + 90 * 24 * 60 * 60 * 1000) / 1000),
  }
  await putItem({
    pk: `USER#${game.player1Id}`,
    sk: `GAME#${now}#${gameId}`,
    ...p1HistoryFields,
  })
  // Direct lookup item (no timestamp) for O(1) result page fetch
  await putItem({
    pk: `USER#${game.player1Id}`,
    sk: `GAMEID#${gameId}`,
    ...p1HistoryFields,
  })

  // ---------------------------------------------------------------------------
  // Write match history for player2
  // ---------------------------------------------------------------------------
  if (game.player2Id && p2Profile) {
    const p2Won = winnerId === game.player2Id
    const p2Drew = winnerId === null
    const p2Result: "win" | "loss" | "draw" = p2Won ? "win" : p2Drew ? "draw" : "loss"
    const p2HistoryFields = {
      gameId,
      opponentId: game.player1Id,
      opponentName: p1Profile.displayName,
      result: p2Result,
      eloBefore: p2EloBefore,
      eloAfter: p2EloAfter,
      eloChange: p2EloAfter - p2EloBefore,
      newAchievements: p2NewAchievements,
      shieldUsed: p2ShieldUsed,
      createdAt: now,
      expiresAt: Math.floor((now + 90 * 24 * 60 * 60 * 1000) / 1000),
    }
    await putItem({
      pk: `USER#${game.player2Id}`,
      sk: `GAME#${now}#${gameId}`,
      ...p2HistoryFields,
    })
    // Direct lookup item (no timestamp) for O(1) result page fetch
    await putItem({
      pk: `USER#${game.player2Id}`,
      sk: `GAMEID#${gameId}`,
      ...p2HistoryFields,
    })
  }

  // ---------------------------------------------------------------------------
  // Remove active-game GSI markers
  // ---------------------------------------------------------------------------
  await deleteItem(`GAME#${gameId}`, "META").catch(() => {/* ignore if already gone */})
  // Re-write META without gsi1pk/gsi1sk
  await putItem({
    pk: `GAME#${gameId}`,
    sk: "META",
    gameId,
    player1Id: game.player1Id,
    player2Id: game.player2Id,
    bugIds: game.bugIds,
    bugId: game.bugId,
    currentRound: ROUNDS_PER_GAME,
    roundStartedAt: game.roundStartedAt,
    status: "completed",
    winnerId,
    createdAt: game.createdAt,
    expiresAt: game.expiresAt,
    isPrivate: game.isPrivate,
    affectsElo: game.affectsElo,
    // No gsi1pk / gsi1sk — completed game should not appear in active queries
  })

  // Remove player2 tracking item
  if (game.player2Id) {
    await deleteItem(`GAME#${gameId}`, `ACTIVE_PLAYER#${game.player2Id}`)
  }

  // ---------------------------------------------------------------------------
  // markBugServed
  // ---------------------------------------------------------------------------
  await Promise.all(game.bugIds.map(markBugServed))
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function itemToGame(item: Record<string, unknown>): Game {
  const bugId = item.bugId as string
  const bugIds = Array.isArray(item.bugIds) ? (item.bugIds as string[]) : [bugId]
  const createdAt = item.createdAt as number
  return {
    gameId: item.gameId as string,
    player1Id: item.player1Id as string,
    player2Id: (item.player2Id as string | null) ?? null,
    bugIds,
    bugId,
    currentRound: (item.currentRound as number) ?? 0,
    roundStartedAt: Array.isArray(item.roundStartedAt) ? (item.roundStartedAt as number[]) : [createdAt],
    status: item.status as GameStatus,
    winnerId: (item.winnerId as string | null) ?? null,
    createdAt,
    expiresAt: item.expiresAt as number,
    isPrivate: (item.isPrivate as boolean) ?? false,
    affectsElo: (item.affectsElo as boolean) ?? true,
  }
}

function itemToGamePlayer(item: Record<string, unknown>): GamePlayer {
  if (Array.isArray(item.answers)) {
    return {
      gameId: item.gameId as string,
      userId: item.userId as string,
      answers: item.answers as RoundAnswer[],
    }
  }
  // Legacy single-answer shape — wrap into a 1-element answers array
  return {
    gameId: item.gameId as string,
    userId: item.userId as string,
    answers: [
      {
        bugId: (item.bugId as string) ?? "",
        answer: (item.answer as number | null) ?? null,
        correct: (item.correct as boolean | null) ?? null,
        submittedAt: (item.submittedAt as number | null) ?? null,
        timeElapsedMs: (item.timeElapsedMs as number | null) ?? null,
      },
    ],
  }
}
