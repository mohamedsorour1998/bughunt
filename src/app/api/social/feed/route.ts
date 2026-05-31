import { NextRequest, NextResponse } from "next/server"
import { safeAuth, getTestSession, getTestSessionFromCookies } from "@/lib/test-auth"
import { queryItems } from "@/lib/dynamodb"
import { getMatchHistory } from "@/lib/users"

export const runtime = "nodejs"

export async function GET(req: NextRequest) {
  const session = (await safeAuth()) ?? getTestSession(req) ?? (await getTestSessionFromCookies())
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const userId = session.user.id

  // Get list of users this person follows
  const { items: followItems } = await queryItems(
    "pk = :pk AND begins_with(sk, :skPrefix)",
    { ":pk": `USER#${userId}`, ":skPrefix": "FOLLOWS#" }
  )

  if (followItems.length === 0) {
    return NextResponse.json({ feed: [] })
  }

  // Batch-fetch recent match history for each followed user (last 5 games each)
  const followedIds = followItems.map((item) => (item.sk as string).replace("FOLLOWS#", ""))

  const historyResults = await Promise.all(
    followedIds.map((fId) => getMatchHistory(fId, 5))
  )

  // Flatten, annotate with whose game it is, sort by createdAt desc
  const feedEntries = historyResults
    .flatMap((result, idx) =>
      result.entries.map((entry) => ({
        ...entry,
        playerId: followedIds[idx],
        playerName: (followItems[idx].followeeDisplayName as string) ?? followedIds[idx],
      }))
    )
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 50)

  return NextResponse.json({ feed: feedEntries })
}
