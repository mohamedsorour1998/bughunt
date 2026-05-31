import { NextRequest, NextResponse } from "next/server"
import { safeAuth, getTestSession, getTestSessionFromCookies } from "@/lib/test-auth"
import { putItem, deleteItem, ddb, TABLE_NAME } from "@/lib/dynamodb"
import { getUser } from "@/lib/users"
import { UpdateCommand } from "@aws-sdk/lib-dynamodb"

export async function POST(req: NextRequest) {
  const session = (await safeAuth()) ?? getTestSession(req) ?? (await getTestSessionFromCookies())
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const followerId = session.user.id
  const { followeeId } = (await req.json()) as { followeeId: string }

  if (!followeeId || followeeId === followerId) {
    return NextResponse.json({ error: "Invalid followeeId" }, { status: 400 })
  }

  const [followee, follower] = await Promise.all([
    getUser(followeeId),
    getUser(followerId),
  ])

  if (!followee) {
    return NextResponse.json({ error: "User not found" }, { status: 404 })
  }

  const now = Date.now()

  // Forward relationship: USER#followerId / FOLLOWS#followeeId
  await putItem({
    pk: `USER#${followerId}`,
    sk: `FOLLOWS#${followeeId}`,
    followerId,
    followeeId,
    followedAt: now,
    followeeDisplayName: followee.displayName,
    followeeElo: followee.elo,
  })

  // Reverse index: USER#followeeId / FOLLOWER#followerId
  await putItem({
    pk: `USER#${followeeId}`,
    sk: `FOLLOWER#${followerId}`,
    followerId,
    followeeId,
    followedAt: now,
    followerDisplayName: follower?.displayName ?? "Unknown",
  })

  // Increment followerCount on followee profile
  await ddb.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: { pk: `USER#${followeeId}`, sk: "PROFILE" },
    UpdateExpression: "ADD #fc :inc",
    ExpressionAttributeNames: { "#fc": "followerCount" },
    ExpressionAttributeValues: { ":inc": 1 },
  }))

  // Increment followingCount on follower profile
  await ddb.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: { pk: `USER#${followerId}`, sk: "PROFILE" },
    UpdateExpression: "ADD #fc :inc",
    ExpressionAttributeNames: { "#fc": "followingCount" },
    ExpressionAttributeValues: { ":inc": 1 },
  }))

  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const session = (await safeAuth()) ?? getTestSession(req) ?? (await getTestSessionFromCookies())
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const followerId = session.user.id
  const followeeId = req.nextUrl.searchParams.get("followeeId")

  if (!followeeId) {
    return NextResponse.json({ error: "Missing followeeId" }, { status: 400 })
  }

  await Promise.all([
    deleteItem(`USER#${followerId}`, `FOLLOWS#${followeeId}`),
    deleteItem(`USER#${followeeId}`, `FOLLOWER#${followerId}`),
  ])

  // Decrement followerCount on followee profile
  await ddb.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: { pk: `USER#${followeeId}`, sk: "PROFILE" },
    UpdateExpression: "ADD #fc :dec",
    ExpressionAttributeNames: { "#fc": "followerCount" },
    ExpressionAttributeValues: { ":dec": -1 },
  }))

  // Decrement followingCount on follower profile
  await ddb.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: { pk: `USER#${followerId}`, sk: "PROFILE" },
    UpdateExpression: "ADD #fc :dec",
    ExpressionAttributeNames: { "#fc": "followingCount" },
    ExpressionAttributeValues: { ":dec": -1 },
  }))

  return NextResponse.json({ ok: true })
}

export async function GET(req: NextRequest) {
  const session = (await safeAuth()) ?? getTestSession(req) ?? (await getTestSessionFromCookies())
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const userId = session.user.id
  const { queryItems } = await import("@/lib/dynamodb")
  const { items } = await queryItems(
    "pk = :pk AND begins_with(sk, :prefix)",
    { ":pk": `USER#${userId}`, ":prefix": "FOLLOWS#" },
    { limit: 100 }
  )
  return NextResponse.json({ following: items.map((i) => i.followeeId) })
}
