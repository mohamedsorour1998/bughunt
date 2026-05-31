import { NextRequest, NextResponse } from "next/server"
import { safeAuth, getTestSession, getTestSessionFromCookies } from "@/lib/test-auth"
import { queryItems } from "@/lib/dynamodb"

export async function GET(req: NextRequest) {
  const session = (await safeAuth()) ?? getTestSession(req) ?? (await getTestSessionFromCookies())
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const userId = session.user.id

  const { items } = await queryItems(
    "pk = :pk AND begins_with(sk, :skPrefix)",
    { ":pk": `USER#${userId}`, ":skPrefix": "FOLLOWS#" }
  )

  const following = items.map((item) => ({
    userId: (item.sk as string).replace("FOLLOWS#", ""),
    displayName: item.followeeDisplayName as string,
    elo: item.followeeElo as number,
    followedAt: item.followedAt as number,
  }))

  return NextResponse.json({ following })
}
