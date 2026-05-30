import { NextResponse } from "next/server"
import { getUser } from "@/lib/users"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  const { userId } = await params
  const profile = await getUser(userId)
  if (!profile) {
    return NextResponse.json({ error: "User not found" }, { status: 404 })
  }

  // Omit email for privacy on public route
  const { email: _email, ...publicProfile } = profile
  return NextResponse.json(publicProfile)
}
