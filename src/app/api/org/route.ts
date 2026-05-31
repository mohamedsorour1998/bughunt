// src/app/api/org/route.ts
import { NextRequest, NextResponse } from "next/server"
import { safeAuth } from "@/lib/test-auth"
import { getUser } from "@/lib/users"
import { createOrg, getUserOrgs } from "@/lib/orgs"

export async function GET() {
  const session = await safeAuth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const orgs = await getUserOrgs(session.user.id)
  return NextResponse.json({ orgs })
}

export async function POST(req: NextRequest) {
  const session = await safeAuth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { name } = await req.json() as { name: string }
  if (!name?.trim()) {
    return NextResponse.json({ error: "name required" }, { status: 400 })
  }

  const profile = await getUser(session.user.id)
  if (!profile) {
    return NextResponse.json({ error: "User not found" }, { status: 404 })
  }

  const org = await createOrg(
    name.trim(),
    session.user.id,
    profile.displayName,
    profile.elo
  )

  return NextResponse.json(org, { status: 201 })
}
