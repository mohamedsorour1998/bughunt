import { getLeaderboardPlayers, getSeasonLeaderboardPlayers } from "@/lib/leaderboard"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const seasonParam = searchParams.get("season")
    const players =
      seasonParam === "current"
        ? await getSeasonLeaderboardPlayers()
        : await getLeaderboardPlayers()
    return Response.json({ players })
  } catch (err) {
    console.error("Leaderboard GET error:", err)
    return Response.json({ error: "Failed to load leaderboard" }, { status: 500 })
  }
}
