import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { getGame, getGamePlayer } from "@/lib/game"
import { getBug } from "@/lib/bugs"
import { queryItems } from "@/lib/dynamodb"

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

  // Fetch bug data (only revealed when game is completed)
  const bugData = isCompleted ? await getBug(game.bugId) : null

  // Fetch match history entry for this user if game is completed
  let matchHistoryEntry: {
    result: string
    eloBefore: number
    eloAfter: number
    eloChange: number
  } | null = null

  if (isCompleted) {
    // Query USER#userId items with SK starting with GAME# and containing gameId
    const { items } = await queryItems(
      "pk = :pk AND begins_with(sk, :skPrefix)",
      { ":pk": `USER#${userId}`, ":skPrefix": "GAME#" },
      { limit: 50, scanIndexForward: false }
    )
    const histItem = items.find((item) => {
      const sk = item.sk as string
      return sk.includes(gameId)
    })
    if (histItem) {
      matchHistoryEntry = {
        result: histItem.result as string,
        eloBefore: histItem.eloBefore as number,
        eloAfter: histItem.eloAfter as number,
        eloChange: histItem.eloChange as number,
      }
    }
  }

  return NextResponse.json({
    game,
    bug: bugData,
    players: {
      player1: sanitizePlayer(p1Player, isPlayer1),
      player2: sanitizePlayer(p2Player, !isPlayer1),
    },
    matchHistoryEntry,
  })
}
