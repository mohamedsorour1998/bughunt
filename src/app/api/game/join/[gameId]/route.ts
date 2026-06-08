// src/app/api/game/join/[gameId]/route.ts
import { NextRequest, NextResponse } from "next/server"
import { UpdateCommand } from "@aws-sdk/lib-dynamodb"
import { safeAuth, getTestSession, getTestSessionFromCookies } from "@/lib/test-auth"
import { getItem, putItem, ddb, TABLE_NAME } from "@/lib/dynamodb"
import { createGamePlayerRecord } from "@/lib/game"

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ gameId: string }> }
) {
  const session = (await safeAuth()) ?? getTestSession(req) ?? (await getTestSessionFromCookies())
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const userId = session.user.id
  const { gameId } = await params

  const item = await getItem(`GAME#${gameId}`, "META")
  if (!item) {
    return NextResponse.json({ error: "Game not found" }, { status: 404 })
  }

  if (!item.isPrivate) {
    return NextResponse.json({ error: "Not a private game" }, { status: 400 })
  }

  if (item.status !== "waiting") {
    // Creator polling or game already active — return current status
    return NextResponse.json({ status: item.status as string, gameId })
  }

  if (item.player1Id === userId) {
    // Creator polling — game not yet joined
    return NextResponse.json({ status: "waiting", gameId })
  }

  // Join as player2: set player2Id, start round 0's timer now, and go active
  const now = Date.now()
  const roundStartedAt = Array.isArray(item.roundStartedAt)
    ? [...(item.roundStartedAt as number[])]
    : [item.createdAt as number]
  roundStartedAt[0] = now

  // Conditionally claim the join slot — guards against two concurrent
  // joiners both passing the earlier read-check (count-then-write race).
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { pk: `GAME#${gameId}`, sk: "META" },
        UpdateExpression: "SET player2Id = :player2Id, #status = :active, roundStartedAt = :roundStartedAt",
        ConditionExpression: "#status = :waiting AND attribute_not_exists(player2Id)",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: {
          ":player2Id": userId,
          ":active": "active",
          ":waiting": "waiting",
          ":roundStartedAt": roundStartedAt,
        },
      })
    )
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "ConditionalCheckFailedException") {
      return NextResponse.json({ error: "Game already joined" }, { status: 409 })
    }
    throw err
  }

  // Write GSI tracking item for player2
  await putItem({
    pk: `GAME#${gameId}`,
    sk: `ACTIVE_PLAYER#${userId}`,
    gameId,
    userId,
    expiresAt: item.expiresAt as number,
    gsi1pk: `ACTIVE_GAME#${userId}`,
    gsi1sk: gameId,
  })

  // Pre-create player2's answer record so submitRoundAnswer's slot-update has somewhere to write
  const bugIds = Array.isArray(item.bugIds) ? (item.bugIds as string[]) : [item.bugId as string]
  await createGamePlayerRecord(gameId, userId, bugIds)

  return NextResponse.json({ status: "joined", gameId })
}
