import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { getGame, getGamePlayer, resolveGame } from "@/lib/game"
import { getBug } from "@/lib/bugs"
import { getTestSession, getTestSessionFromCookies } from "@/lib/test-auth"

export async function GET(request: NextRequest) {
  const session = (await auth()) ?? getTestSession(request) ?? await getTestSessionFromCookies()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const userId = session.user.id
  const { searchParams } = request.nextUrl
  const gameId = searchParams.get("gameId")

  if (!gameId) {
    return NextResponse.json({ error: "Missing gameId" }, { status: 400 })
  }

  let game = await getGame(gameId)
  if (!game) {
    return NextResponse.json({ error: "Game not found" }, { status: 404 })
  }

  // Verify requesting user is a participant
  if (game.player1Id !== userId && game.player2Id !== userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  // Auto-resolve timed-out games
  if (game.status === "active") {
    const elapsed = Date.now() - game.createdAt
    if (elapsed > 120000 + 5000) {  // 5s grace period
      try {
        await resolveGame(game.gameId)
        game = await getGame(gameId) ?? game
      } catch {
        // Serve stale game state rather than 500 on transient failure
      }
    }
  }

  // Get bug data if game is active or completed
  let bugData = null
  if (game.status === "active" || game.status === "completed") {
    const bug = await getBug(game.bugId)
    if (bug) {
      bugData = {
        bugId: bug.bugId,
        language: bug.language,
        category: bug.category,
        difficulty: bug.difficulty,
        buggyCode: bug.buggyCode,
        bugLine: bug.bugLine,
        options: bug.options,
        hint: bug.hint,
        // Only expose correctAnswer and explanation if game is completed
        ...(game.status === "completed"
          ? {
              correctAnswer: bug.correctAnswer,
              explanation: bug.explanation,
              correctCode: bug.correctCode,
            }
          : {}),
      }
    }
  }

  // Get the requesting user's GamePlayer record
  const playerRecord = await getGamePlayer(gameId, userId)

  return NextResponse.json({
    game,
    bug: bugData,
    player: playerRecord,
  })
}
