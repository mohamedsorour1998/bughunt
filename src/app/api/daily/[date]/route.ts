/**
 * GET /api/daily/[date]
 * Returns the historical daily challenge for a given YYYY-MM-DD date.
 * Always includes correctAnswer (historical — already revealed).
 */
import { NextRequest, NextResponse } from "next/server"
import { getDailyChallenge } from "@/lib/daily"
import { safeAuth, getTestSession, getTestSessionFromCookies } from "@/lib/test-auth"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ date: string }> }
) {
  const session =
    (await safeAuth()) ??
    getTestSession(request) ??
    (await getTestSessionFromCookies())
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { date } = await params

  // Validate YYYY-MM-DD format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "Invalid date format, use YYYY-MM-DD" }, { status: 400 })
  }

  const payload = await getDailyChallenge(date, session.user.id)
  if (!payload) {
    return NextResponse.json({ error: "Daily challenge not found for this date" }, { status: 404 })
  }

  return NextResponse.json(payload)
}
