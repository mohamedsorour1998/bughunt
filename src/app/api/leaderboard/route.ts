import { queryItems } from "@/lib/dynamodb"
import { getCurrentSeason } from "@/lib/seasons"

export const dynamic = "force-dynamic"

export type LeaderboardPlayer = {
  rank: number
  userId: string
  displayName: string
  elo: number
  gamesPlayed: number
  gamesWon: number
  winRate: number
}

async function queryLeaderboard(pk: string): Promise<LeaderboardPlayer[]> {
  const { items } = await queryItems(
    "pk = :pk AND begins_with(sk, :skPrefix)",
    {
      ":pk": pk,
      ":skPrefix": "RANK#",
    },
    {
      limit: 100,
      scanIndexForward: false,
    }
  )

  return items.map((item, idx) => {
    const gamesPlayed = (item.gamesPlayed as number) ?? 0
    const gamesWon = (item.gamesWon as number) ?? 0
    const winRate =
      gamesPlayed > 0 ? Math.round((gamesWon / gamesPlayed) * 100) : 0

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
}

export async function getLeaderboardPlayers(): Promise<LeaderboardPlayer[]> {
  return queryLeaderboard("LEADERBOARD#GLOBAL")
}

export async function getSeasonLeaderboardPlayers(): Promise<LeaderboardPlayer[]> {
  const season = await getCurrentSeason()
  if (!season) return []
  return queryLeaderboard(`LEADERBOARD#SEASON#${season.seasonId}`)
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const seasonParam = searchParams.get("season")

    if (seasonParam === "current") {
      const players = await getSeasonLeaderboardPlayers()
      return Response.json({ players })
    }

    const players = await getLeaderboardPlayers()
    return Response.json({ players })
  } catch (err) {
    console.error("Leaderboard GET error:", err)
    return Response.json({ error: "Failed to load leaderboard" }, { status: 500 })
  }
}
