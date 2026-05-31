// src/app/api/game/join/[gameId]/route.ts
import { NextRequest, NextResponse } from "next/server"
import { safeAuth, getTestSession, getTestSessionFromCookies } from "@/lib/test-auth"
import { getItem, updateItem, putItem } from "@/lib/dynamodb"

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ gameId: string }> }
) {
  const session = (await safeAuth()) ?? getTestSession(req) ?? (await getTestSessionFromCookies())
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const userId = session.user.id
  const { gameId } = await params

  const item = await getItem(`GAME#${gameId}`, "META")
  if (!item) {
    return NextResponse.json({ error: "Game not found" }, { status: 404 })
  }

  if (!item.isPrivate) {
    return NextResponse.json({ error: "Not a private game" }, { status: 400 })
  }

  if (item.status !== "waiting") {
    // Creator polling or game already active — return current status
    return NextResponse.json({ status: item.status as string, gameId })
  }

  if (item.player1Id === userId) {
    // Creator polling — game not yet joined
    return NextResponse.json({ status: "waiting", gameId })
  }

  // Join as player2: set player2Id and change status to active
  await updateItem(`GAME#${gameId}`, "META", {
    player2Id: userId,
    status: "active",
  })

  // Write GSI tracking item for player2
  await putItem({
    pk: `GAME#${gameId}`,
    sk: `ACTIVE_PLAYER#${userId}`,
    gameId,
    userId,
    expiresAt: item.expiresAt as number,
    gsi1pk: `ACTIVE_GAME#${userId}`,
    gsi1sk: gameId,
  })

  return NextResponse.json({ status: "joined", gameId })
}
