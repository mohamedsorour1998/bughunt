// src/app/api/org/[id]/invite/route.ts
import { NextRequest, NextResponse } from "next/server"
import { safeAuth } from "@/lib/test-auth"
import { regenerateInviteCode } from "@/lib/orgs"

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await safeAuth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  const result = await regenerateInviteCode(id, session.user.id)

  if (!result.success) {
    return NextResponse.json(
      { error: result.error },
      { status: result.error === "Forbidden" ? 403 : 404 }
    )
  }

  return NextResponse.json({ inviteCode: result.inviteCode })
}
