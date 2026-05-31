"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import Image from "next/image"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { RankBadge } from "@/components/ui/RankBadge"
import { EloChart } from "@/components/profile/EloChart"
import { MatchHistory } from "@/components/profile/MatchHistory"

// ---------------------------------------------------------------------------
// API Token Section
// ---------------------------------------------------------------------------

function ApiTokenSection() {
  const [token, setToken] = useState<string | null>(null)
  const [exists, setExists] = useState(false)
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    fetch("/api/user/token")
      .then((r) => r.json())
      .then((data) => {
        if (data.created && data.token) {
          setToken(data.token)
          setExists(true)
        } else if (data.exists) {
          setExists(true)
          setToken(null)
        }
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  async function handleRegenerate() {
    setLoading(true)
    const res = await fetch("/api/user/token", { method: "POST" })
    const data = await res.json()
    if (data.token) {
      setToken(data.token)
      setExists(true)
    }
    setLoading(false)
  }

  async function handleRevoke() {
    setLoading(true)
    await fetch("/api/user/token", { method: "DELETE" })
    setToken(null)
    setExists(false)
    setLoading(false)
  }

  function handleCopy() {
    if (token) {
      navigator.clipboard.writeText(token)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-white/50">
        VS Code Extension Token
      </h2>
      <div className="rounded-xl border border-white/10 bg-white/5 p-5 space-y-3">
        {loading ? (
          <p className="text-sm text-white/40">Loading...</p>
        ) : token ? (
          <>
            <p className="text-xs text-yellow-300/80 font-medium">
              Store this token securely — it will not be shown again.
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              <code className="flex-1 rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-xs font-mono text-green-300 break-all">
                {token}
              </code>
              <Button size="sm" variant="outline" onClick={handleCopy} className="shrink-0">
                {copied ? "Copied!" : "Copy"}
              </Button>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={handleRegenerate}>
                Regenerate
              </Button>
              <Button size="sm" variant="outline" onClick={handleRevoke} className="border-red-500/30 text-red-400 hover:bg-red-900/20">
                Revoke
              </Button>
            </div>
          </>
        ) : exists ? (
          <>
            <p className="text-sm text-white/60">
              A token is active. Regenerate to get a new one (old token will be invalidated).
            </p>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleRegenerate}>
                Regenerate Token
              </Button>
              <Button size="sm" variant="outline" onClick={handleRevoke} className="border-red-500/30 text-red-400 hover:bg-red-900/20">
                Revoke
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-white/60">No API token yet.</p>
            <Button size="sm" onClick={handleRegenerate}>
              Generate Token
            </Button>
          </>
        )}
      </div>
    </section>
  )
}

type UserProfile = {
  userId: string
  displayName: string
  avatar: string | null
  elo: number
  rank: string
  gamesPlayed: number
  gamesWon: number
  currentStreak: number
  bestStreak: number
}

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

function ProfileSkeleton() {
  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-8">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Skeleton className="h-20 w-20 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-5 w-28" />
        </div>
      </div>
      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-20 rounded-xl" />
        ))}
      </div>
      {/* Chart */}
      <Skeleton className="h-32 rounded-xl" />
      {/* History */}
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-12 rounded-lg" />
        ))}
      </div>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 rounded-xl border border-white/10 bg-white/5 px-3 py-4 text-center">
      <span className="text-xl font-bold text-white">{value}</span>
      <span className="text-xs text-white/50">{label}</span>
    </div>
  )
}

function AvatarCircle({ avatar, displayName }: { avatar: string | null; displayName: string }) {
  if (avatar) {
    return (
      <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-full border-2 border-white/20">
        <Image
          src={avatar}
          alt={displayName}
          fill
          className="object-cover"
          sizes="80px"
        />
      </div>
    )
  }

  const initials = displayName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()

  return (
    <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full border-2 border-white/20 bg-gradient-to-br from-purple-600 to-blue-600 text-xl font-bold text-white">
      {initials}
    </div>
  )
}

export default function ProfilePage() {
  const router = useRouter()
  const { data: session, status: sessionStatus } = useSession()

  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [historyEntries, setHistoryEntries] = useState<MatchHistoryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (sessionStatus === "loading") return
    if (!session?.user) {
      router.push("/login")
      return
    }

    async function fetchData() {
      try {
        const [profileRes, historyRes] = await Promise.all([
          fetch("/api/user/profile"),
          fetch("/api/user/history"),
        ])

        if (!profileRes.ok) throw new Error("Failed to load profile")

        const profileData: UserProfile = await profileRes.json()
        setProfile(profileData)

        if (historyRes.ok) {
          const historyData = await historyRes.json()
          setHistoryEntries(historyData.entries ?? [])
        }
      } catch {
        setError("Failed to load profile")
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [session, sessionStatus, router])

  if (sessionStatus === "loading" || loading) {
    return (
      <main className="min-h-screen">
        <ProfileSkeleton />
      </main>
    )
  }

  if (error || !profile) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-4">
        <p className="text-white/60">{error ?? "Profile not found"}</p>
        <Button onClick={() => router.push("/play")}>Go to Play</Button>
      </main>
    )
  }

  const winRate =
    profile.gamesPlayed > 0
      ? Math.round((profile.gamesWon / profile.gamesPlayed) * 100)
      : 0

  const eloHistory = historyEntries.map((e) => ({
    eloAfter: e.eloAfter,
    createdAt: e.createdAt,
  }))

  return (
    <main className="min-h-screen">
      <div className="mx-auto max-w-2xl space-y-6 px-4 py-8">
        {/* Profile header */}
        <div className="flex flex-wrap items-center gap-4">
          <AvatarCircle avatar={profile.avatar} displayName={profile.displayName} />

          <div className="flex-1 space-y-1.5">
            <h1 className="text-2xl font-bold text-white">{profile.displayName}</h1>
            <div className="flex flex-wrap items-center gap-2">
              <RankBadge rank={profile.rank} elo={profile.elo} size="md" />
              {profile.currentStreak > 0 && (
                <span className="text-sm font-semibold text-orange-400">
                  🔥 {profile.currentStreak}
                </span>
              )}
            </div>
          </div>

          <Button onClick={() => router.push("/play")} size="lg">
            Play Now
          </Button>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Games Played" value={profile.gamesPlayed} />
          <StatCard label="Games Won" value={profile.gamesWon} />
          <StatCard label="Win Rate" value={`${winRate}%`} />
          <StatCard label="Best Streak" value={profile.bestStreak} />
        </div>

        {/* Elo chart */}
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-white/50">
            Elo Trend
          </h2>
          <EloChart history={eloHistory} currentElo={profile.elo} />
        </section>

        {/* Match history */}
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-white/50">
            Recent Games
          </h2>
          <MatchHistory
            userId={session?.user?.id ?? ""}
            initialEntries={historyEntries}
          />
        </section>

        {/* API Token */}
        <ApiTokenSection />
      </div>
    </main>
  )
}
