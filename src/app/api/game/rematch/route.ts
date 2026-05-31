/**
 * POST /api/game/rematch
 * Body: { opponentId: string }
 *
 * Writes a REMATCH DynamoDB entity:
 *   PK: REMATCH#<userId>  SK: <opponentId>  TTL: 60s
 *
 * Returns: { status: "pending", rematching: true }
 */
import { NextRequest, NextResponse } from "next/server"
import { putItem } from "@/lib/dynamodb"
import { safeAuth, getTestSession, getTestSessionFromCookies } from "@/lib/test-auth"

export async function POST(request: NextRequest) {
  const session =
    (await safeAuth()) ??
    getTestSession(request) ??
    (await getTestSessionFromCookies())
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const userId = session.user.id

  let body: { opponentId: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  }

  const { opponentId } = body
  if (!opponentId || typeof opponentId !== "string") {
    return NextResponse.json({ error: "Missing opponentId" }, { status: 400 })
  }

  if (opponentId === userId) {
    return NextResponse.json({ error: "Cannot rematch yourself" }, { status: 400 })
  }

  const nowSec = Math.floor(Date.now() / 1000)
  const expiresAt = nowSec + 60  // 60-second TTL (DynamoDB TTL field, epoch seconds)

  await putItem({
    pk: `REMATCH#${userId}`,
    sk: opponentId,
    userId,
    opponentId,
    createdAt: Date.now(),
    expiresAt,
  })

  return NextResponse.json({ status: "pending", rematching: true })
}
