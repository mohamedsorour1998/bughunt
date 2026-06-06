import { NextResponse } from "next/server"
import { getUser, updateUser } from "@/lib/users"
import { getActiveGameForUser, createGame } from "@/lib/game"
import { selectBugForGame } from "@/lib/bugs"
import { safeAuth, getTestSession, getTestSessionFromCookies } from "@/lib/test-auth"
import { enqueuePlayer, findMatch, dequeuePlayer, rateLimitCheck } from "@/lib/redis"

export async function POST(req: Request) {
  const session = (await safeAuth()) ?? getTestSession(req) ?? await getTestSessionFromCookies()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const userId = session.user.id

  // Rate limit: 10 matchmake calls per minute
  const allowed = await rateLimitCheck(userId, "matchmake", 10, 60)
  if (!allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  // Check if user already has an active/waiting game
  const activeGame = await getActiveGameForUser(userId)
  if (activeGame) {
    // If still waiting, ensure we're in the Redis queue so opponents can find us
    if (activeGame.status === "waiting") {
      const userProfile = await getUser(userId)
      if (userProfile) await enqueuePlayer(userId, userProfile.elo).catch(() => {})
    }
    return NextResponse.json({ gameId: activeGame.gameId, status: activeGame.status })
  }

  const userProfile = await getUser(userId)
  if (!userProfile) {
    return NextResponse.json({ error: "User not found" }, { status: 404 })
  }

  const elo = userProfile.elo
  const opponentId = await findMatch(userId, elo)

  if (opponentId) {
    const opponentProfile = await getUser(opponentId)
    const avgElo = Math.round((elo + (opponentProfile?.elo ?? elo)) / 2)
    const bugForGame = await selectBugForGame(
      avgElo,
      userProfile.bugsSeen,
      opponentProfile?.bugsSeen ?? []
    )

    if (!bugForGame) {
      await enqueuePlayer(userId, elo)
      return NextResponse.json({ status: "waiting", gameId: null })
    }

    // Dequeue both before creating game
    await Promise.all([
      dequeuePlayer(userId, elo),
      dequeuePlayer(opponentId, opponentProfile?.elo ?? elo),
    ])

    let game
    try {
      game = await createGame(userId, opponentId, bugForGame.bugId)
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "ConditionalCheckFailedException") {
        await enqueuePlayer(userId, elo)
        return NextResponse.json({ status: "waiting", gameId: null })
      }
      throw err
    }

    // Update bugsSeen for both players
    await Promise.all([
      updateUser(userId, { bugsSeen: [...new Set([...userProfile.bugsSeen, bugForGame.bugId])] }),
      opponentProfile
        ? updateUser(opponentId, { bugsSeen: [...new Set([...opponentProfile.bugsSeen, bugForGame.bugId])] })
        : Promise.resolve(),
    ])

    return NextResponse.json({ gameId: game.gameId, status: "active" })
  }

  // No opponent — add to queue
  await enqueuePlayer(userId, elo)
  return NextResponse.json({ status: "waiting", gameId: null })
}
