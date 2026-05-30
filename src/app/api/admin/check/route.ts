import { safeAuth } from "@/lib/test-auth"
import { NextResponse } from "next/server"

export async function GET() {
  const session = await safeAuth()
  if (!session?.user?.email) return NextResponse.json({ isAdmin: false })
  const adminEmails = (process.env.ADMIN_EMAILS ?? "").split(",").map(s => s.trim().toLowerCase())
  const isAdmin = adminEmails.includes(session.user.email.toLowerCase())
  return NextResponse.json({ isAdmin })
}
