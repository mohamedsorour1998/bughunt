// src/app/(game)/tournaments/page.tsx
"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { Tournament } from "@/lib/tournaments"

function Countdown({ targetMs }: { targetMs: number }) {
  const [remaining, setRemaining] = useState(targetMs - Date.now())

  useEffect(() => {
    const iv = setInterval(() => setRemaining(targetMs - Date.now()), 1000)
    return () => clearInterval(iv)
  }, [targetMs])

  if (remaining <= 0) return <span className="text-green-400 text-sm">Starting soon</span>

  const totalSec = Math.floor(remaining / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60

  return (
    <span className="font-mono text-sm text-yellow-300">
      {String(h).padStart(2, "0")}:{String(m).padStart(2, "0")}:{String(s).padStart(2, "0")}
    </span>
  )
}

const STATUS_LABELS: Record<string, string> = {
  registration_open: "Registration Open",
  registration_closed: "Starting",
  round_1: "Round 1 Active",
  round_2: "Round 2 Active",
  final: "Final",
  completed: "Completed",
  created: "Upcoming",
}

export default function TournamentsPage() {
  const [tournaments, setTournaments] = useState<Tournament[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/tournaments")
      .then((r) => r.json())
      .then((d) => {
        setTournaments(d.tournaments ?? [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-8">
        <p className="text-white/50">Loading tournaments...</p>
      </div>
    )
  }

  const upcoming = tournaments.filter(
    (t) => t.status === "registration_open" || t.status === "created"
  )
  const active = tournaments.filter(
    (t) =>
      t.status === "round_1" ||
      t.status === "round_2" ||
      t.status === "final" ||
      t.status === "registration_closed"
  )

  return (
    <div className="mx-auto max-w-2xl space-y-8 px-4 py-8">
      <h1 className="text-2xl font-bold text-white">Tournaments</h1>

      {upcoming.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-white/50">
            Upcoming
          </h2>
          {upcoming.map((t) => (
            <Card key={t.tournamentId} className="border-white/10 bg-white/5">
              <CardHeader className="pb-2">
                <CardTitle className="text-white">{t.name}</CardTitle>
              </CardHeader>
              <CardContent className="flex items-center justify-between gap-4">
                <div className="space-y-1">
                  <p className="text-xs text-white/50">
                    {STATUS_LABELS[t.status]}
                  </p>
                  <p className="text-xs text-white/40">
                    {t.registeredPlayers.length} / {t.maxPlayers} players
                  </p>
                  {t.startTime > Date.now() && (
                    <div className="flex items-center gap-2 text-xs text-white/40">
                      Starts in: <Countdown targetMs={t.startTime} />
                    </div>
                  )}
                  {t.prizeDescription && (
                    <p className="text-xs text-yellow-300/70">{t.prizeDescription}</p>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() =>
                      fetch(`/api/tournaments/${t.tournamentId}/register`, {
                        method: "POST",
                      }).then(() => window.location.reload())
                    }
                    disabled={t.status !== "registration_open"}
                  >
                    Register
                  </Button>
                  <Button size="sm" variant="outline" asChild>
                    <Link href={`/tournaments/${t.tournamentId}`}>View</Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </section>
      )}

      {active.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-white/50">
            Live
          </h2>
          {active.map((t) => (
            <Card key={t.tournamentId} className="border-yellow-500/30 bg-yellow-900/10">
              <CardHeader className="pb-2">
                <CardTitle className="text-white">{t.name}</CardTitle>
              </CardHeader>
              <CardContent className="flex items-center justify-between gap-4">
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-yellow-300">
                    {STATUS_LABELS[t.status]}
                  </p>
                  <p className="text-xs text-white/40">
                    {t.registeredPlayers.length} players
                  </p>
                </div>
                <Button size="sm" variant="outline" asChild>
                  <Link href={`/tournaments/${t.tournamentId}`}>Watch Bracket</Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </section>
      )}

      {upcoming.length === 0 && active.length === 0 && (
        <div className="rounded-xl border border-white/10 bg-white/5 px-6 py-16 text-center">
          <p className="text-white/50">No tournaments scheduled right now.</p>
          <p className="mt-1 text-sm text-white/30">Check back soon!</p>
        </div>
      )}
    </div>
  )
}
