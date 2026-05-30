import { NextResponse } from "next/server"

const TEST_USERS: Record<string, { userId: string; displayName: string }> = {
  "test-user-1": { userId: "test-user-1", displayName: "Test Player One" },
  "test-user-2": { userId: "test-user-2", displayName: "Test Player Two" },
}

export async function POST(req: Request) {
  if (process.env.TEST_MODE !== "true") {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const { userId } = await req.json() as { userId: string }
  const user = TEST_USERS[userId]
  if (!user) return NextResponse.json({ error: "Unknown test user" }, { status: 400 })

  const response = NextResponse.json({ ok: true, userId: user.userId, displayName: user.displayName })
  response.cookies.set("test-user-id", user.userId, {
    httpOnly: true,
    secure: false,
    sameSite: "lax",
    path: "/",
    maxAge: 3600,
  })
  return response
}
