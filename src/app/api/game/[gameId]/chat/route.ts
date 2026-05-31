// src/app/api/game/[gameId]/chat/route.ts
import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { getItem, putItem, queryItems } from "@/lib/dynamodb"
import { getUser } from "@/lib/users"
import { v4 as uuidv4 } from "uuid"

const MAX_MESSAGES_PER_USER = 5
const MAX_MESSAGE_LENGTH = 200

type RouteContext = { params: Promise<{ gameId: string }> }

export async function GET(_req: NextRequest, { params }: RouteContext) {
  const { gameId } = await params

  const { items } = await queryItems(
    "pk = :pk AND begins_with(sk, :skPrefix)",
    { ":pk": `GAME#${gameId}`, ":skPrefix": "CHAT#" },
    { scanIndexForward: false, limit: 10 }
  )

  const messages = items.map((item) => ({
    userId: item.userId as string,
    displayName: item.displayName as string,
    message: item.message as string,
    createdAt: item.createdAt as number,
  }))

  return NextResponse.json({ messages })
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const userId = session.user.id
  const { gameId } = await params
  const { message } = await req.json() as { message: string }

  if (!message || typeof message !== "string") {
    return NextResponse.json({ error: "Missing message" }, { status: 400 })
  }

  const trimmed = message.trim().slice(0, MAX_MESSAGE_LENGTH)
  if (trimmed.length === 0) {
    return NextResponse.json({ error: "Empty message" }, { status: 400 })
  }

  // Verify game exists and user is a participant
  const gameItem = await getItem(`GAME#${gameId}`, "META")
  if (!gameItem) {
    return NextResponse.json({ error: "Game not found" }, { status: 404 })
  }

  const participantIds = [
    gameItem.player1Id as string,
    gameItem.player2Id as string,
  ].filter(Boolean)

  if (!participantIds.includes(userId)) {
    return NextResponse.json({ error: "Forbidden — not a participant" }, { status: 403 })
  }

  if (gameItem.status !== "completed") {
    return NextResponse.json({ error: "Chat only available after game completion" }, { status: 400 })
  }

  // Count existing messages from this user in this game
  const { items: existingMessages } = await queryItems(
    "pk = :pk AND begins_with(sk, :skPrefix)",
    { ":pk": `GAME#${gameId}`, ":skPrefix": "CHAT#" }
  )

  const userMessageCount = existingMessages.filter(
    (item) => item.userId === userId
  ).length

  if (userMessageCount >= MAX_MESSAGES_PER_USER) {
    return NextResponse.json(
      { error: `Maximum ${MAX_MESSAGES_PER_USER} messages per player` },
      { status: 429 }
    )
  }

  const user = await getUser(userId)
  const now = Date.now()
  const msgId = uuidv4()

  await putItem({
    pk: `GAME#${gameId}`,
    sk: `CHAT#${now}#${userId}`,
    msgId,
    userId,
    displayName: user?.displayName ?? "Unknown",
    message: trimmed,
    createdAt: now,
    expiresAt: gameItem.expiresAt as number, // inherit game TTL (90 days)
  })

  return NextResponse.json({ success: true, msgId })
}
