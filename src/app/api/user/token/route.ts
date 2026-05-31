import { NextRequest, NextResponse } from "next/server"
import { safeAuth, getTestSession, getTestSessionFromCookies } from "@/lib/test-auth"
import { generateApiToken, hasApiToken, revokeApiToken } from "@/lib/api-token"

export async function GET(req: NextRequest) {
  const session = (await safeAuth()) ?? getTestSession(req) ?? await getTestSessionFromCookies()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id
  const exists = await hasApiToken(userId)
  if (!exists) {
    const token = await generateApiToken(userId)
    return NextResponse.json({ token, created: true })
  }
  return NextResponse.json({ token: null, exists: true, message: "Token exists. Revoke and regenerate to see it." })
}

export async function POST(req: NextRequest) {
  const session = (await safeAuth()) ?? getTestSession(req) ?? await getTestSessionFromCookies()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const token = await generateApiToken(session.user.id)
  return NextResponse.json({ token })
}

export async function DELETE(req: NextRequest) {
  const session = (await safeAuth()) ?? getTestSession(req) ?? await getTestSessionFromCookies()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  await revokeApiToken(session.user.id)
  return NextResponse.json({ ok: true })
}
