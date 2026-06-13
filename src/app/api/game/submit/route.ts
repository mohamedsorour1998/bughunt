import { NextRequest, NextResponse } from "next/server"
import { getGame, submitRoundAnswer, advanceOrResolveRound, ROUND_DURATION_MS } from "@/lib/game"
import { getBug } from "@/lib/bugs"
import { safeAuth, getTestSession, getTestSessionFromCookies } from "@/lib/test-auth"
import { publishGameEvent } from "@/lib/redis"
import { maybePlayBotRound } from "@/lib/bot"

export async function POST(request: NextRequest) {
  const session = (await safeAuth()) ?? getTestSession(request) ?? await getTestSessionFromCookies()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const userId = session.user.id

  let body: { gameId: string; roundIndex: number; answer: number }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  }

  const { gameId, roundIndex, answer } = body

  if (!gameId || answer === undefined || answer === null || roundIndex === undefined || roundIndex === null) {
    return NextResponse.json({ error: "Missing gameId, roundIndex, or answer" }, { status: 400 })
  }

  if (typeof answer !== "number" || answer < 0 || answer > 3) {
    return NextResponse.json({ error: "Answer must be 0-3" }, { status: 400 })
  }

  if (typeof roundIndex !== "number") {
    return NextResponse.json({ error: "roundIndex must be a number" }, { status: 400 })
  }

  const game = await getGame(gameId)
  if (!game) {
    return NextResponse.json({ error: "Game not found" }, { status: 404 })
  }

  if (game.status !== "active") {
    return NextResponse.json({ error: "Game is not active" }, { status: 400 })
  }

  // Verify requesting user is a participant
  if (game.player1Id !== userId && game.player2Id !== userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  if (roundIndex !== game.currentRound) {
    return NextResponse.json({ error: "Wrong round" }, { status: 400 })
  }

  const roundStartedAt = game.roundStartedAt[roundIndex]

  // Check timer: 120 seconds per round
  const now = Date.now()
  if (now > roundStartedAt + ROUND_DURATION_MS) {
    return NextResponse.json({ error: "Time expired" }, { status: 400 })
  }

  const bug = await getBug(game.bugIds[roundIndex])
  if (!bug) {
    return NextResponse.json({ error: "Bug not found" }, { status: 500 })
  }

  const result = await submitRoundAnswer(gameId, userId, roundIndex, bug, answer, now, roundStartedAt)
  if (!result.written) {
    return NextResponse.json({ error: "Already submitted" }, { status: 409 })
  }

  publishGameEvent(gameId, {
    type: "player_submitted",
    userId,
    roundIndex,
    correct: result.correct,
    timeElapsedMs: result.timeElapsedMs,
  }).catch(() => {/* Redis failure must not break game flow */})

  await advanceOrResolveRound(gameId)

  // If the opponent is a bot whose think-delay has elapsed, let it take its
  // turn in this same request (covers the SSE-only client that never polls status).
  const updatedGame = await getGame(gameId)
  if (updatedGame) await maybePlayBotRound(updatedGame).catch(() => {})

  return NextResponse.json({
    correct: result.correct,
    answer,
    submittedAt: now,
    roundIndex,
  })
}
