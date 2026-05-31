// src/app/api/social/challenge/route.ts
import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { putItem } from "@/lib/dynamodb"
import { getUser } from "@/lib/users"
import { sendNotification } from "@/lib/notifications"
import { v4 as uuidv4 } from "uuid"

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const challengerId = session.user.id
  const { challengedId } = await req.json() as { challengedId: string }

  if (!challengedId || challengedId === challengerId) {
    return NextResponse.json({ error: "Invalid challengedId" }, { status: 400 })
  }

  const [challenger, challenged] = await Promise.all([
    getUser(challengerId),
    getUser(challengedId),
  ])

  if (!challenger || !challenged) {
    return NextResponse.json({ error: "User not found" }, { status: 404 })
  }

  const challengeId = uuidv4()
  const now = Date.now()
  // 5-minute TTL (epoch seconds for DynamoDB TTL attribute)
  const expiresAt = Math.floor((now + 5 * 60 * 1000) / 1000)

  await putItem({
    pk: `CHALLENGE#${challengeId}`,
    sk: "META",
    challengeId,
    challengerId,
    challengerDisplayName: challenger.displayName,
    challengedId,
    challengedDisplayName: challenged.displayName,
    status: "pending",
    createdAt: now,
    expiresAt,
  })

  // Write user-side index items so the pending list route can query efficiently
  await Promise.all([
    putItem({
      pk: `USER#${challengerId}`,
      sk: `CHALLENGE_SENT#${challengeId}`,
      challengeId,
      expiresAt, // same 5-min TTL
    }),
    putItem({
      pk: `USER#${challengedId}`,
      sk: `CHALLENGE_RECV#${challengeId}`,
      challengeId,
      expiresAt,
    }),
  ])

  await sendNotification(challengedId, {
    type: "challenge_received",
    fromUserId: challengerId,
    fromDisplayName: challenger.displayName,
    challengeId,
  })

  return NextResponse.json({ challengeId })
}
