// src/app/api/org/join/route.ts
import { NextRequest, NextResponse } from "next/server"
import { safeAuth } from "@/lib/test-auth"
import { getUser } from "@/lib/users"
import { joinOrg } from "@/lib/orgs"

export async function POST(req: NextRequest) {
  const session = await safeAuth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { inviteCode } = await req.json() as { inviteCode: string }
  if (!inviteCode?.trim()) {
    return NextResponse.json({ error: "inviteCode required" }, { status: 400 })
  }

  const profile = await getUser(session.user.id)
  if (!profile) {
    return NextResponse.json({ error: "User not found" }, { status: 404 })
  }

  const result = await joinOrg(
    inviteCode.trim().toUpperCase(),
    session.user.id,
    profile.displayName,
    profile.elo
  )

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }

  return NextResponse.json({ success: true, orgId: result.orgId })
}
