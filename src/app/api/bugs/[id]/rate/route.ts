import { NextRequest, NextResponse } from "next/server"
import { safeAuth, getTestSession, getTestSessionFromCookies } from "@/lib/test-auth"
import { putItemIfNotExists, ddb, TABLE_NAME } from "@/lib/dynamodb"
import { UpdateCommand } from "@aws-sdk/lib-dynamodb"

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = (await safeAuth()) ?? getTestSession(req) ?? await getTestSessionFromCookies()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id
  const { id: bugId } = await params
  const { rating } = await req.json() as { rating: 1 | 2 | 3 }

  if (![1, 2, 3].includes(rating)) return NextResponse.json({ error: "Rating must be 1, 2, or 3" }, { status: 400 })

  // Idempotent — one rating per user per bug
  const written = await putItemIfNotExists({
    pk: `BUG#${bugId}`, sk: `RATING#${userId}`,
    bugId, userId, rating, createdAt: Date.now(),
  })
  if (!written) return NextResponse.json({ error: "Already rated" }, { status: 409 })

  // Atomically update bug aggregate
  await ddb.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: { pk: `BUG#${bugId}`, sk: "META" },
    UpdateExpression: "ADD ratingCount :one, ratingSum :r",
    ExpressionAttributeValues: { ":one": 1, ":r": rating },
  }))

  return NextResponse.json({ ok: true })
}
