// src/app/(social)/org/[id]/page.tsx
"use client"

import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import { useSession } from "next-auth/react"
import { Button } from "@/components/ui/button"
import { LeaderboardTable } from "@/components/leaderboard/LeaderboardTable"
import type { Org, OrgMember } from "@/lib/orgs"

type LeaderboardEntry = {
  userId: string
  displayName: string
  elo: number
}

export default function OrgDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { data: session } = useSession()
  const [org, setOrg] = useState<Org | null>(null)
  const [members, setMembers] = useState<OrgMember[]>([])
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      fetch(`/api/org/${id}`).then((r) => r.json()),
      fetch(`/api/org/${id}/leaderboard`).then((r) => r.json()),
    ])
      .then(([orgData, lbData]) => {
        setOrg(orgData.org ?? null)
        setMembers(orgData.members ?? [])
        setLeaderboard(lbData.players ?? [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [id])

  async function handleRegenerateInvite() {
    const res = await fetch(`/api/org/${id}/invite`, { method: "POST" })
    const data = await res.json()
    if (res.ok && data.inviteCode) {
      setOrg((prev) => (prev ? { ...prev, inviteCode: data.inviteCode } : prev))
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-8">
        <p className="text-white/50">Loading...</p>
      </div>
    )
  }

  if (!org) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-8">
        <p className="text-white/50">Org not found.</p>
      </div>
    )
  }

  const isAdmin = session?.user?.id === org.adminId

  // Map leaderboard entries to the shape LeaderboardTable expects
  const lbPlayers = leaderboard.map((p, i) => ({
    rank: i + 1,
    userId: p.userId,
    displayName: p.displayName,
    elo: p.elo,
    gamesPlayed: 0,
    gamesWon: 0,
    winRate: 0,
  }))

  return (
    <div className="mx-auto max-w-2xl space-y-8 px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">{org.name}</h1>
        <span className="text-xs text-white/40">{members.length} members</span>
      </div>

      {/* Invite code — admin only */}
      {isAdmin && (
        <div className="rounded-xl border border-white/10 bg-white/5 p-5">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-white/50">
            Invite Code
          </h2>
          <div className="flex items-center gap-3">
            <span className="rounded-lg border border-white/20 bg-white/10 px-4 py-2 font-mono text-lg text-white tracking-widest">
              {org.inviteCode}
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => navigator.clipboard.writeText(org.inviteCode)}
            >
              Copy
            </Button>
            <Button size="sm" variant="outline" onClick={handleRegenerateInvite}>
              Regenerate
            </Button>
          </div>
        </div>
      )}

      {/* Leaderboard */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-white/50">
          Leaderboard
        </h2>
        {lbPlayers.length === 0 ? (
          <p className="text-sm text-white/40">No rankings yet.</p>
        ) : (
          <LeaderboardTable
            players={lbPlayers}
            currentUserId={session?.user?.id}
          />
        )}
      </div>

      {/* Member list */}
      <div className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-white/50">
          Members
        </h2>
        <div className="divide-y divide-white/5 rounded-xl border border-white/10 overflow-hidden">
          {members.map((m) => (
            <div key={m.userId} className="flex items-center justify-between px-4 py-3">
              <div>
                <p className="text-sm font-medium text-white">{m.displayName}</p>
                <p className="text-xs text-white/40">{m.role}</p>
              </div>
              <span className="font-mono text-sm text-white/60">{m.elo} Elo</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
