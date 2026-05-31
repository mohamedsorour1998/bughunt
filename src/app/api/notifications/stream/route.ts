import { type NextRequest, NextResponse } from "next/server"
import { safeAuth, getTestSession, getTestSessionFromCookies } from "@/lib/test-auth"
import { redis } from "@/lib/redis"

export const runtime = "nodejs"

export async function GET(req: NextRequest) {
  const session =
    (await safeAuth()) ?? getTestSession(req) ?? (await getTestSessionFromCookies())
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const userId = session.user.id
  const channel = `notifications:${userId}`

  // Hoist subscriber so cancel() can clean it up on client disconnect
  let subscriber: ReturnType<typeof redis.subscribe> | null = null

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder()

      // Heartbeat comment every 25s to keep connection alive through proxies
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"))
        } catch {
          clearInterval(heartbeat)
        }
      }, 25_000)

      try {
        subscriber = redis.subscribe<string>(channel)

        subscriber.on("message", (data) => {
          try {
            const raw =
              typeof data.message === "string" ? data.message : JSON.stringify(data.message)
            controller.enqueue(encoder.encode(`data: ${raw}\n\n`))
          } catch {
            /* ignore enqueue errors if stream is closed */
          }
        })

        req.signal.addEventListener("abort", () => {
          clearInterval(heartbeat)
          subscriber?.unsubscribe().catch(() => {/* ignore */})
          subscriber?.removeAllListeners()
          subscriber = null
          try { controller.close() } catch { /* already closed */ }
        })
      } catch {
        clearInterval(heartbeat)
        try { controller.close() } catch { /* already closed */ }
      }
    },
    cancel() {
      // Called when client disconnects — clean up subscription
      subscriber?.unsubscribe().catch(() => {/* ignore */})
      subscriber?.removeAllListeners()
      subscriber = null
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  })
}
