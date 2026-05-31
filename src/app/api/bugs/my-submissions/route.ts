import { NextRequest, NextResponse } from "next/server"
import { safeAuth, getTestSession, getTestSessionFromCookies } from "@/lib/test-auth"
import { getPendingBugs } from "@/lib/bugs"

export async function GET(req: NextRequest) {
  const session =
    (await safeAuth()) ??
    getTestSession(req) ??
    (await getTestSessionFromCookies())
  if (!session?.user?.id)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const userId = session.user.id
  const pendingBugs = await getPendingBugs()
  const myBugs = pendingBugs.filter((b) =>
    b.source?.startsWith(`community:${userId}`)
  )

  return NextResponse.json({ submissions: myBugs })
}
