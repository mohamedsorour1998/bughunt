import { NextRequest, NextResponse } from "next/server"
import { safeAuth, getTestSession, getTestSessionFromCookies } from "@/lib/test-auth"
import { queryItems, updateItem } from "@/lib/dynamodb"

export async function GET(req: NextRequest) {
  const session = (await safeAuth()) ?? getTestSession(req) ?? (await getTestSessionFromCookies())
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const userId = session.user.id
  const { items } = await queryItems(
    "pk = :pk AND begins_with(sk, :skPrefix)",
    { ":pk": `USER#${userId}`, ":skPrefix": "NOTIF#" },
    { scanIndexForward: false, limit: 20 }
  )

  const notifications = items.map((item) => ({
    notifId: item.notifId as string,
    sk: item.sk as string,
    type: item.type as string,
    fromUserId: item.fromUserId as string | undefined,
    fromDisplayName: item.fromDisplayName as string | undefined,
    gameId: item.gameId as string | undefined,
    challengeId: item.challengeId as string | undefined,
    read: (item.read as boolean) ?? false,
    createdAt: item.createdAt as number,
  }))

  const unreadCount = notifications.filter((n) => !n.read).length

  return NextResponse.json({ notifications, unreadCount })
}

export async function POST(req: NextRequest) {
  const session = (await safeAuth()) ?? getTestSession(req) ?? (await getTestSessionFromCookies())
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const userId = session.user.id
  const { sk } = (await req.json()) as { sk: string }

  if (!sk) {
    return NextResponse.json({ error: "Missing sk" }, { status: 400 })
  }

  await updateItem(`USER#${userId}`, sk, { read: true })
  return NextResponse.json({ ok: true })
}
