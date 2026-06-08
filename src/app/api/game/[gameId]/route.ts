import { NextRequest, NextResponse } from "next/server"
import { getGame, getGamePlayer, type GamePlayer, type RoundAnswer } from "@/lib/game"
import { getBug } from "@/lib/bugs"
import { getItem } from "@/lib/dynamodb"
import { safeAuth, getTestSession, getTestSessionFromCookies } from "@/lib/test-auth"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ gameId: string }> }
) {
  const session = (await safeAuth()) ?? getTestSession(request) ?? await getTestSessionFromCookies()
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

  // Don't reveal opponent's answers until game is completed
  const isCompleted = game.status === "completed"

  const sanitizePlayer = (player: GamePlayer | null, isRequester: boolean) => {
    if (!player) return null
    const answers = player.answers.map((a: RoundAnswer) => {
      const submitted = a.submittedAt !== null
      if (isCompleted || isRequester) {
        return { ...a, submitted }
      }
      // Hide the opponent's answer/correct/time while the game is active —
      // expose only whether (and when) they've submitted each round so the
      // UI can show "opponent answered, waiting on you" without leaking it.
      return {
        bugId: a.bugId,
        submitted,
        submittedAt: a.submittedAt,
        answer: null,
        correct: null,
        timeElapsedMs: null,
      }
    })
    return { userId: player.userId, answers }
  }

  const isPlayer1 = game.player1Id === userId

  // Fetch bug data (only revealed when game is completed)
  const bugs = isCompleted ? (await Promise.all(game.bugIds.map((id) => getBug(id)))).filter((b) => b !== null) : []
  const bugData = bugs.length > 0 ? bugs[0] : null

  // Fetch match history entry for this user if game is completed
  let matchHistoryEntry: {
    result: string
    eloBefore: number
    eloAfter: number
    eloChange: number
    newAchievements: string[]
  } | null = null

  if (isCompleted) {
    const histItem = await getItem(`USER#${userId}`, `GAMEID#${game.gameId}`)
    if (histItem) {
      matchHistoryEntry = {
        result: histItem.result as string,
        eloBefore: histItem.eloBefore as number,
        eloAfter: histItem.eloAfter as number,
        eloChange: histItem.eloChange as number,
        newAchievements: (histItem.newAchievements as string[]) ?? [],
      }
    }
  }

  return NextResponse.json({
    game,
    bug: bugData,
    bugs: isCompleted ? bugs : null,
    players: {
      player1: sanitizePlayer(p1Player, isPlayer1),
      player2: sanitizePlayer(p2Player, !isPlayer1),
    },
    matchHistoryEntry,
  })
}
