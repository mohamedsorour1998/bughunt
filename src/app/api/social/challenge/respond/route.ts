// src/app/api/social/challenge/respond/route.ts
import { NextRequest, NextResponse } from "next/server"
import { safeAuth, getTestSession, getTestSessionFromCookies } from "@/lib/test-auth"
import { getItem, ddb, TABLE_NAME } from "@/lib/dynamodb"
import { UpdateCommand } from "@aws-sdk/lib-dynamodb"
import { sendNotification } from "@/lib/notifications"
import { createGame } from "@/lib/game"
import { selectBugsForGame } from "@/lib/bugs"
import { getUser } from "@/lib/users"

export async function POST(req: NextRequest) {
  const session = (await safeAuth()) ?? getTestSession(req) ?? (await getTestSessionFromCookies())
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const userId = session.user.id
  const { challengeId, action } = await req.json() as {
    challengeId: string
    action: "accept" | "decline"
  }

  if (!challengeId || !["accept", "decline"].includes(action)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  const item = await getItem(`CHALLENGE#${challengeId}`, "META")
  if (!item) {
    return NextResponse.json({ error: "Challenge not found or expired" }, { status: 404 })
  }

  if (item.challengedId !== userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  if (item.status !== "pending") {
    return NextResponse.json({ error: "Challenge already resolved" }, { status: 409 })
  }

  if (item.expiresAt != null && Date.now() >= (item.expiresAt as number) * 1000) {
    return NextResponse.json({ error: "Challenge expired" }, { status: 404 })
  }

  const newStatus = action === "decline" ? "declined" : "accepted"

  // Conditional transition guards against two concurrent accept/decline calls both
  // passing the status check above and (for accept) both spawning a game.
  try {
    await ddb.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { pk: `CHALLENGE#${challengeId}`, sk: "META" },
      UpdateExpression: "SET #status = :newStatus",
      ConditionExpression: "#status = :pending",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: { ":pending": "pending", ":newStatus": newStatus },
    }))
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "ConditionalCheckFailedException") {
      return NextResponse.json({ error: "Challenge already responded to" }, { status: 409 })
    }
    throw err
  }

  if (action === "decline") {
    await sendNotification(item.challengerId as string, {
      type: "challenge_declined",
      fromUserId: userId,
      fromDisplayName: item.challengedDisplayName as string,
      challengeId,
    })
    return NextResponse.json({ status: "declined" })
  }

  // Accept: create a game between the two players
  const [challengerProfile, challengedProfile] = await Promise.all([
    getUser(item.challengerId as string),
    getUser(userId),
  ])

  const bugs = await selectBugsForGame(
    Math.round(((challengerProfile?.elo ?? 1200) + (challengedProfile?.elo ?? 1200)) / 2),
    challengerProfile?.bugsSeen ?? [],
    challengedProfile?.bugsSeen ?? []
  )

  if (!bugs) {
    return NextResponse.json({ error: "No bug available" }, { status: 503 })
  }

  const game = await createGame(
    item.challengerId as string,
    userId,
    bugs.map((b) => b.bugId)
  )

  await sendNotification(item.challengerId as string, {
    type: "challenge_accepted",
    fromUserId: userId,
    fromDisplayName: item.challengedDisplayName as string,
    gameId: game.gameId,
    challengeId,
  })

  return NextResponse.json({ status: "accepted", gameId: game.gameId })
}
