/**
 * GET /api/game/rematch/status?opponentId=<id>
 *
 * Checks whether a mutual rematch exists:
 *   - Both REMATCH#<userId> SK=<opponentId> AND REMATCH#<opponentId> SK=<userId> must exist
 *   - Both must not be expired (expiresAt > now in epoch seconds)
 *
 * If mutual: creates the game, deletes both rematch items, returns { status: "matched", gameId }
 * If pending: returns { status: "pending" }
 * If expired/missing: returns { status: "expired" }
 */
import { NextRequest, NextResponse } from "next/server"
import { getItem, deleteItem } from "@/lib/dynamodb"
import { getUser } from "@/lib/users"
import { selectBugsForGame } from "@/lib/bugs"
import { createGame } from "@/lib/game"
import { safeAuth, getTestSession, getTestSessionFromCookies } from "@/lib/test-auth"

export async function GET(request: NextRequest) {
  const session =
    (await safeAuth()) ??
    getTestSession(request) ??
    (await getTestSessionFromCookies())
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const userId = session.user.id
  const { searchParams } = new URL(request.url)
  const opponentId = searchParams.get("opponentId")

  if (!opponentId) {
    return NextResponse.json({ error: "Missing opponentId" }, { status: 400 })
  }

  const nowSec = Math.floor(Date.now() / 1000)

  // Check my rematch request
  const myRematch = await getItem(`REMATCH#${userId}`, opponentId)
  if (!myRematch || (myRematch.expiresAt as number) <= nowSec) {
    return NextResponse.json({ status: "expired" })
  }

  // Check opponent's rematch request
  const opponentRematch = await getItem(`REMATCH#${opponentId}`, userId)
  if (!opponentRematch || (opponentRematch.expiresAt as number) <= nowSec) {
    return NextResponse.json({ status: "pending" })
  }

  // Mutual rematch — create the game
  const [myProfile, opponentProfile] = await Promise.all([
    getUser(userId),
    getUser(opponentId),
  ])

  if (!myProfile || !opponentProfile) {
    return NextResponse.json({ error: "User not found" }, { status: 404 })
  }

  const avgElo = Math.round((myProfile.elo + opponentProfile.elo) / 2)
  const bugs = await selectBugsForGame(avgElo, myProfile.bugsSeen, opponentProfile.bugsSeen)

  if (!bugs) {
    return NextResponse.json({ error: "No bug available" }, { status: 503 })
  }

  const game = await createGame(userId, opponentId, bugs.map((b) => b.bugId))

  // Clean up rematch items (best-effort)
  await Promise.all([
    deleteItem(`REMATCH#${userId}`, opponentId).catch(() => undefined),
    deleteItem(`REMATCH#${opponentId}`, userId).catch(() => undefined),
  ])

  return NextResponse.json({ status: "matched", gameId: game.gameId })
}
