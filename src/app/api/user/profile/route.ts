import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { getUser } from "@/lib/users"
import { getTestSession, getTestSessionFromCookies } from "@/lib/test-auth"

export async function GET(req: Request) {
  const session = (await auth()) ?? getTestSession(req) ?? await getTestSessionFromCookies()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const profile = await getUser(session.user.id)
  if (!profile) {
    return NextResponse.json({ error: "User not found" }, { status: 404 })
  }

  return NextResponse.json(profile)
}
