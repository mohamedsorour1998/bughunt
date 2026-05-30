import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { approveBug, rejectBug } from "@/lib/bugs"

function isAdmin(email: string | null | undefined): boolean {
  if (!email) return false
  const adminEmails = (process.env.ADMIN_EMAILS ?? "").split(",").map((e) => e.trim()).filter(Boolean)
  return adminEmails.includes(email)
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ bugId: string }> }
) {
  const session = await auth()
  if (!session?.user?.email || !isAdmin(session.user.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { bugId } = await params

  let body: { action?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const { action } = body
  if (action !== "approve" && action !== "reject") {
    return NextResponse.json({ error: "action must be 'approve' or 'reject'" }, { status: 400 })
  }

  if (action === "approve") {
    const bug = await approveBug(bugId)
    if (!bug) {
      return NextResponse.json({ error: "Bug not found" }, { status: 404 })
    }
    return NextResponse.json(bug)
  } else {
    await rejectBug(bugId)
    return NextResponse.json({ success: true })
  }
}
