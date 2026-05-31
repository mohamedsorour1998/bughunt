// src/app/api/tournaments/route.ts
import { NextRequest, NextResponse } from "next/server"
import { safeAuth } from "@/lib/test-auth"
import { createTournament, getAllActiveTournaments } from "@/lib/tournaments"

export async function GET() {
  const tournaments = await getAllActiveTournaments()
  return NextResponse.json({ tournaments })
}

export async function POST(req: NextRequest) {
  const session = await safeAuth()
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const adminEmails = (process.env.ADMIN_EMAILS ?? "").split(",").map((s) => s.trim().toLowerCase())
  if (!adminEmails.includes(session.user.email.toLowerCase())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { name, startTime, maxPlayers, prizeDescription } = await req.json() as {
    name: string
    startTime: number
    maxPlayers?: number
    prizeDescription?: string
  }

  if (!name || !startTime) {
    return NextResponse.json({ error: "name and startTime required" }, { status: 400 })
  }

  const tournament = await createTournament(
    name,
    startTime,
    maxPlayers ?? 8,
    prizeDescription ?? ""
  )

  return NextResponse.json(tournament, { status: 201 })
}
