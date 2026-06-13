/**
 * TCP subscriber for push-based SSE. The Upstash REST client can publish but
 * not subscribe; this uses the rediss:// TCP URL (REDIS_URL). Callers must
 * fall back to DynamoDB polling when this returns null.
 */
import Redis from "ioredis"

let subscriber: Redis | null = null
const channelListeners = new Map<string, Set<(message: string) => void>>()

function getSubscriber(): Redis | null {
  const url = process.env.REDIS_URL
  if (!url) return null
  if (!subscriber) {
    subscriber = new Redis(url, { maxRetriesPerRequest: 2 })
    subscriber.on("error", (err) => console.error("[redis-sub]", err.message))
    subscriber.on("message", (channel: string, message: string) => {
      channelListeners.get(channel)?.forEach((listener) => listener(message))
    })
  }
  return subscriber
}

/** Subscribe to a channel; resolves to an unsubscribe fn, or null when no TCP Redis is configured. */
export async function subscribeToChannel(
  channel: string,
  onMessage: (message: string) => void
): Promise<(() => void) | null> {
  const client = getSubscriber()
  if (!client) return null
  let listeners = channelListeners.get(channel)
  if (!listeners) {
    listeners = new Set()
    channelListeners.set(channel, listeners)
    await client.subscribe(channel)
  }
  listeners.add(onMessage)
  return () => {
    listeners!.delete(onMessage)
    if (listeners!.size === 0) {
      channelListeners.delete(channel)
      client.unsubscribe(channel).catch(() => {})
    }
  }
}
