import { NextResponse } from "next/server"
import { getUser, updateUser } from "@/lib/users"
import { getActiveGameForUser, createGame } from "@/lib/game"
import { selectBugsForGame } from "@/lib/bugs"
import { safeAuth, getTestSession, getTestSessionFromCookies } from "@/lib/test-auth"
import { enqueuePlayer, findAndClaimMatch, dequeuePlayer, rateLimitCheck } from "@/lib/redis"

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
  // Atomically claims the opponent (zrem) at selection time so two concurrent
  // matchmake calls can't both pick the same queued player.
  const opponentId = await findAndClaimMatch(userId, elo)

  if (opponentId) {
    const opponentProfile = await getUser(opponentId)
    const avgElo = Math.round((elo + (opponentProfile?.elo ?? elo)) / 2)
    const bugsForGame = await selectBugsForGame(
      avgElo,
      userProfile.bugsSeen,
      opponentProfile?.bugsSeen ?? []
    )

    if (!bugsForGame) {
      // Opponent was already claimed (removed from queue) — re-enqueue them
      // so they aren't stranded, then fall back to waiting ourselves.
      await enqueuePlayer(opponentId, opponentProfile?.elo ?? elo)
      await enqueuePlayer(userId, elo)
      return NextResponse.json({ status: "waiting", gameId: null })
    }

    const bugIds = bugsForGame.map((b) => b.bugId)

    // Opponent is already removed from the queue (claimed atomically above);
    // only we still need to be dequeued before creating the game.
    await dequeuePlayer(userId, elo)

    let game
    try {
      game = await createGame(userId, opponentId, bugIds)
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "ConditionalCheckFailedException") {
        // Opponent was already claimed/removed from the queue — re-enqueue
        // them too so they aren't stranded by this failed attempt.
        await enqueuePlayer(opponentId, opponentProfile?.elo ?? elo)
        await enqueuePlayer(userId, elo)
        return NextResponse.json({ status: "waiting", gameId: null })
      }
      throw err
    }

    // Update bugsSeen for both players
    await Promise.all([
      updateUser(userId, { bugsSeen: [...new Set([...userProfile.bugsSeen, ...bugIds])] }),
      opponentProfile
        ? updateUser(opponentId, { bugsSeen: [...new Set([...opponentProfile.bugsSeen, ...bugIds])] })
        : Promise.resolve(),
    ])

    return NextResponse.json({ gameId: game.gameId, status: "active" })
  }

  // No opponent — add to queue
  await enqueuePlayer(userId, elo)
  return NextResponse.json({ status: "waiting", gameId: null })
}
