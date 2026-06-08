import { NextResponse } from "next/server"
import { getUser } from "@/lib/users"
import { dequeuePlayer } from "@/lib/redis"
import { safeAuth, getTestSession, getTestSessionFromCookies } from "@/lib/test-auth"

export async function POST(req: Request) {
  const session = (await safeAuth()) ?? getTestSession(req) ?? await getTestSessionFromCookies()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const userId = session.user.id

  // The real matchmaking queue lives in Redis sorted sets (queue:<eloRange>),
  // not DynamoDB — dequeue using the user's current Elo to compute the bucket.
  const userProfile = await getUser(userId)
  if (userProfile) {
    await dequeuePlayer(userId, userProfile.elo).catch(() => {})
  }

  return NextResponse.json({ cancelled: true })
}
