import { queryItems } from "@/lib/dynamodb"
import { getRankFromElo } from "@/lib/users"

export const revalidate = 60

export type LeaderboardPlayer = {
  rank: number
  userId: string
  displayName: string
  elo: number
  gamesPlayed: number
  gamesWon: number
  winRate: number
}

export async function getLeaderboardPlayers(): Promise<LeaderboardPlayer[]> {
  const { items } = await queryItems(
    "pk = :pk AND begins_with(sk, :skPrefix)",
    {
      ":pk": "LEADERBOARD#GLOBAL",
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

export async function GET() {
  try {
    const players = await getLeaderboardPlayers()
    return Response.json({ players })
  } catch (err) {
    console.error("Leaderboard GET error:", err)
    return Response.json({ error: "Failed to load leaderboard" }, { status: 500 })
  }
}
