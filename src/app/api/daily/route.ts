/**
 * GET /api/daily
 * Returns today's daily challenge for the authenticated user.
 * Response: DailyChallengePayload (correctAnswer omitted until user submits)
 */
import { NextRequest, NextResponse } from "next/server"
import { getDailyChallenge, todayUTC } from "@/lib/daily"
import { getDailyChallengeBugId } from "@/lib/redis"
import { safeAuth, getTestSession, getTestSessionFromCookies } from "@/lib/test-auth"

export async function GET(request: NextRequest) {
  const session =
    (await safeAuth()) ??
    getTestSession(request) ??
    (await getTestSessionFromCookies())
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const date = todayUTC()

  // Fast path: confirm daily exists (Redis will have bugId if cron ran)
  try {
    await getDailyChallengeBugId(date)
  } catch {
    // Redis unavailable — fall through to DynamoDB
  }

  const payload = await getDailyChallenge(date, session.user.id)
  if (!payload) {
    return NextResponse.json(
      { error: "No daily challenge today. Check back after midnight UTC." },
      { status: 404 }
    )
  }

  return NextResponse.json(payload)
}
