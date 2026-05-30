import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { createBug, getPendingBugs } from "@/lib/bugs"
import type { Bug } from "@/lib/bugs"

function isAdmin(email: string | null | undefined): boolean {
  if (!email) return false
  const adminEmails = (process.env.ADMIN_EMAILS ?? "").split(",").map((e) => e.trim()).filter(Boolean)
  return adminEmails.includes(email)
}

// GET /api/admin/bugs — list pending_review bugs
export async function GET() {
  const session = await auth()
  if (!session?.user?.email || !isAdmin(session.user.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const pending = await getPendingBugs()
  return NextResponse.json(pending)
}

// POST /api/admin/bugs — create a hand-crafted bug (goes straight to active)
export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.email || !isAdmin(session.user.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  let body: Partial<Omit<Bug, "bugId" | "timesServed" | "createdAt">>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const { language, category, difficulty, buggyCode, correctCode, bugLine, options, correctAnswer, explanation, hint } = body

  if (
    !language || !category || !difficulty || !buggyCode || !correctCode ||
    bugLine === undefined || !options || correctAnswer === undefined || !explanation || !hint
  ) {
    return NextResponse.json({ error: "All bug fields are required" }, { status: 400 })
  }

  const bug = await createBug({
    language,
    category,
    difficulty,
    buggyCode,
    correctCode,
    bugLine,
    options,
    correctAnswer,
    explanation,
    hint,
    source: "manual",
    status: "active",
  })

  return NextResponse.json(bug, { status: 201 })
}
