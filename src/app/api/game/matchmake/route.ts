import { NextResponse } from "next/server"
import { getUser, updateUser } from "@/lib/users"
import { getActiveGameForUser, createGame } from "@/lib/game"
import { selectBugsForGame } from "@/lib/bugs"
import { safeAuth, getTestSession, getTestSessionFromCookies } from "@/lib/test-auth"
import {
  enqueuePlayer, findAndClaimMatch, dequeuePlayer, rateLimitCheck,
  markQueueJoined, getQueueJoinedAt, clearQueueJoined,
} from "@/lib/redis"
import { pickBotForElo, ensureBotProfile } from "@/lib/bot"

export async function POST(req: Request) {
  try {
    return await handleMatchmake(req)
  } catch (err) {
    console.error("[matchmake] unhandled error:", err)
    return NextResponse.json(
      { error: "Internal server error", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}

async function handleMatchmake(req: Request) {
  const session = (await safeAuth()) ?? getTestSession(req) ?? await getTestSessionFromCookies()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const userId = session.user.id

  // Rate limit: 10 matchmake calls per minute (skip gracefully if Redis is unavailable)
  let allowed = true
  try {
    allowed = await rateLimitCheck(userId, "matchmake", 10, 60)
  } catch (err) {
    console.error("[matchmake] rateLimitCheck failed:", err)
  }
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
  let opponentId: string | null = null
  try {
    opponentId = await findAndClaimMatch(userId, elo)
  } catch (err) {
    console.error("[matchmake] findAndClaimMatch failed:", err)
  }

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
      await markQueueJoined(userId)
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
        await markQueueJoined(userId)
        return NextResponse.json({ status: "waiting", gameId: null })
      }
      throw err
    }

    await clearQueueJoined(userId)
    await clearQueueJoined(opponentId)

    // Update bugsSeen for both players
    await Promise.all([
      updateUser(userId, { bugsSeen: [...new Set([...userProfile.bugsSeen, ...bugIds])] }),
      opponentProfile
        ? updateUser(opponentId, { bugsSeen: [...new Set([...opponentProfile.bugsSeen, ...bugIds])] })
        : Promise.resolve(),
    ])

    return NextResponse.json({ gameId: game.gameId, status: "active" })
  }

  // No human opponent — stay queued, and track how long we've been waiting.
  let joinedAt: number | null = null
  try {
    await enqueuePlayer(userId, elo)
    await markQueueJoined(userId)
    joinedAt = await getQueueJoinedAt(userId)
  } catch (err) {
    console.error("[matchmake] Redis queue operations failed:", err)
  }

  // Bot fallback: if we've waited long enough, summon a Nova bot near our Elo.
  const botAfterMs = Number(process.env.BOT_MATCH_AFTER_MS ?? 10_000)
  // If Redis is unavailable (joinedAt null), human matchmaking is also unavailable —
  // treat as "waited long enough" so the bot path fires immediately rather than
  // leaving the user stuck in a waiting state with no path out.
  const waitedMs = joinedAt != null ? Date.now() - joinedAt : botAfterMs

  if (waitedMs >= botAfterMs) {
    const bot = pickBotForElo(elo)
    await ensureBotProfile(bot)
    const bugsForGame = await selectBugsForGame(
      Math.round((elo + bot.elo) / 2),
      userProfile.bugsSeen,
      [] // bots replay bugs freely
    )
    if (bugsForGame) {
      const bugIds = bugsForGame.map((b) => b.bugId)
      try { await dequeuePlayer(userId, elo) } catch { /* Redis best-effort */ }
      try { await clearQueueJoined(userId) } catch { /* Redis best-effort */ }
      const game = await createGame(userId, bot.userId, bugIds)
      await updateUser(userId, { bugsSeen: [...new Set([...userProfile.bugsSeen, ...bugIds])] })
      return NextResponse.json({ gameId: game.gameId, status: "active", opponentIsBot: true })
    }
  }

  return NextResponse.json({ status: "waiting", gameId: null })
}
