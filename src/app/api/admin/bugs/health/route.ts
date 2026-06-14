import { NextResponse } from "next/server"
import { getBugIndex, getBug } from "@/lib/bugs"

export async function GET() {
  const session = await import("@/lib/test-auth").then(m => m.safeAuth())
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const adminEmails = (process.env.ADMIN_EMAILS ?? "").split(",").map(s => s.trim()).filter(Boolean)
  const email = (session.user as { email?: string }).email
  if (!email || !adminEmails.includes(email)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const index = await getBugIndex()
  if (!index) return NextResponse.json({ bugs: [] })

  const bugs = await Promise.all(index.bugIds.slice(0, 100).map(id => getBug(id)))
  const health = bugs
    .filter(Boolean)
    .map(b => ({
      bugId: b!.bugId, language: b!.language, category: b!.category,
      difficulty: b!.difficulty,
      ratingCount: b!.ratingCount ?? 0,
      ratingSum: b!.ratingSum ?? 0,
      ratingAvg: b!.ratingCount ? (b!.ratingSum as number) / b!.ratingCount : 2,
      misratingScore: Math.abs((b!.ratingCount ? (b!.ratingSum as number) / b!.ratingCount : 2) - 2),
    }))
    .sort((a, b) => b.misratingScore - a.misratingScore)

  return NextResponse.json({ bugs: health })
}
