import { type NextRequest, NextResponse } from "next/server"
import { safeAuth, getTestSession, getTestSessionFromCookies } from "@/lib/test-auth"
import { getGame } from "@/lib/game"
import { redis } from "@/lib/redis"
import { maybePlayBotRound } from "@/lib/bot"

export const runtime = "nodejs"

const POLL_INTERVAL_MS = 2000
const HEARTBEAT_INTERVAL_MS = 15000

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

  // Already completed — send final event immediately and close
  if (game.status === "completed") {
    const body = `data: ${JSON.stringify({ type: "game_resolved", gameId })}\n\n`
    return new Response(body, {
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
    })
  }

  // Shared mutable state accessible to both start() and cancel()
  const state = {
    closed: false,
    pollTimer: null as ReturnType<typeof setInterval> | null,
    heartbeatTimer: null as ReturnType<typeof setInterval> | null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    subscriber: null as any,
  }

  function cleanup() {
    state.closed = true
    if (state.pollTimer) { clearInterval(state.pollTimer); state.pollTimer = null }
    if (state.heartbeatTimer) { clearInterval(state.heartbeatTimer); state.heartbeatTimer = null }
    if (state.subscriber) {
      try { state.subscriber.unsubscribe?.().catch?.(() => {}) } catch { /* ignore */ }
      try { state.subscriber.removeAllListeners?.() } catch { /* ignore */ }
      state.subscriber = null
    }
  }

  const stream = new ReadableStream({
    start(controller) {
      function send(payload: object) {
        if (state.closed) return
        try { controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`)) } catch { /* closed */ }
      }

      function resolve() {
        send({ type: "game_resolved", gameId })
        cleanup()
        try { controller.close() } catch { /* already closed */ }
      }

      function startHeartbeat() {
        state.heartbeatTimer = setInterval(() => {
          if (state.closed) return
          try { controller.enqueue(new TextEncoder().encode(": heartbeat\n\n")) } catch { /* closed */ }
        }, HEARTBEAT_INTERVAL_MS)
      }

      // DynamoDB polling — reliable fallback when Redis pub/sub is unavailable
      let lastSeenRound = game?.currentRound ?? 0
      function startPolling() {
        state.pollTimer = setInterval(async () => {
          if (state.closed) return
          try {
            const g = await getGame(gameId)
            if (!g) return
            maybePlayBotRound(g).catch(() => {/* next tick will retry */})
            if (g.currentRound !== lastSeenRound) {
              lastSeenRound = g.currentRound
              send({ type: "round_advanced", round: g.currentRound })
            }
            if (g.status === "completed") resolve()
          } catch { /* ignore transient errors */ }
        }, POLL_INTERVAL_MS)
        startHeartbeat()
      }

      // Try Redis pub/sub first; fall back to DynamoDB polling
      const hasSubscribe = typeof (redis as Record<string, unknown>).subscribe === "function"
      if (hasSubscribe) {
        try {
          state.subscriber = (redis as Record<string, (...a: unknown[]) => unknown>).subscribe<string>(`game:${gameId}`)
          state.subscriber.on("message", (data: { message?: string }) => {
            if (state.closed) return
            try {
              const raw = typeof data.message === "string" ? data.message : JSON.stringify(data.message)
              const parsed = JSON.parse(raw) as { type?: string }
              send(parsed)
              if (parsed.type === "game_resolved") resolve()
            } catch { /* ignore */ }
          })
          startHeartbeat()
        } catch {
          // Redis subscribe unavailable — fall back to polling
          startPolling()
        }
      } else {
        startPolling()
      }
    },
    cancel() {
      cleanup()
    },
  })

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  })
}
