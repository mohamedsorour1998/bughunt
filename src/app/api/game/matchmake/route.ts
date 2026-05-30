import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { getUser } from "@/lib/users"
import { getActiveGameForUser, createGame } from "@/lib/game"
import { selectBugForGame } from "@/lib/bugs"
import { putItem, deleteItem, queryItems } from "@/lib/dynamodb"

export async function POST() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const userId = session.user.id

  // Check if user already has an active game
  const activeGame = await getActiveGameForUser(userId)
  if (activeGame) {
    return NextResponse.json({ gameId: activeGame.gameId, status: activeGame.status })
  }

  // Get user profile for elo
  const userProfile = await getUser(userId)
  if (!userProfile) {
    return NextResponse.json({ error: "User not found" }, { status: 404 })
  }

  const elo = userProfile.elo
  const eloRange = Math.floor(elo / 200) * 200

  // Search adjacent elo ranges: eloRange-200, eloRange, eloRange+200
  const rangesToSearch = [
    Math.max(0, eloRange - 200),
    eloRange,
    eloRange + 200,
  ]
  // Deduplicate
  const uniqueRanges = [...new Set(rangesToSearch)]

  // Gather all queue entries across relevant ranges
  const allEntries: Array<{
    pk: string
    sk: string
    userId: string
    elo: number
    expiresAt: number
  }> = []

  await Promise.all(
    uniqueRanges.map(async (range) => {
      const { items } = await queryItems(
        "pk = :pk",
        { ":pk": `MATCH#QUEUE#${range}` }
      )
      for (const item of items) {
        allEntries.push({
          pk: item.pk as string,
          sk: item.sk as string,
          userId: item.userId as string,
          elo: (item.elo as number) ?? 1200,
          expiresAt: (item.expiresAt as number) ?? 0,
        })
      }
    })
  )

  // Filter out self, expired entries, and entries outside ±200 elo
  const now = Math.floor(Date.now() / 1000)
  const eligible = allEntries.filter(
    (e) =>
      e.userId !== userId &&
      e.expiresAt > now &&
      Math.abs(e.elo - elo) <= 200
  )

  if (eligible.length > 0) {
    // Pick first eligible opponent
    const opponent = eligible[0]

    // Select bug for the game
    const bug = await selectBugForGame(
      Math.round((elo + opponent.elo) / 2),
      userProfile.bugsSeen,
      [] // We'll get opponent bugsSeen below
    )

    // Get opponent profile for bugsSeen
    const opponentProfile = await getUser(opponent.userId)
    const bugForGame = await selectBugForGame(
      Math.round((elo + opponent.elo) / 2),
      userProfile.bugsSeen,
      opponentProfile?.bugsSeen ?? []
    )

    if (!bugForGame) {
      // Fallback: queue if no bug available
      return queueUser(userId, elo, eloRange)
    }

    // Create game
    const game = await createGame(userId, opponent.userId, bugForGame.bugId)

    // Delete both queue entries
    await Promise.all([
      deleteItem(opponent.pk, opponent.sk),
      // Also try to delete any self-entry (shouldn't exist since we checked activeGame but clean up anyway)
    ])

    // Update both users' bugsSeen arrays
    const newSelfBugsSeen = [...new Set([...userProfile.bugsSeen, bugForGame.bugId])]
    const newOpponentBugsSeen = [
      ...new Set([...(opponentProfile?.bugsSeen ?? []), bugForGame.bugId]),
    ]

    await Promise.all([
      import("@/lib/users").then(({ updateUser }) =>
        updateUser(userId, { bugsSeen: newSelfBugsSeen })
      ),
      opponentProfile
        ? import("@/lib/users").then(({ updateUser }) =>
            updateUser(opponent.userId, { bugsSeen: newOpponentBugsSeen })
          )
        : Promise.resolve(),
    ])

    return NextResponse.json({ gameId: game.gameId, status: "active" })
  }

  // No opponent found — add to queue
  return queueUser(userId, elo, eloRange)
}

async function queueUser(
  userId: string,
  elo: number,
  eloRange: number
): Promise<NextResponse> {
  const now = Math.floor(Date.now() / 1000)
  const expiresAt = now + 300 // 5 min TTL

  const sk = `${now}#${userId}`
  await putItem({
    pk: `MATCH#QUEUE#${eloRange}`,
    sk,
    userId,
    elo,
    expiresAt,
    gameId: null,
  })

  return NextResponse.json({ status: "waiting", gameId: null })
}
