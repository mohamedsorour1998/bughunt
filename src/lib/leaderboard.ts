import { queryItems, cacheGet, cacheSet } from "@/lib/dynamodb"
import { getCurrentSeason } from "@/lib/seasons"

export type LeaderboardPlayer = {
  rank: number
  userId: string
  displayName: string
  elo: number
  gamesPlayed: number
  gamesWon: number
  winRate: number
}

const LEADERBOARD_CACHE_TTL_MS = 60_000

async function queryLeaderboard(pk: string): Promise<LeaderboardPlayer[]> {
  const cacheKey = `leaderboard:${pk}`
  const cached = cacheGet(cacheKey)
  if (cached !== undefined) return cached as LeaderboardPlayer[]

  const { items } = await queryItems(
    "pk = :pk AND begins_with(sk, :skPrefix)",
    { ":pk": pk, ":skPrefix": "RANK#" },
    { limit: 100, scanIndexForward: false }
  )

  const players: LeaderboardPlayer[] = items.map((item, idx) => {
    const gamesPlayed = (item.gamesPlayed as number) ?? 0
    const gamesWon = (item.gamesWon as number) ?? 0
    const winRate = gamesPlayed > 0 ? Math.round((gamesWon / gamesPlayed) * 100) : 0
    return {
      rank: idx + 1,
      userId: item.userId as string,
      displayName: (item.displayName as string) ?? "Unknown",
      elo: (item.elo as number) ?? 1200,
      gamesPlayed,
      gamesWon,
      winRate,
    }
  })

  cacheSet(cacheKey, players, LEADERBOARD_CACHE_TTL_MS)
  return players
}

export async function getLeaderboardPlayers(): Promise<LeaderboardPlayer[]> {
  return queryLeaderboard("LEADERBOARD#GLOBAL")
}

export async function getSeasonLeaderboardPlayers(): Promise<LeaderboardPlayer[]> {
  const season = await getCurrentSeason()
  if (!season) return []
  return queryLeaderboard(`LEADERBOARD#SEASON#${season.seasonId}`)
}
