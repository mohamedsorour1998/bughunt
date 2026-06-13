import { NextRequest, NextResponse } from "next/server"
import {
  getGame,
  getGamePlayer,
  submitRoundAnswer,
  advanceOrResolveRound,
  ROUND_DURATION_MS,
} from "@/lib/game"
import { getBug } from "@/lib/bugs"
import { safeAuth, getTestSession, getTestSessionFromCookies } from "@/lib/test-auth"
import { maybePlayBotRound } from "@/lib/bot"

export async function GET(request: NextRequest) {
  const session = (await safeAuth()) ?? getTestSession(request) ?? await getTestSessionFromCookies()
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

  // Auto-advance/resolve timed-out rounds
  if (game.status === "active") {
    const round = game.currentRound
    const roundStartedAt = game.roundStartedAt[round]
    const elapsed = Date.now() - roundStartedAt
    if (elapsed > ROUND_DURATION_MS + 5000) { // 5s grace period
      try {
        const bug = await getBug(game.bugIds[round])
        if (bug) {
          const now = Date.now()
          const participants = [game.player1Id, game.player2Id].filter((id): id is string => id !== null)
          const records = await Promise.all(participants.map((id) => getGamePlayer(gameId, id)))
          await Promise.all(
            participants.map((id, i) => {
              const submitted = records[i]?.answers?.[round]?.submittedAt != null
              if (submitted) return Promise.resolve()
              return submitRoundAnswer(gameId, id, round, bug, null, now, roundStartedAt)
            })
          )
        }
        await advanceOrResolveRound(gameId)
        game = await getGame(gameId) ?? game
      } catch {
        // Serve stale game state rather than 500 on transient failure
      }
    }
  }

  // Lazy bot driver — the human's own poll powers the bot's turn.
  if (game.status === "active") {
    const botActed = await maybePlayBotRound(game).catch(() => false)
    if (botActed) game = (await getGame(gameId)) ?? game
  }

  // Get bug data
  let bugData: Record<string, unknown> | null = null
  let bugsData: Record<string, unknown>[] | null = null

  if (game.status === "active") {
    const bug = await getBug(game.bugIds[game.currentRound])
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
      }
    }
  } else if (game.status === "completed") {
    const bugs = await Promise.all(game.bugIds.map((id) => getBug(id)))
    bugsData = bugs.filter((b) => b !== null).map((bug) => ({
      bugId: bug!.bugId,
      language: bug!.language,
      category: bug!.category,
      difficulty: bug!.difficulty,
      buggyCode: bug!.buggyCode,
      bugLine: bug!.bugLine,
      options: bug!.options,
      hint: bug!.hint,
      correctAnswer: bug!.correctAnswer,
      explanation: bug!.explanation,
      correctCode: bug!.correctCode,
    }))
    bugData = bugsData[0] ?? null
  }

  // Get the requesting user's GamePlayer record
  const playerRecord = await getGamePlayer(gameId, userId)

  return NextResponse.json({
    game,
    bug: bugData,
    bugs: bugsData,
    player: playerRecord,
  })
}
