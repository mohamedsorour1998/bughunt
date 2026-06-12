/**
 * Upstash Redis client for BugHunt.
 * Scale: HTTP-based, safe in Vercel Serverless. O(log N) queue vs DynamoDB O(N) scan.
 */
import { Redis } from "@upstash/redis"

export const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
})

function eloRangeBucket(elo: number): number {
  return Math.floor(elo / 200) * 200
}

export async function enqueuePlayer(userId: string, elo: number): Promise<void> {
  const range = eloRangeBucket(elo)
  const score = Math.floor(Date.now() / 1000)
  await redis.zadd(`queue:${range}`, { score, member: userId })
  await redis.expire(`queue:${range}`, 300)
}

/**
 * Find an opponent and atomically claim them by removing them from the queue
 * via zrem in the same step as selection — eliminates the peek-then-dequeue
 * race where two concurrent matchmake calls could both pick the same opponent.
 * Returns the claimed opponent's userId, or null if no one could be claimed.
 */
export async function findAndClaimMatch(userId: string, elo: number): Promise<string | null> {
  const range = eloRangeBucket(elo)
  const ranges = [...new Set([Math.max(0, range - 200), range, range + 200])]
  for (const r of ranges) {
    const members = await redis.zrange(`queue:${r}`, 0, 9)
    for (const m of members) {
      if (m === userId) continue
      const removed = await redis.zrem(`queue:${r}`, m)
      // removed > 0 means we won the race for this opponent; otherwise someone
      // else claimed them first — try the next candidate.
      if (removed > 0) return m as string
    }
  }
  return null
}

export async function findMatch(userId: string, elo: number): Promise<string | null> {
  const range = eloRangeBucket(elo)
  const ranges = [...new Set([Math.max(0, range - 200), range, range + 200])]
  for (const r of ranges) {
    const members = await redis.zrange(`queue:${r}`, 0, 9)
    for (const m of members) {
      if (m !== userId) return m as string
    }
  }
  return null
}

export async function dequeuePlayer(userId: string, elo: number): Promise<void> {
  await redis.zrem(`queue:${eloRangeBucket(elo)}`, userId)
}

/**
 * Queue-wait clock for the bot fallback. Stored separately from the zset
 * (whose score is refreshed on every matchmake poll) under NX so the FIRST
 * enqueue time survives re-polls. EX 300 self-heals abandoned entries.
 */
export async function markQueueJoined(userId: string): Promise<void> {
  await redis.set(`queue_joined:${userId}`, Date.now(), { nx: true, ex: 300 })
}

export async function getQueueJoinedAt(userId: string): Promise<number | null> {
  const v = await redis.get<number>(`queue_joined:${userId}`)
  return v ?? null
}

export async function clearQueueJoined(userId: string): Promise<void> {
  await redis.del(`queue_joined:${userId}`)
}

export type GameEvent =
  | { type: "player_submitted"; userId: string; roundIndex: number; correct: boolean; timeElapsedMs: number }
  | { type: "round_advanced"; round: number }
  | { type: "game_resolved"; winnerId: string | null; p1EloAfter: number; p2EloAfter: number }

export type NotificationEvent =
  | { type: "match_found"; gameId: string }
  | { type: "challenge_received"; challengeId: string; fromUserId: string; fromDisplayName: string }

export async function publishGameEvent(gameId: string, event: GameEvent): Promise<void> {
  await redis.publish(`game:${gameId}`, JSON.stringify(event))
}

export async function publishNotification(userId: string, event: NotificationEvent): Promise<void> {
  await redis.publish(`notifications:${userId}`, JSON.stringify(event))
}

export async function rateLimitCheck(
  userId: string,
  action: string,
  maxRequests: number,
  windowSeconds: number
): Promise<boolean> {
  const windowStart = Math.floor(Date.now() / 1000 / windowSeconds)
  const key = `ratelimit:${userId}:${action}:${windowStart}`
  const count = await redis.incr(key)
  if (count === 1) await redis.expire(key, windowSeconds * 2)
  return count <= maxRequests
}

export async function getDailyChallengeBugId(date: string): Promise<string | null> {
  return redis.get<string>(`daily_challenge:${date}`)
}

export async function setDailyChallengeBugId(date: string, bugId: string): Promise<void> {
  const now = new Date()
  const midnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1))
  const secondsUntilMidnight = Math.floor((midnight.getTime() - now.getTime()) / 1000)
  await redis.set(`daily_challenge:${date}`, bugId, { ex: secondsUntilMidnight })
}
