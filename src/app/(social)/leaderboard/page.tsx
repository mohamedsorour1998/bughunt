import { auth } from "@/auth"
import { LeaderboardTable } from "@/components/leaderboard/LeaderboardTable"
import { LeaderboardTabs } from "@/components/leaderboard/LeaderboardTabs"
import { getLeaderboardPlayers, getSeasonLeaderboardPlayers } from "@/app/api/leaderboard/route"
import { getCurrentSeason, getDaysRemaining } from "@/lib/seasons"

export const revalidate = 60

export const metadata = {
  title: "Leaderboard — BugHunt",
  description: "Top players ranked by Elo on BugHunt",
}

export default async function LeaderboardPage() {
  const [globalPlayers, seasonPlayers, season, session] = await Promise.all([
    getLeaderboardPlayers().catch(() => []),
    getSeasonLeaderboardPlayers().catch(() => []),
    getCurrentSeason().catch(() => null),
    auth(),
  ])

  const currentUserId = session?.user?.id ?? undefined
  const seasonName = season?.name ?? "Season"
  const daysRemaining = season ? getDaysRemaining(season) : 0

  return (
    <main className="min-h-screen">
      <div className="mx-auto max-w-3xl px-4 py-8 space-y-6">
        {/* Header */}
        <div className="space-y-1">
          <h1 className="text-3xl font-bold text-white">Leaderboard</h1>
          <p className="text-white/50 text-sm">
            Top players ranked by Elo rating
          </p>
        </div>

        {/* Season info banner */}
        {season && (
          <div className="flex items-center justify-between rounded-xl border border-purple-500/30 bg-purple-500/10 px-4 py-3">
            <div className="space-y-0.5">
              <p className="text-sm font-semibold text-purple-200">{season.name}</p>
              <p className="text-xs text-purple-300/70">
                {season.startDate} &ndash; {season.endDate}
              </p>
            </div>
            <div className="text-right">
              {daysRemaining > 0 ? (
                <>
                  <p className="text-lg font-bold text-purple-100">{daysRemaining}</p>
                  <p className="text-xs text-purple-300/70">days remaining</p>
                </>
              ) : (
                <p className="text-sm font-semibold text-purple-300">Season ended</p>
              )}
            </div>
          </div>
        )}

        {/* Leaderboard: tabs when season is active, plain table otherwise */}
        {season ? (
          <LeaderboardTabs
            globalPlayers={globalPlayers}
            seasonPlayers={seasonPlayers}
            currentUserId={currentUserId}
            seasonName={seasonName}
          />
        ) : (
          <LeaderboardTable players={globalPlayers} currentUserId={currentUserId} />
        )}
      </div>
    </main>
  )
}
