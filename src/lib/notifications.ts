import { v4 as uuidv4 } from "uuid"
import { putItem } from "@/lib/dynamodb"
import { publishNotification } from "@/lib/redis"

export type NotificationType =
  | "challenge_received"
  | "challenge_accepted"
  | "challenge_declined"
  | "friend_game_completed"

export interface NotificationPayload {
  type: NotificationType
  fromUserId?: string
  fromDisplayName?: string
  gameId?: string
  challengeId?: string
}

export async function sendNotification(
  toUserId: string,
  payload: NotificationPayload
): Promise<void> {
  const now = Date.now()
  const notifId = uuidv4()
  const sk = `NOTIF#${now}#${notifId}`
  const expiresAt = Math.floor((now + 30 * 24 * 60 * 60 * 1000) / 1000) // 30-day TTL

  await putItem({
    pk: `USER#${toUserId}`,
    sk,
    notifId,
    ...payload,
    read: false,
    createdAt: now,
    expiresAt,
  })

  // Publish to Redis for real-time SSE delivery; fire-and-forget
  await publishNotification(toUserId, {
    type: payload.type === "challenge_received" ? "challenge_received" : "match_found",
    ...(payload.type === "challenge_received"
      ? {
          challengeId: payload.challengeId ?? "",
          fromUserId: payload.fromUserId ?? "",
          fromDisplayName: payload.fromDisplayName ?? "",
        }
      : { gameId: payload.gameId ?? "" }),
  } as Parameters<typeof publishNotification>[1]).catch(() => {/* ignore Redis errors */})
}
