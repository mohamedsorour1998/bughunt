import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { getBugForPractice, getBug } from "@/lib/bugs"
import { getUser } from "@/lib/users"
import { getTestSessionFromCookies } from "@/lib/test-auth"

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const difficultyParam = searchParams.get("difficulty")
  const reveal = searchParams.get("reveal") === "1"
  const bugId = searchParams.get("bugId")

  // ---------------------------------------------------------------------------
  // Reveal mode: return a specific bug including correctAnswer (practice only)
  // ---------------------------------------------------------------------------
  if (reveal && bugId) {
    const bug = await getBug(bugId)
    if (!bug) {
      return NextResponse.json({ error: "Bug not found" }, { status: 404 })
    }
    // Return the full bug including correctAnswer — practice-mode reveal
    return NextResponse.json(bug)
  }

  // ---------------------------------------------------------------------------
  // Normal mode: pick a random bug, strip correctAnswer
  // ---------------------------------------------------------------------------

  let difficulty: number | undefined
  if (difficultyParam !== null) {
    const parsed = parseInt(difficultyParam, 10)
    if (!isNaN(parsed) && parsed >= 1 && parsed <= 5) {
      difficulty = parsed
    }
  }

  // Auth is optional — practice works without sign-in
  const session = (await auth()) ?? await getTestSessionFromCookies()
  let bugsSeen: string[] = []

  if (session?.user?.id) {
    const profile = await getUser(session.user.id)
    if (profile) {
      bugsSeen = profile.bugsSeen ?? []
    }
  }

  const bug = await getBugForPractice(difficulty, bugsSeen)

  if (!bug) {
    return NextResponse.json({ error: "No bugs available" }, { status: 404 })
  }

  // Strip correctAnswer so the client cannot peek at the answer before guessing
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { correctAnswer: _hidden, ...safeBug } = bug

  return NextResponse.json(safeBug)
}
