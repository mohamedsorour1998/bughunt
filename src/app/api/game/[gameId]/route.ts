import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { getGame, getGamePlayer } from "@/lib/game"

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ gameId: string }> }
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const userId = session.user.id
  const { gameId } = await params

  const game = await getGame(gameId)
  if (!game) {
    return NextResponse.json({ error: "Game not found" }, { status: 404 })
  }

  // Verify requesting user is a participant
  if (game.player1Id !== userId && game.player2Id !== userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  // Get both players' submission status
  const [p1Player, p2Player] = await Promise.all([
    getGamePlayer(gameId, game.player1Id),
    game.player2Id ? getGamePlayer(gameId, game.player2Id) : Promise.resolve(null),
  ])

  // Don't reveal opponent's answer until game is completed
  const isCompleted = game.status === "completed"

  const sanitizePlayer = (
    player: Awaited<ReturnType<typeof getGamePlayer>>,
    isRequester: boolean
  ) => {
    if (!player) return null
    return {
      userId: player.userId,
      submitted: player.submittedAt !== null,
      submittedAt: player.submittedAt,
      // Only reveal answer/correct if completed, or if it's the requesting user
      ...(isCompleted || isRequester
        ? {
            answer: player.answer,
            correct: player.correct,
            timeElapsedMs: player.timeElapsedMs,
          }
        : {
            answer: null,
            correct: null,
            timeElapsedMs: null,
          }),
    }
  }

  const isPlayer1 = game.player1Id === userId

  return NextResponse.json({
    game,
    players: {
      player1: sanitizePlayer(p1Player, isPlayer1),
      player2: sanitizePlayer(p2Player, !isPlayer1),
    },
  })
}
