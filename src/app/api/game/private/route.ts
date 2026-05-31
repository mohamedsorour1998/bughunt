// src/app/api/game/private/route.ts
import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { createGame } from "@/lib/game"
import { selectBugForGame } from "@/lib/bugs"
import { getUser } from "@/lib/users"

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const player1Id = session.user.id
  // Accept optional body but don't require it
  await req.json().catch(() => ({}))

  const player1Profile = await getUser(player1Id)

  const bug = await selectBugForGame(
    player1Profile?.elo ?? 1200,
    player1Profile?.bugsSeen ?? [],
    []
  )

  if (!bug) {
    return NextResponse.json({ error: "Bug not found" }, { status: 404 })
  }

  const game = await createGame(player1Id, null, bug.bugId, {
    isPrivate: true,
    affectsElo: false,
    waitForPlayer2: true,
  })

  const baseUrl = process.env.NEXTAUTH_URL ?? "https://bughunt.vercel.app"
  const joinUrl = `${baseUrl}/play?join=${game.gameId}`

  return NextResponse.json({ gameId: game.gameId, joinUrl })
}
