import { auth } from "@/auth"
import { LeaderboardTable } from "@/components/leaderboard/LeaderboardTable"
import { getLeaderboardPlayers } from "@/app/api/leaderboard/route"

export const revalidate = 60

export const metadata = {
  title: "Leaderboard — BugHunt",
  description: "Top players ranked by Elo on BugHunt",
}

export default async function LeaderboardPage() {
  const [players, session] = await Promise.all([
    getLeaderboardPlayers().catch(() => []),
    auth(),
  ])

  const currentUserId = session?.user?.id ?? undefined

  return (
    <main className="min-h-screen">
      <div className="mx-auto max-w-3xl px-4 py-8 space-y-6">
        {/* Header */}
        <div className="space-y-1">
          <h1 className="text-3xl font-bold text-white">Global Leaderboard</h1>
          <p className="text-white/50 text-sm">
            Top {players.length > 0 ? players.length : "100"} players by Elo rating
            {players.length > 0 && (
              <span className="ml-2 text-white/30">
                &middot; {players.length} player{players.length !== 1 ? "s" : ""}
              </span>
            )}
          </p>
        </div>

        {/* Leaderboard table */}
        <LeaderboardTable players={players} currentUserId={currentUserId} />
      </div>
    </main>
  )
}
