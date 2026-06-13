"use client"

import { useEffect, useState } from "react"
import { Bug } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface MatchmakingOverlayProps {
  userElo: number
  onCancel: () => void
  isLoading?: boolean
}

export function MatchmakingOverlay({
  userElo,
  onCancel,
  isLoading = false,
}: MatchmakingOverlayProps) {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setElapsed((e) => e + 1), 1000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/95 backdrop-blur-sm">
      <div className="flex flex-col items-center gap-6 px-6 text-center">
        {/* Icon with animation */}
        <div className="relative flex items-center justify-center">
          <div className="absolute h-20 w-20 animate-ping rounded-full bg-blue-500/20" />
          <div className="relative flex h-16 w-16 items-center justify-center rounded-full border border-blue-500/40 bg-blue-900/30">
            <Bug className="size-8 text-blue-400" />
          </div>
        </div>

        {/* Heading + dots */}
        <div className="space-y-1">
          <h2 className="text-2xl font-bold text-white">
            Finding Opponent
            <AnimatedDots />
          </h2>
          <p className="text-sm text-white/50">
            {elapsed >= 8
              ? "No humans nearby — summoning a Nova bot…"
              : "Usually < 30 seconds"}
          </p>
        </div>

        {/* Elo badge */}
        <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 py-2">
          <span className="text-xs font-medium uppercase tracking-wider text-white/40">
            Your Elo
          </span>
          <span className="font-mono text-lg font-bold text-white">
            {userElo.toLocaleString()}
          </span>
        </div>

        {/* Cancel */}
        <Button
          variant="outline"
          onClick={onCancel}
          disabled={isLoading}
          className={cn(
            "min-w-32",
            isLoading && "cursor-not-allowed opacity-60"
          )}
        >
          {isLoading ? (
            <span className="flex items-center gap-2">
              <svg
                className="size-4 animate-spin"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden="true"
              >
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
              Cancelling...
            </span>
          ) : (
            "Cancel"
          )}
        </Button>
      </div>
    </div>
  )
}

function AnimatedDots() {
  return (
    <span className="inline-flex gap-0.5" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="inline-block animate-bounce text-blue-400"
          style={{ animationDelay: `${i * 150}ms` }}
        >
          .
        </span>
      ))}
    </span>
  )
}
