"use client"

import { useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"

type FeedEntry = {
  gameId: string
  playerId: string
  playerName: string
  opponentId: string
  opponentName: string
  result: "win" | "loss" | "draw"
  eloBefore: number
  eloAfter: number
  eloChange: number
  createdAt: number
}

const RESULT_COLORS: Record<string, string> = {
  win: "text-green-400",
  loss: "text-red-400",
  draw: "text-yellow-400",
}

function timeAgo(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000)
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

export default function FeedPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [feed, setFeed] = useState<FeedEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/")
      return
    }
    if (status !== "authenticated") return

    fetch("/api/social/feed")
      .then((r) => r.json())
      .then((data: { feed: FeedEntry[] }) => {
        setFeed(data.feed ?? [])
      })
      .finally(() => setLoading(false))
  }, [status, router])

  // Suppress unused session warning — used for auth redirect
  void session

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-white/50">Loading feed...</p>
      </main>
    )
  }

  if (feed.length === 0) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
        <p className="text-lg text-white/70">Your feed is empty.</p>
        <p className="text-sm text-white/40">Follow other players to see their recent games here.</p>
        <Button onClick={() => router.push("/leaderboard")}>Browse Players</Button>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-2xl space-y-4 px-4 py-8">
      <h1 className="text-xl font-bold text-white">Following Feed</h1>
      <ul className="space-y-3">
        {feed.map((entry) => (
          <li
            key={`${entry.gameId}-${entry.playerId}`}
            className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-3"
          >
            <div className="space-y-0.5">
              <div className="flex items-center gap-2 text-sm font-medium text-white">
                <Link href={`/profile/${entry.playerId}`} className="hover:underline">
                  {entry.playerName}
                </Link>
                <span className={`text-xs font-bold uppercase ${RESULT_COLORS[entry.result] ?? "text-white/60"}`}>
                  {entry.result}
                </span>
                <span className="text-white/40">vs</span>
                <Link href={`/profile/${entry.opponentId}`} className="text-white/70 hover:underline">
                  {entry.opponentName}
                </Link>
              </div>
              <div className="text-xs text-white/40">{timeAgo(entry.createdAt)}</div>
            </div>
            <div className="text-right text-sm">
              <span className={entry.eloChange >= 0 ? "text-green-400" : "text-red-400"}>
                {entry.eloChange >= 0 ? "+" : ""}{entry.eloChange} Elo
              </span>
              <div className="text-xs text-white/40">{entry.eloAfter} rated</div>
            </div>
          </li>
        ))}
      </ul>
    </main>
  )
}
