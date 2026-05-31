import { NextRequest, NextResponse } from "next/server"
import { getBugForPractice, getBug } from "@/lib/bugs"
import { getUser } from "@/lib/users"
import { safeAuth, getTestSessionFromCookies } from "@/lib/test-auth"
import { validateApiToken } from "@/lib/api-token"

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
  // Bearer token auth as alternative to session (for VS Code extension)
  let userId: string | null = null
  const authHeader = request.headers.get("authorization")
  if (authHeader?.startsWith("Bearer ")) {
    userId = await validateApiToken(authHeader.slice(7))
  }
  if (!userId) {
    const session = (await safeAuth()) ?? await getTestSessionFromCookies()
    userId = session?.user?.id ?? null
  }
  let bugsSeen: string[] = []

  if (userId) {
    const profile = await getUser(userId)
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
