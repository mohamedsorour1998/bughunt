// src/app/api/cron/tournament-tick/route.ts
import { NextRequest, NextResponse } from "next/server"
import { getAllActiveTournaments, advanceTournament, generateBracket } from "@/lib/tournaments"

export async function POST(req: NextRequest) {
  const secret = req.headers.get("authorization")?.replace("Bearer ", "")
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const tournaments = await getAllActiveTournaments()
  const now = Date.now()
  const results: string[] = []

  for (const t of tournaments) {
    // Auto-close registration and generate bracket when startTime arrives
    if (
      t.status === "registration_open" &&
      now >= t.startTime &&
      t.registeredPlayers.length >= 2
    ) {
      await generateBracket(t.tournamentId)
      results.push(`${t.tournamentId}: bracket generated`)
      continue
    }

    // Advance completed rounds (status is "round_<n>" for any bracket size, or "final")
    if (t.status.startsWith("round_") || t.status === "final") {
      await advanceTournament(t.tournamentId)
      results.push(`${t.tournamentId}: advance attempted`)
    }
  }

  return NextResponse.json({ processed: results })
}
