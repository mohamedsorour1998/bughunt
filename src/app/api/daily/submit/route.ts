/**
 * POST /api/daily/submit
 * Body: { answer: number (0-3), timeElapsedMs: number }
 * Submits the user's answer for today's daily challenge.
 */
import { NextRequest, NextResponse } from "next/server"
import { submitDailyAnswer, todayUTC } from "@/lib/daily"
import { safeAuth, getTestSession, getTestSessionFromCookies } from "@/lib/test-auth"

export async function POST(request: NextRequest) {
  const session =
    (await safeAuth()) ??
    getTestSession(request) ??
    (await getTestSessionFromCookies())
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let body: { answer: number; timeElapsedMs: number }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  }

  const { answer, timeElapsedMs } = body

  if (typeof answer !== "number" || answer < 0 || answer > 3) {
    return NextResponse.json({ error: "answer must be 0-3" }, { status: 400 })
  }
  if (typeof timeElapsedMs !== "number" || timeElapsedMs < 0) {
    return NextResponse.json({ error: "timeElapsedMs must be a non-negative number" }, { status: 400 })
  }

  const date = todayUTC()
  const result = await submitDailyAnswer(date, session.user.id, answer, timeElapsedMs)

  if (!result.ok) {
    if (result.error === "already_submitted") {
      return NextResponse.json({ error: "Already submitted today" }, { status: 409 })
    }
    if (result.error === "daily_not_found") {
      return NextResponse.json({ error: "No daily challenge today" }, { status: 404 })
    }
    return NextResponse.json({ error: "Internal error" }, { status: 500 })
  }

  return NextResponse.json({
    correct: result.correct,
    correctAnswer: result.correctAnswer,
    explanation: result.explanation,
    rank: result.rank,
  })
}
