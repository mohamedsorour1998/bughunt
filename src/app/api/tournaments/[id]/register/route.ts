// src/app/api/tournaments/[id]/register/route.ts
import { NextRequest, NextResponse } from "next/server"
import { safeAuth } from "@/lib/test-auth"
import { getUser } from "@/lib/users"
import { registerForTournament } from "@/lib/tournaments"

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await safeAuth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id: tournamentId } = await params
  const userId = session.user.id

  const profile = await getUser(userId)
  if (!profile) {
    return NextResponse.json({ error: "User not found" }, { status: 404 })
  }

  const result = await registerForTournament(
    tournamentId,
    userId,
    profile.displayName,
    profile.elo
  )

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }

  return NextResponse.json({ success: true })
}
