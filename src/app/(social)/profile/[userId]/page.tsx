"use client"

import { useEffect, useState } from "react"
import { useRouter, useParams } from "next/navigation"
import { useSession } from "next-auth/react"
import Image from "next/image"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { RankBadge } from "@/components/ui/RankBadge"
import { MatchHistory } from "@/components/profile/MatchHistory"

type PublicProfile = {
  userId: string
  displayName: string
  avatar: string | null
  elo: number
  rank: string
  gamesPlayed: number
  gamesWon: number
  currentStreak: number
  bestStreak: number
  followerCount: number
  followingCount: number
}

function ProfileSkeleton() {
  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-8">
      <div className="flex items-center gap-4">
        <Skeleton className="h-20 w-20 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-5 w-28" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-20 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-32 rounded-xl" />
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

export default function PublicProfilePage() {
  const router = useRouter()
  const params = useParams()
  const userId = params.userId as string
  const { data: session } = useSession()

  const [profile, setProfile] = useState<PublicProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isFollowing, setIsFollowing] = useState(false)
  const [followLoading, setFollowLoading] = useState(false)
  const [followerCount, setFollowerCount] = useState(0)
  const [followingCount, setFollowingCount] = useState(0)

  const isOwnProfile = session?.user?.id === userId

  useEffect(() => {
    if (!userId) return

    async function fetchProfile() {
      try {
        const res = await fetch(`/api/user/profile/${userId}`)
        if (res.status === 404) {
          setError("User not found")
          return
        }
        if (!res.ok) throw new Error("Failed to load profile")
        const data: PublicProfile = await res.json()
        setProfile(data)
        setFollowerCount(data.followerCount ?? 0)
        setFollowingCount(data.followingCount ?? 0)

        // Check follow status only when viewing someone else's profile
        if (session?.user?.id && session.user.id !== userId) {
          const followRes = await fetch("/api/social/following")
          if (followRes.ok) {
            const { following } = (await followRes.json()) as { following: { userId: string }[] }
            setIsFollowing(following.some((f) => f.userId === userId))
          }
        }
      } catch {
        setError("Failed to load profile")
      } finally {
        setLoading(false)
      }
    }

    fetchProfile()
  }, [userId, session?.user?.id])

  async function handleFollowToggle() {
    if (!session?.user?.id) return
    setFollowLoading(true)
    try {
      if (isFollowing) {
        const res = await fetch(`/api/social/follow?followeeId=${userId}`, { method: "DELETE" })
        if (res.ok) {
          setIsFollowing(false)
          setFollowerCount((c) => Math.max(0, c - 1))
        }
      } else {
        const res = await fetch("/api/social/follow", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ followeeId: userId }),
        })
        if (res.ok) {
          setIsFollowing(true)
          setFollowerCount((c) => c + 1)
        }
      }
    } finally {
      setFollowLoading(false)
    }
  }

  async function handleChallenge() {
    if (!session?.user?.id) return
    const res = await fetch("/api/social/challenge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ challengedId: userId }),
    })
    if (res.ok) {
      alert("Challenge sent!")
    }
  }

  if (loading) {
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
        <Button onClick={() => router.back()}>Go Back</Button>
      </main>
    )
  }

  const winRate =
    profile.gamesPlayed > 0
      ? Math.round((profile.gamesWon / profile.gamesPlayed) * 100)
      : 0

  return (
    <main className="min-h-screen">
      <div className="mx-auto max-w-2xl space-y-6 px-4 py-8">
        {/* Profile header */}
        <div className="flex flex-wrap items-center gap-4">
          <AvatarCircle avatar={profile.avatar} displayName={profile.displayName} />

          <div className="flex-1 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold text-white">{profile.displayName}</h1>
              {isOwnProfile && (
                <Badge variant="secondary" className="text-xs">
                  This is you
                </Badge>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <RankBadge rank={profile.rank} elo={profile.elo} size="md" />
              {profile.currentStreak > 0 && (
                <span className="text-sm font-semibold text-orange-400">
                  🔥 {profile.currentStreak}
                </span>
              )}
            </div>
          </div>

          {isOwnProfile ? (
            <Button onClick={() => router.push("/play")} size="lg">
              Play Now
            </Button>
          ) : session?.user?.id ? (
            <div className="flex items-center gap-2">
              <Button
                onClick={handleFollowToggle}
                disabled={followLoading}
                variant={isFollowing ? "secondary" : "default"}
                size="lg"
              >
                {followLoading ? "..." : isFollowing ? "Unfollow" : "Follow"}
              </Button>
              <Button
                onClick={handleChallenge}
                variant="outline"
                size="lg"
              >
                Challenge
              </Button>
            </div>
          ) : null}
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Games Played" value={profile.gamesPlayed} />
          <StatCard label="Games Won" value={profile.gamesWon} />
          <StatCard label="Win Rate" value={`${winRate}%`} />
          <StatCard label="Best Streak" value={profile.bestStreak} />
        </div>

        {/* Follower/Following counts */}
        <div className="flex gap-6 text-sm text-white/60">
          <span>
            <span className="font-semibold text-white">{followerCount}</span> Followers
          </span>
          <span>
            <span className="font-semibold text-white">{followingCount}</span> Following
          </span>
        </div>

        {/* Match history — only for own profile */}
        {isOwnProfile && (
          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-white/50">
              Recent Games
            </h2>
            <MatchHistory userId={userId} />
          </section>
        )}
      </div>
    </main>
  )
}
