// src/app/api/social/challenges/pending/route.ts
// Queries user-side index items (CHALLENGE_SENT# / CHALLENGE_RECV#) written at challenge creation,
// then fetches each challenge's META for status filtering.
import { NextRequest, NextResponse } from "next/server"
import { safeAuth, getTestSession, getTestSessionFromCookies } from "@/lib/test-auth"
import { queryItems, getItem } from "@/lib/dynamodb"

export async function GET(req: NextRequest) {
  const session = (await safeAuth()) ?? getTestSession(req) ?? (await getTestSessionFromCookies())
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const userId = session.user.id

  const [{ items: sentItems }, { items: recvItems }] = await Promise.all([
    queryItems(
      "pk = :pk AND begins_with(sk, :skPrefix)",
      { ":pk": `USER#${userId}`, ":skPrefix": "CHALLENGE_SENT#" }
    ),
    queryItems(
      "pk = :pk AND begins_with(sk, :skPrefix)",
      { ":pk": `USER#${userId}`, ":skPrefix": "CHALLENGE_RECV#" }
    ),
  ])

  const challengeIds = [
    ...sentItems.map((i) => (i.sk as string).replace("CHALLENGE_SENT#", "")),
    ...recvItems.map((i) => (i.sk as string).replace("CHALLENGE_RECV#", "")),
  ]

  const challengeItems = await Promise.all(
    challengeIds.map((id) => getItem(`CHALLENGE#${id}`, "META"))
  )

  const pending = challengeItems
    .filter((item) => item !== null && item.status === "pending")
    .map((item) => ({
      challengeId: item!.challengeId as string,
      challengerId: item!.challengerId as string,
      challengerDisplayName: item!.challengerDisplayName as string,
      challengedId: item!.challengedId as string,
      challengedDisplayName: item!.challengedDisplayName as string,
      createdAt: item!.createdAt as number,
      expiresAt: item!.expiresAt as number,
      direction: item!.challengerId === userId ? "outgoing" : "incoming",
    }))

  return NextResponse.json({ challenges: pending })
}
