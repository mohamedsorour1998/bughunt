import Link from "next/link"
import { buttonVariants } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { RankBadge } from "@/components/ui/RankBadge"
import { getRankFromElo } from "@/lib/users"
import { getLeaderboardPlayers } from "@/lib/leaderboard"
import { Bug, Zap, Trophy } from "lucide-react"
import { cn } from "@/lib/utils"
import { BugTeaser } from "@/components/landing/BugTeaser"

export default async function Home() {
  let topPlayers: Awaited<ReturnType<typeof getLeaderboardPlayers>> = []
  try {
    const all = await getLeaderboardPlayers()
    topPlayers = all.slice(0, 5)
  } catch {
    // Silently handle — show empty state
  }

  return (
    <>
      {/* ------------------------------------------------------------------ */}
      {/* Hero */}
      {/* ------------------------------------------------------------------ */}
      <section className="relative min-h-screen flex items-center justify-center overflow-hidden">
        {/* Subtle grid background */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.3) 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }}
        />

        {/* Radial glow */}
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_40%,rgba(16,185,129,0.07),transparent)]" />

        <div className="relative z-10 mx-auto max-w-4xl px-4 sm:px-6 text-center space-y-8">
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-4 py-1.5 text-sm text-emerald-400">
            <Bug className="size-4" />
            Competitive Debugging
          </div>

          <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-white leading-[1.1]">
            Debug Faster Than{" "}
            <span className="text-emerald-400">Anyone</span>
          </h1>

          <p className="mx-auto max-w-2xl text-xl text-gray-400 leading-relaxed">
            Compete against developers worldwide. Find bugs faster than your opponent
            to climb the Elo ladder.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/play"
              className={cn(buttonVariants({ size: "lg" }), "min-w-44 text-base font-semibold")}
            >
              Start Playing
            </Link>
            <Link
              href="/practice"
              className={cn(
                buttonVariants({ variant: "outline", size: "lg" }),
                "min-w-44 text-base font-semibold border-white/20 text-white hover:bg-white/10 hover:text-white"
              )}
            >
              Practice Solo
            </Link>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Interactive teaser                                                  */}
      {/* ------------------------------------------------------------------ */}
      <BugTeaser />

      {/* ------------------------------------------------------------------ */}
      {/* Features */}
      {/* ------------------------------------------------------------------ */}
      <section className="py-24 px-4 sm:px-6">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-center text-3xl font-bold text-white mb-12">
            Why BugHunt?
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card className="bg-gray-900 border-white/10">
              <CardContent className="pt-6 space-y-3">
                <div className="size-10 rounded-lg bg-emerald-500/15 flex items-center justify-center">
                  <Bug className="size-5 text-emerald-400" />
                </div>
                <h3 className="text-lg font-semibold text-white">50+ Real Bugs</h3>
                <p className="text-gray-400 text-sm leading-relaxed">
                  Python, JS, TS, Go, SQL, Bash — hand-crafted bugs from real codebases,
                  ranging from beginner to expert difficulty.
                </p>
              </CardContent>
            </Card>

            <Card className="bg-gray-900 border-white/10">
              <CardContent className="pt-6 space-y-3">
                <div className="size-10 rounded-lg bg-yellow-500/15 flex items-center justify-center">
                  <Trophy className="size-5 text-yellow-400" />
                </div>
                <h3 className="text-lg font-semibold text-white">Elo Rating System</h3>
                <p className="text-gray-400 text-sm leading-relaxed">
                  Chess-style competitive ranking. Win matches to climb the ladder
                  from Bronze all the way to Grandmaster.
                </p>
              </CardContent>
            </Card>

            <Card className="bg-gray-900 border-white/10">
              <CardContent className="pt-6 space-y-3">
                <div className="size-10 rounded-lg bg-blue-500/15 flex items-center justify-center">
                  <Zap className="size-5 text-blue-400" />
                </div>
                <h3 className="text-lg font-semibold text-white">Async Matchmaking</h3>
                <p className="text-gray-400 text-sm leading-relaxed">
                  Find opponents in seconds. Our async matchmaking pairs you with
                  someone at your skill level instantly.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Leaderboard Preview */}
      {/* ------------------------------------------------------------------ */}
      <section className="py-16 px-4 sm:px-6">
        <div className="mx-auto max-w-2xl">
          <h2 className="text-2xl font-bold text-white mb-6 text-center">
            Top Players
          </h2>

          {topPlayers.length === 0 ? (
            <div className="rounded-xl border border-white/10 bg-white/5 px-6 py-12 text-center">
              <p className="text-white/50">No players yet — be the first!</p>
              <Link
                href="/play"
                className={cn(buttonVariants({ size: "sm" }), "mt-4 inline-flex")}
              >
                Start Playing
              </Link>
            </div>
          ) : (
            <div className="rounded-xl border border-white/10 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10 bg-white/5">
                    <th className="py-3 pl-4 pr-2 text-left text-xs uppercase tracking-wider text-white/40 w-10">
                      #
                    </th>
                    <th className="py-3 px-2 text-left text-xs uppercase tracking-wider text-white/40">
                      Player
                    </th>
                    <th className="py-3 px-2 text-right text-xs uppercase tracking-wider text-white/40">
                      Elo
                    </th>
                    <th className="py-3 pl-2 pr-4 text-right text-xs uppercase tracking-wider text-white/40">
                      Rank
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {topPlayers.map((player) => {
                    const rankName = getRankFromElo(player.elo)
                    const medalClass =
                      player.rank === 1
                        ? "text-yellow-400 font-black"
                        : player.rank === 2
                        ? "text-gray-300 font-black"
                        : player.rank === 3
                        ? "text-amber-600 font-black"
                        : "text-white/50"
                    return (
                      <tr
                        key={player.userId}
                        className="border-b border-white/5 last:border-0 hover:bg-white/5 transition-colors"
                      >
                        <td className={`py-3 pl-4 pr-2 font-mono ${medalClass}`}>
                          {player.rank}
                        </td>
                        <td className="py-3 px-2 font-medium text-white/80 truncate max-w-[160px]">
                          {player.displayName}
                        </td>
                        <td className="py-3 px-2 text-right font-mono font-semibold text-white">
                          {player.elo}
                        </td>
                        <td className="py-3 pl-2 pr-4 text-right">
                          <RankBadge rank={rankName} size="sm" />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-4 text-center">
            <Link
              href="/leaderboard"
              className="text-sm text-emerald-400 hover:text-emerald-300 transition-colors"
            >
              View Full Leaderboard →
            </Link>
          </div>
        </div>
      </section>
    </>
  )
}
