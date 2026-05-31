// src/app/api/social/challenge/respond/route.ts
import { NextRequest, NextResponse } from "next/server"
import { safeAuth, getTestSession, getTestSessionFromCookies } from "@/lib/test-auth"
import { getItem, updateItem } from "@/lib/dynamodb"
import { sendNotification } from "@/lib/notifications"
import { createGame } from "@/lib/game"
import { selectBugForGame } from "@/lib/bugs"
import { getUser } from "@/lib/users"

export async function POST(req: NextRequest) {
  const session = (await safeAuth()) ?? getTestSession(req) ?? (await getTestSessionFromCookies())
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const userId = session.user.id
  const { challengeId, action } = await req.json() as {
    challengeId: string
    action: "accept" | "decline"
  }

  if (!challengeId || !["accept", "decline"].includes(action)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  const item = await getItem(`CHALLENGE#${challengeId}`, "META")
  if (!item) {
    return NextResponse.json({ error: "Challenge not found or expired" }, { status: 404 })
  }

  if (item.challengedId !== userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  if (item.status !== "pending") {
    return NextResponse.json({ error: "Challenge already resolved" }, { status: 409 })
  }

  if (action === "decline") {
    await updateItem(`CHALLENGE#${challengeId}`, "META", { status: "declined" })
    await sendNotification(item.challengerId as string, {
      type: "challenge_declined",
      fromUserId: userId,
      fromDisplayName: item.challengedDisplayName as string,
      challengeId,
    })
    return NextResponse.json({ status: "declined" })
  }

  // Accept: create a game between the two players
  await updateItem(`CHALLENGE#${challengeId}`, "META", { status: "accepted" })

  const [challengerProfile, challengedProfile] = await Promise.all([
    getUser(item.challengerId as string),
    getUser(userId),
  ])

  const bug = await selectBugForGame(
    Math.round(((challengerProfile?.elo ?? 1200) + (challengedProfile?.elo ?? 1200)) / 2),
    challengerProfile?.bugsSeen ?? [],
    challengedProfile?.bugsSeen ?? []
  )

  if (!bug) {
    return NextResponse.json({ error: "No bug available" }, { status: 503 })
  }

  const game = await createGame(
    item.challengerId as string,
    userId,
    bug.bugId
  )

  await sendNotification(item.challengerId as string, {
    type: "challenge_accepted",
    fromUserId: userId,
    fromDisplayName: item.challengedDisplayName as string,
    gameId: game.gameId,
    challengeId,
  })

  return NextResponse.json({ status: "accepted", gameId: game.gameId })
}
