import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { auth } from "@/auth"
import { getMatchHistory } from "@/lib/users"
import { getTestSession } from "@/lib/test-auth"

export async function GET(request: NextRequest) {
  const session = (await auth()) ?? getTestSession(request)
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const cursor = request.nextUrl.searchParams.get("cursor") ?? undefined
  const result = await getMatchHistory(session.user.id, 20, cursor)

  return NextResponse.json(result)
}
