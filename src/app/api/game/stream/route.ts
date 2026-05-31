import { type NextRequest, NextResponse } from "next/server"
import { safeAuth, getTestSession, getTestSessionFromCookies } from "@/lib/test-auth"
import { getGame } from "@/lib/game"
import { redis } from "@/lib/redis"

export const runtime = "nodejs"

export async function GET(req: NextRequest) {
  const session =
    (await safeAuth()) ?? getTestSession(req) ?? (await getTestSessionFromCookies())
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const userId = session.user.id
  const { searchParams } = req.nextUrl
  const gameId = searchParams.get("gameId")

  if (!gameId) {
    return NextResponse.json({ error: "Missing gameId" }, { status: 400 })
  }

  const game = await getGame(gameId)
  if (!game) {
    return NextResponse.json({ error: "Game not found" }, { status: 404 })
  }
  if (game.player1Id !== userId && game.player2Id !== userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  // Already completed — send final event immediately
  if (game.status === "completed") {
    const body = `data: ${JSON.stringify({ type: "game_resolved", gameId })}\n\n`
    return new Response(body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    })
  }

  const channel = `game:${gameId}`

  // Hoist subscriber so cancel() can clean it up on client disconnect
  let subscriber: ReturnType<typeof redis.subscribe> | null = null

  const stream = new ReadableStream({
    start(controller) {
      try {
        subscriber = redis.subscribe<string>(channel)

        subscriber.on("message", (data) => {
          try {
            const raw = typeof data.message === "string" ? data.message : JSON.stringify(data.message)
            controller.enqueue(new TextEncoder().encode(`data: ${raw}\n\n`))

            let parsed: { type?: string } = {}
            try {
              parsed = JSON.parse(raw)
            } catch {
              /* ignore parse errors */
            }

            if (parsed.type === "game_resolved") {
              subscriber?.unsubscribe().catch(() => {/* ignore */})
              subscriber?.removeAllListeners()
              subscriber = null
              try {
                controller.close()
              } catch {
                /* already closed */
              }
            }
          } catch {
            /* ignore enqueue errors if stream is closed */
          }
        })
      } catch {
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
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  })
}
