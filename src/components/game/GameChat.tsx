// src/components/game/GameChat.tsx
"use client"

import { useEffect, useRef, useState } from "react"
import { useSession } from "next-auth/react"
import { Button } from "@/components/ui/button"

type ChatMessage = {
  userId: string
  displayName: string
  message: string
  createdAt: number
}

interface GameChatProps {
  gameId: string
}

const MAX_MESSAGE_LENGTH = 200
const MAX_MESSAGES_PER_USER = 5

export function GameChat({ gameId }: GameChatProps) {
  const { data: session } = useSession()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState("")
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const myMessageCount = messages.filter(
    (m) => m.userId === session?.user?.id
  ).length
  const canSend = myMessageCount < MAX_MESSAGES_PER_USER

  async function fetchMessages() {
    try {
      const res = await fetch(`/api/game/${gameId}/chat`)
      if (res.ok) {
        const data = await res.json() as { messages: ChatMessage[] }
        // API returns newest-first; reverse for chronological display
        setMessages(data.messages.slice().reverse())
      }
    } catch {
      // silently ignore poll errors
    }
  }

  useEffect(() => {
    fetchMessages()
    intervalRef.current = setInterval(fetchMessages, 5_000)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId])

  async function handleSend() {
    if (!input.trim() || sending || !canSend) return
    setSending(true)
    setError(null)
    try {
      const res = await fetch(`/api/game/${gameId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: input.trim() }),
      })
      if (res.ok) {
        setInput("")
        await fetchMessages()
      } else {
        const data = await res.json() as { error: string }
        setError(data.error ?? "Failed to send")
      }
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-white/10 bg-white/5 p-4">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-white/50">
        Post-Game Chat
      </h3>

      {messages.length === 0 ? (
        <p className="text-sm text-white/30">No messages yet. Say gg!</p>
      ) : (
        <ul className="space-y-2">
          {messages.map((msg, idx) => (
            <li key={idx} className="flex gap-2 text-sm">
              <span className="shrink-0 font-semibold text-white/70">
                {msg.displayName}:
              </span>
              <span className="text-white/90">{msg.message}</span>
            </li>
          ))}
        </ul>
      )}

      {session?.user?.id && (
        <div className="space-y-1">
          {canSend ? (
            <div className="flex gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value.slice(0, MAX_MESSAGE_LENGTH))}
                onKeyDown={(e) => e.key === "Enter" && handleSend()}
                placeholder="Say something..."
                className="flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-1 focus:ring-white/20"
              />
              <Button
                size="sm"
                onClick={handleSend}
                disabled={sending || !input.trim()}
              >
                Send
              </Button>
            </div>
          ) : (
            <p className="text-xs text-white/30">
              You&apos;ve sent {MAX_MESSAGES_PER_USER} messages (limit reached).
            </p>
          )}
          {error && <p className="text-xs text-red-400">{error}</p>}
          <p className="text-right text-xs text-white/20">
            {myMessageCount}/{MAX_MESSAGES_PER_USER} messages
          </p>
        </div>
      )}
    </div>
  )
}
