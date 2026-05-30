import { v4 as uuidv4 } from "uuid"
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
import { getBug, markBugServed } from "@/lib/bugs"
import { getCurrentSeason } from "@/lib/seasons"
import { TransactWriteCommand } from "@aws-sdk/lib-dynamodb"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GameStatus = "waiting" | "active" | "completed"

export type Game = {
  gameId: string
  player1Id: string
  player2Id: string | null
  bugId: string
  status: GameStatus
  winnerId: string | null
  createdAt: number
  expiresAt: number
}

export type GamePlayer = {
  gameId: string
  userId: string
  answer: number | null
  correct: boolean | null
  submittedAt: number | null
  timeElapsedMs: number | null
}

// ---------------------------------------------------------------------------
// Achievement checking
// ---------------------------------------------------------------------------

function checkAchievements(
  profile: UserProfile,
  newProfile: { gamesPlayed: number; gamesWon: number; currentStreak: number; elo: number }
): string[] {
  const already = new Set(profile.achievementsUnlocked ?? [])
  const newOnes: string[] = []

  if (!already.has("first_win") && newProfile.gamesWon >= 1) newOnes.push("first_win")
  if (!already.has("games_10") && newProfile.gamesPlayed >= 10) newOnes.push("games_10")
  if (!already.has("games_100") && newProfile.gamesPlayed >= 100) newOnes.push("games_100")
  if (!already.has("streak_5") && newProfile.currentStreak >= 5) newOnes.push("streak_5")
  if (!already.has("streak_10") && newProfile.currentStreak >= 10) newOnes.push("streak_10")
  if (!already.has("elo_1400") && newProfile.elo >= 1400) newOnes.push("elo_1400")
  if (!already.has("elo_1600") && newProfile.elo >= 1600) newOnes.push("elo_1600")
  if (!already.has("elo_2000") && newProfile.elo >= 2000) newOnes.push("elo_2000")

  return newOnes
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
    { indexName: "GSI1" }
  )

  if (items.length === 0) return null

  // The META item has all game fields; the ACTIVE_PLAYER items are tracking only
  for (const item of items) {
    if (item.sk === "META") {
      return itemToGame(item)
    }
  }

  // Try fetching the game from the gameId stored in the GSI item
  const trackingItem = items[0]
  const gameId = trackingItem.gsi1sk as string ?? trackingItem.gameId as string
  if (!gameId) return null

  return getGame(gameId)
}

// ---------------------------------------------------------------------------
// createGame
// ---------------------------------------------------------------------------

export async function createGame(
  player1Id: string,
  player2Id: string,
  bugId: string
): Promise<Game> {
  const gameId = uuidv4()
  const now = Date.now()
  const expiresAt = Math.floor((now + 90 * 24 * 60 * 60 * 1000) / 1000) // 90 days TTL (epoch seconds for DDB TTL)

  const game: Game = {
    gameId,
    player1Id,
    player2Id,
    bugId,
    status: "active",
    winnerId: null,
    createdAt: now,
    expiresAt,
  }

  // Write main game META item (gsi1pk tracks player1)
  await putItem({
    pk: `GAME#${gameId}`,
    sk: "META",
    gameId,
    player1Id,
    player2Id,
    bugId,
    status: "active",
    winnerId: null,
    createdAt: now,
    expiresAt,
    gsi1pk: `ACTIVE_GAME#${player1Id}`,
    gsi1sk: gameId,
  })

  // Write tracking item for player2 (separate item so GSI1 can index both)
  await putItem({
    pk: `GAME#${gameId}`,
    sk: `ACTIVE_PLAYER#${player2Id}`,
    gameId,
    userId: player2Id,
    expiresAt,
    gsi1pk: `ACTIVE_GAME#${player2Id}`,
    gsi1sk: gameId,
  })

  return game
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
// resolveGame
// ---------------------------------------------------------------------------

export async function resolveGame(gameId: string): Promise<void> {
  const game = await getGame(gameId)
  if (!game || game.status === "completed") return

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
    const p1Correct = p1Record?.correct ?? false
    const p2Correct = p2Record?.correct ?? false
    const p1Time = p1Record?.timeElapsedMs ?? Infinity
    const p2Time = p2Record?.timeElapsedMs ?? Infinity

    if (p1Correct && p2Correct) {
      // Both correct: faster wins
      if (p1Time < p2Time) {
        winnerId = game.player1Id
        p1Score = 1
        p2Score = 0
      } else if (p2Time < p1Time) {
        winnerId = game.player2Id
        p1Score = 0
        p2Score = 1
      } else {
        // Exact tie
        winnerId = null
        p1Score = 0.5
        p2Score = 0.5
      }
    } else if (p1Correct && !p2Correct) {
      winnerId = game.player1Id
      p1Score = 1
      p2Score = 0
    } else if (!p1Correct && p2Correct) {
      winnerId = game.player2Id
      p1Score = 0
      p2Score = 1
    } else {
      // Neither correct: draw
      winnerId = null
      p1Score = 0.5
      p2Score = 0.5
    }
  }

  // ---------------------------------------------------------------------------
  // Compute new Elo
  // ---------------------------------------------------------------------------
  const p1EloBefore = p1Profile.elo
  const p2EloBefore = p2Profile?.elo ?? 1200

  const p1EloAfter = computeElo(p1EloBefore, p2EloBefore, p1Score, p1Profile.gamesPlayed)
  const p2EloAfter = p2Profile
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

  // ---------------------------------------------------------------------------
  // Update player1 stats
  // ---------------------------------------------------------------------------
  const p1Won = winnerId === game.player1Id
  const p1Drew = winnerId === null
  const p1NewGamesPlayed = p1Profile.gamesPlayed + 1
  const p1NewGamesWon = p1Profile.gamesWon + (p1Won ? 1 : 0)
  // Win: streak +1, Loss: streak reset to 0, Draw: streak unchanged
  const p1NewStreak = p1Won
    ? p1Profile.currentStreak + 1
    : p1Drew
    ? p1Profile.currentStreak
    : 0
  const p1NewBestStreak = Math.max(p1Profile.bestStreak, p1NewStreak)
  const p1NewRank = getRankFromElo(p1EloAfter)

  const p1NewAchievements = checkAchievements(p1Profile, {
    gamesPlayed: p1NewGamesPlayed,
    gamesWon: p1NewGamesWon,
    currentStreak: p1NewStreak,
    elo: p1EloAfter,
  })

  await updateUser(game.player1Id, {
    elo: p1EloAfter,
    rank: p1NewRank,
    gamesPlayed: p1NewGamesPlayed,
    gamesWon: p1NewGamesWon,
    currentStreak: p1NewStreak,
    bestStreak: p1NewBestStreak,
    achievementsUnlocked: [
      ...(p1Profile.achievementsUnlocked ?? []),
      ...p1NewAchievements,
    ],
  })

  // ---------------------------------------------------------------------------
  // Update player2 stats (if exists)
  // ---------------------------------------------------------------------------
  let p2NewAchievements: string[] = []
  if (game.player2Id && p2Profile) {
    const p2Won = winnerId === game.player2Id
    const p2Drew = winnerId === null
    const p2NewGamesPlayed = p2Profile.gamesPlayed + 1
    const p2NewGamesWon = p2Profile.gamesWon + (p2Won ? 1 : 0)
    // Win: streak +1, Loss: streak reset to 0, Draw: streak unchanged
    const p2NewStreak = p2Won
      ? p2Profile.currentStreak + 1
      : p2Drew
      ? p2Profile.currentStreak
      : 0
    const p2NewBestStreak = Math.max(p2Profile.bestStreak, p2NewStreak)
    const p2NewRank = getRankFromElo(p2EloAfter)

    p2NewAchievements = checkAchievements(p2Profile, {
      gamesPlayed: p2NewGamesPlayed,
      gamesWon: p2NewGamesWon,
      currentStreak: p2NewStreak,
      elo: p2EloAfter,
    })

    await updateUser(game.player2Id, {
      elo: p2EloAfter,
      rank: p2NewRank,
      gamesPlayed: p2NewGamesPlayed,
      gamesWon: p2NewGamesWon,
      currentStreak: p2NewStreak,
      bestStreak: p2NewBestStreak,
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
  // Update leaderboard items
  // ---------------------------------------------------------------------------
  // Remove old leaderboard entry and add new one for player1
  await updateLeaderboardEntry(game.player1Id, p1EloBefore, p1EloAfter, p1Profile.displayName, p1Profile.avatar, p1NewGamesPlayed, p1NewGamesWon)

  if (game.player2Id && p2Profile) {
    const p2Won = winnerId === game.player2Id
    const p2NewGamesPlayed = p2Profile.gamesPlayed + 1
    const p2NewGamesWon = p2Profile.gamesWon + (p2Won ? 1 : 0)
    await updateLeaderboardEntry(game.player2Id, p2EloBefore, p2EloAfter, p2Profile.displayName, p2Profile.avatar, p2NewGamesPlayed, p2NewGamesWon)
  }

  // ---------------------------------------------------------------------------
  // Update season leaderboard items (if an active season exists)
  // ---------------------------------------------------------------------------
  const activeSeason = await getCurrentSeason()
  if (activeSeason) {
    const seasonPk = `LEADERBOARD#SEASON#${activeSeason.seasonId}`
    await updateSeasonLeaderboardEntry(seasonPk, game.player1Id, p1EloBefore, p1EloAfter, p1Profile.displayName, p1Profile.avatar, p1NewGamesPlayed, p1NewGamesWon)

    if (game.player2Id && p2Profile) {
      const p2Won = winnerId === game.player2Id
      const p2NewGamesPlayed = p2Profile.gamesPlayed + 1
      const p2NewGamesWon = p2Profile.gamesWon + (p2Won ? 1 : 0)
      await updateSeasonLeaderboardEntry(seasonPk, game.player2Id, p2EloBefore, p2EloAfter, p2Profile.displayName, p2Profile.avatar, p2NewGamesPlayed, p2NewGamesWon)
    }
  }

  // ---------------------------------------------------------------------------
  // Remove active-game GSI markers
  // ---------------------------------------------------------------------------
  await deleteItem(`GAME#${gameId}`, "META").catch(() => {/* ignore if already gone */})
  // Re-write META without gsi1pk/gsi1sk
  const bug = await getBug(game.bugId)
  await putItem({
    pk: `GAME#${gameId}`,
    sk: "META",
    gameId,
    player1Id: game.player1Id,
    player2Id: game.player2Id,
    bugId: game.bugId,
    status: "completed",
    winnerId,
    createdAt: game.createdAt,
    expiresAt: game.expiresAt,
    // No gsi1pk / gsi1sk — completed game should not appear in active queries
  })

  // Remove player2 tracking item
  if (game.player2Id) {
    await deleteItem(`GAME#${gameId}`, `ACTIVE_PLAYER#${game.player2Id}`)
  }

  // ---------------------------------------------------------------------------
  // markBugServed
  // ---------------------------------------------------------------------------
  await markBugServed(game.bugId)
}

// ---------------------------------------------------------------------------
// updateLeaderboardEntry helper
// ---------------------------------------------------------------------------

async function updateLeaderboardEntry(
  userId: string,
  oldElo: number,
  newElo: number,
  displayName: string,
  avatar: string | null,
  gamesPlayed: number,
  gamesWon: number
): Promise<void> {
  // Delete old entry
  const oldKey = zeroPad(oldElo) + "#" + userId
  await deleteItem("LEADERBOARD#GLOBAL", `RANK#${oldKey}`).catch(() => {/* ignore */})

  // Write new entry
  const newKey = zeroPad(newElo) + "#" + userId
  await putItem({
    pk: "LEADERBOARD#GLOBAL",
    sk: `RANK#${newKey}`,
    userId,
    elo: newElo,
    displayName,
    avatar,
    gamesPlayed,
    gamesWon,
    updatedAt: Date.now(),
  })
}

async function updateSeasonLeaderboardEntry(
  seasonPk: string,
  userId: string,
  oldElo: number,
  newElo: number,
  displayName: string,
  avatar: string | null,
  gamesPlayed: number,
  gamesWon: number
): Promise<void> {
  // Delete old entry
  const oldKey = zeroPad(oldElo) + "#" + userId
  await deleteItem(seasonPk, `RANK#${oldKey}`).catch(() => {/* ignore */})

  // Write new entry
  const newKey = zeroPad(newElo) + "#" + userId
  await putItem({
    pk: seasonPk,
    sk: `RANK#${newKey}`,
    userId,
    elo: newElo,
    displayName,
    avatar,
    gamesPlayed,
    gamesWon,
    updatedAt: Date.now(),
  })
}

function zeroPad(n: number, width = 12): string {
  return String(n).padStart(width, "0")
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function itemToGame(item: Record<string, unknown>): Game {
  return {
    gameId: item.gameId as string,
    player1Id: item.player1Id as string,
    player2Id: (item.player2Id as string | null) ?? null,
    bugId: item.bugId as string,
    status: item.status as GameStatus,
    winnerId: (item.winnerId as string | null) ?? null,
    createdAt: item.createdAt as number,
    expiresAt: item.expiresAt as number,
  }
}

function itemToGamePlayer(item: Record<string, unknown>): GamePlayer {
  return {
    gameId: item.gameId as string,
    userId: item.userId as string,
    answer: (item.answer as number | null) ?? null,
    correct: (item.correct as boolean | null) ?? null,
    submittedAt: (item.submittedAt as number | null) ?? null,
    timeElapsedMs: (item.timeElapsedMs as number | null) ?? null,
  }
}
