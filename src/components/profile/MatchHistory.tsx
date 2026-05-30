"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"

type MatchHistoryEntry = {
  gameId: string
  opponentId: string
  opponentName: string
  result: "win" | "loss" | "draw"
  eloBefore: number
  eloAfter: number
  eloChange: number
  createdAt: number
}

type MatchHistoryResponse = {
  entries: MatchHistoryEntry[]
  nextCursor?: string
}

type MatchHistoryProps = {
  userId: string
  initialEntries?: MatchHistoryEntry[]
}

function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  if (seconds < 60) return "just now"
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`
  const days = Math.floor(hours / 24)
  return `${days} day${days === 1 ? "" : "s"} ago`
}

function ResultBadge({ result }: { result: "win" | "loss" | "draw" }) {
  const styles = {
    win: "bg-green-600/20 text-green-400 border-green-600/30",
    loss: "bg-red-600/20 text-red-400 border-red-600/30",
    draw: "bg-gray-500/20 text-gray-400 border-gray-500/30",
  }
  const labels = { win: "W", loss: "L", draw: "D" }

  return (
    <span
      className={`inline-flex h-7 w-7 items-center justify-center rounded border text-xs font-bold ${styles[result]}`}
    >
      {labels[result]}
    </span>
  )
}

export function MatchHistory({ userId: _userId, initialEntries }: MatchHistoryProps) {
  const [entries, setEntries] = useState<MatchHistoryEntry[]>(initialEntries ?? [])
  const [nextCursor, setNextCursor] = useState<string | undefined>(undefined)
  const [loading, setLoading] = useState(!initialEntries)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (initialEntries) return
    // Fetch initial data
    setLoading(true)
    fetch("/api/user/history")
      .then((r) => r.json())
      .then((data: MatchHistoryResponse) => {
        setEntries(data.entries ?? [])
        setNextCursor(data.nextCursor)
      })
      .catch(() => setError("Failed to load match history"))
      .finally(() => setLoading(false))
  }, [initialEntries])

  async function handleLoadMore() {
    if (!nextCursor) return
    setLoadingMore(true)
    setError(null)
    try {
      const res = await fetch(`/api/user/history?cursor=${encodeURIComponent(nextCursor)}`)
      if (!res.ok) throw new Error("Failed to load more")
      const data: MatchHistoryResponse = await res.json()
      setEntries((prev) => [...prev, ...(data.entries ?? [])])
      setNextCursor(data.nextCursor)
    } catch {
      setError("Failed to load more games")
    } finally {
      setLoadingMore(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-12 animate-pulse rounded-lg bg-white/5"
          />
        ))}
      </div>
    )
  }

  if (entries.length === 0) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-8 text-center text-sm text-white/50">
        No games yet
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {entries.map((entry) => {
          const eloSign = entry.eloChange > 0 ? "+" : ""
          const eloColor =
            entry.eloChange > 0
              ? "text-green-400"
              : entry.eloChange < 0
              ? "text-red-400"
              : "text-gray-400"

          return (
            <div
              key={entry.gameId}
              className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2.5"
            >
              <ResultBadge result={entry.result} />
              <div className="min-w-0 flex-1">
                <span className="truncate text-sm text-white/90">
                  vs {entry.opponentName}
                </span>
              </div>
              <span className={`font-mono text-sm font-semibold ${eloColor}`}>
                {eloSign}{entry.eloChange}
              </span>
              <span className="text-xs text-white/40">{timeAgo(entry.createdAt)}</span>
            </div>
          )
        })}
      </div>

      {error && (
        <p className="text-center text-sm text-red-400">{error}</p>
      )}

      {nextCursor && (
        <div className="flex justify-center pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleLoadMore}
            disabled={loadingMore}
          >
            {loadingMore ? "Loading..." : "Load More"}
          </Button>
        </div>
      )}
    </div>
  )
}
