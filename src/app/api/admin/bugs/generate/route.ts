import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { generateBug } from "@/lib/bedrock"
import { createBug } from "@/lib/bugs"

function isAdmin(email: string | null | undefined): boolean {
  if (!email) return false
  const adminEmails = (process.env.ADMIN_EMAILS ?? "").split(",").map((e) => e.trim()).filter(Boolean)
  return adminEmails.includes(email)
}

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.email || !isAdmin(session.user.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  let body: { language?: string; category?: string; difficulty?: number }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const { language, category, difficulty } = body

  if (!language || !category || !difficulty || difficulty < 1 || difficulty > 5) {
    return NextResponse.json({ error: "language, category, and difficulty (1-5) are required" }, { status: 400 })
  }

  const generated = await generateBug(language, category, difficulty as 1 | 2 | 3 | 4 | 5)
  if (!generated) {
    return NextResponse.json({ error: "Bug generation failed" }, { status: 500 })
  }

  const bug = await createBug({
    ...generated,
    language,
    category,
    difficulty: difficulty as 1 | 2 | 3 | 4 | 5,
    source: "bedrock",
    status: "pending_review",
  })

  return NextResponse.json(bug)
}
