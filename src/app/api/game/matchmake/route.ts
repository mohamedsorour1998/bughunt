import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { getUser } from "@/lib/users"
import { getActiveGameForUser, createGame } from "@/lib/game"
import { selectBugForGame } from "@/lib/bugs"
import { ddb, TABLE_NAME, putItem, queryItems } from "@/lib/dynamodb"
import { TransactWriteCommand } from "@aws-sdk/lib-dynamodb"

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

    // Atomically claim the opponent's queue slot and create the game record.
    // If another matchmaker already claimed this slot the transaction will
    // throw TransactionCanceledException — we treat that as "no opponent" and
    // fall through to queue the current user instead.
    const game = await createGame(userId, opponent.userId, bugForGame.bugId)

    try {
      await ddb.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Delete: {
                TableName: TABLE_NAME,
                Key: { pk: opponent.pk, sk: opponent.sk },
                ConditionExpression: "attribute_exists(pk)",
              },
            },
            {
              Put: {
                TableName: TABLE_NAME,
                Item: {
                  pk: `GAME#${game.gameId}`,
                  sk: "META",
                  gameId: game.gameId,
                  player1Id: userId,
                  player2Id: opponent.userId,
                  bugId: bugForGame.bugId,
                  status: "active",
                  createdAt: Date.now(),
                },
                ConditionExpression: "attribute_not_exists(pk)",
              },
            },
          ],
        })
      )
    } catch (err: unknown) {
      if (
        err instanceof Error &&
        err.name === "TransactionCanceledException"
      ) {
        // Another matchmaker already claimed this opponent — join queue instead.
        return queueUser(userId, elo, eloRange)
      }
      throw err
    }

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
