import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { getGame, getGamePlayer, resolveGame } from "@/lib/game"
import { getBug } from "@/lib/bugs"
import { putItemIfNotExists, getItem } from "@/lib/dynamodb"

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const userId = session.user.id

  let body: { gameId: string; answer: number }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  }

  const { gameId, answer } = body

  if (!gameId || answer === undefined || answer === null) {
    return NextResponse.json({ error: "Missing gameId or answer" }, { status: 400 })
  }

  if (typeof answer !== "number" || answer < 0 || answer > 3) {
    return NextResponse.json({ error: "Answer must be 0-3" }, { status: 400 })
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

  // Check timer: 120 seconds
  const now = Date.now()
  if (now > game.createdAt + 120_000) {
    return NextResponse.json({ error: "Time expired" }, { status: 400 })
  }

  // Get bug for correctAnswer check
  const bug = await getBug(game.bugId)
  if (!bug) {
    return NextResponse.json({ error: "Bug not found" }, { status: 500 })
  }

  const correct = answer === bug.correctAnswer
  const submittedAt = now
  const timeElapsedMs = now - game.createdAt

  // putItemIfNotExists — returns false if already submitted (409)
  const written = await putItemIfNotExists({
    pk: `GAME#${gameId}`,
    sk: `PLAYER#${userId}`,
    gameId,
    userId,
    answer,
    correct,
    submittedAt,
    timeElapsedMs,
  })

  if (!written) {
    return NextResponse.json({ error: "Already submitted" }, { status: 409 })
  }

  // Check if game should resolve:
  // - Both players have submitted, OR
  // - Timer has expired for the other player (they can no longer submit)
  const otherId = game.player1Id === userId ? game.player2Id : game.player1Id
  let shouldResolve = false

  if (!otherId) {
    // Solo game — resolve immediately
    shouldResolve = true
  } else {
    const otherPlayerRecord = await getGamePlayer(gameId, otherId)
    if (otherPlayerRecord?.submittedAt !== null && otherPlayerRecord !== null) {
      // Both have submitted
      shouldResolve = true
    } else if (now > game.createdAt + 120_000) {
      // Timer expired for other player
      shouldResolve = true
    }
  }

  if (shouldResolve) {
    await resolveGame(gameId)
  }

  return NextResponse.json({ correct, answer, submittedAt })
}
