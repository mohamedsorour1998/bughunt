"use client"

import { useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"

interface GameTimerProps {
  createdAt: number
  duration?: number
  onExpire?: () => void
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, "0")}`
}

export function GameTimer({
  createdAt,
  duration = 120,
  onExpire,
}: GameTimerProps) {
  const [remaining, setRemaining] = useState(() =>
    Math.max(0, duration - Math.floor((Date.now() - createdAt) / 1000))
  )
  const expiredRef = useRef(false)
  const onExpireRef = useRef(onExpire)

  useEffect(() => {
    onExpireRef.current = onExpire
  }, [onExpire])

  useEffect(() => {
    if (remaining === 0 && !expiredRef.current) {
      expiredRef.current = true
      onExpireRef.current?.()
      return
    }

    if (remaining <= 0) return

    const id = setInterval(() => {
      const next = Math.max(0, duration - Math.floor((Date.now() - createdAt) / 1000))
      if (next === 0 && !expiredRef.current) {
        expiredRef.current = true
        onExpireRef.current?.()
      }
      setRemaining(next)
    }, 1000)

    return () => clearInterval(id)
  }, [createdAt, duration, remaining])

  const colorClass =
    remaining < 30
      ? "text-red-400"
      : remaining < 60
        ? "text-yellow-400"
        : "text-white/80"

  const pulseClass = remaining < 30 ? "animate-pulse" : ""

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 font-mono text-base font-semibold tabular-nums",
        colorClass,
        pulseClass
      )}
      aria-label={`Time remaining: ${formatTime(remaining)}`}
      aria-live="off"
    >
      <svg
        className="size-4 shrink-0"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
      {formatTime(remaining)}
    </div>
  )
}
