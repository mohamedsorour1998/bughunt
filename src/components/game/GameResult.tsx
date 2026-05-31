"use client"

import { useState, useEffect } from "react"
import { CodeViewer } from "@/components/game/CodeViewer"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

// ---------------------------------------------------------------------------
// Rating Widget
// ---------------------------------------------------------------------------

function RatingWidget({ bugId }: { bugId: string }) {
  const [rated, setRated] = useState(false)
  async function rate(r: 1 | 2 | 3) {
    await fetch(`/api/bugs/${bugId}/rate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rating: r }) })
    setRated(true)
  }
  if (rated) return <p className="text-xs text-white/40">Thanks for your feedback!</p>
  return (
    <div className="flex items-center gap-2 text-sm text-white/60">
      <span>Was this difficulty fair?</span>
      <button onClick={() => rate(1)} className="hover:text-white px-2">Too easy</button>
      <button onClick={() => rate(2)} className="hover:text-white px-2">Fair</button>
      <button onClick={() => rate(3)} className="hover:text-white px-2">Too hard</button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Achievement display names
// ---------------------------------------------------------------------------

const ACHIEVEMENT_NAMES: Record<string, string> = {
  first_win: "First Win!",
  games_10: "10 Games Played",
  games_100: "100 Games Played",
  streak_5: "5-Game Win Streak",
  streak_10: "10-Game Win Streak",
  elo_1400: "Reached Platinum",
  elo_1600: "Reached Diamond",
  elo_2000: "Reached Master",
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GameResultProps {
  game: {
    gameId: string
    status: string
    winnerId: string | null
    createdAt: number
    player1Id: string
    player2Id: string
  }
  bug: {
    bugId?: string
    language: string
    category: string
    difficulty: number
    buggyCode: string
    bugLine: number
    options: [string, string, string, string]
    correctAnswer: number
    explanation: string
    hint: string
  }
  myRecord: {
    userId: string
    answer: number | null
    correct: boolean | null
    submittedAt: number | null
    timeElapsedMs: number | null
  }
  opponentRecord: {
    userId: string
    answer: number | null
    correct: boolean | null
    submittedAt: number | null
    timeElapsedMs: number | null
  } | null
  eloChange: number
  newElo: number
  newAchievements?: string[]
  onPlayAgain: () => void
  opponentId?: string        // present when the game had a human opponent
  onRematch?: () => void     // called when rematch is initiated (for parent polling logic)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTime(ms: number | null): string {
  if (ms === null) return "—"
  return (ms / 1000).toFixed(1) + "s"
}

const OPTION_LABELS = ["A", "B", "C", "D"] as const

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function GameResult({
  game,
  bug,
  myRecord,
  opponentRecord,
  eloChange,
  newElo,
  newAchievements,
  onPlayAgain,
  opponentId,
  onRematch,
}: GameResultProps) {
  // Determine outcome
  const isWin = game.winnerId === myRecord.userId
  const isLoss = game.winnerId !== null && game.winnerId !== myRecord.userId
  const isDraw = game.winnerId === null

  const outcome: "win" | "loss" | "draw" = isWin ? "win" : isLoss ? "loss" : "draw"

  // Elo display
  const eloSign = eloChange > 0 ? "+" : eloChange < 0 ? "" : "+"
  const eloDisplay = `${eloSign}${eloChange} Elo`
  const eloBefore = newElo - eloChange

  // ---- Rematch state ----
  const [rematchState, setRematchState] = useState<"idle" | "waiting" | "declined">("idle")
  const [countdown, setCountdown] = useState(60)

  useEffect(() => {
    if (rematchState !== "waiting") return
    if (countdown <= 0) {
      setRematchState("declined")
      return
    }
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000)
    return () => clearTimeout(timer)
  }, [rematchState, countdown])

  async function handleRematch() {
    if (!opponentId) return
    setRematchState("waiting")
    setCountdown(60)
    try {
      await fetch("/api/game/rematch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ opponentId }),
      })
      onRematch?.()
    } catch {
      setRematchState("idle")
    }
  }

  // My answer label
  const myAnswerIdx = myRecord.answer
  const correctIdx = bug.correctAnswer
  const myAnswerLabel = myAnswerIdx !== null ? OPTION_LABELS[myAnswerIdx] : null
  const myAnswerText = myAnswerIdx !== null ? bug.options[myAnswerIdx] : null
  const correctAnswerText = bug.options[correctIdx]

  // Banner config
  const bannerConfig = {
    win: {
      bg: "bg-green-900/60 border-green-500/60",
      text: "text-green-100",
      title: "You Won! 🎉",
      eloColor: "text-yellow-400",
    },
    loss: {
      bg: "bg-red-900/60 border-red-500/60",
      text: "text-red-100",
      title: "You Lost",
      eloColor: "text-red-300",
    },
    draw: {
      bg: "bg-gray-800/80 border-gray-600/60",
      text: "text-gray-200",
      title: "Draw",
      eloColor: "text-gray-400",
    },
  }[outcome]

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      {/* ------------------------------------------------------------------ */}
      {/* Banner                                                               */}
      {/* ------------------------------------------------------------------ */}
      <div
        className={cn(
          "flex items-center justify-between rounded-2xl border px-6 py-5",
          bannerConfig.bg
        )}
      >
        <h1 className={cn("text-2xl font-bold sm:text-3xl", bannerConfig.text)}>
          {bannerConfig.title}
        </h1>
        <span
          className={cn(
            "animate-bounce text-xl font-bold sm:text-2xl",
            bannerConfig.eloColor
          )}
        >
          {eloDisplay}
        </span>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Code section with bug revealed                                       */}
      {/* ------------------------------------------------------------------ */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="rounded-md border border-red-500/40 bg-red-900/30 px-2 py-1 text-xs font-semibold text-red-300">
            Bug on line {bug.bugLine}
          </span>
          <span className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs font-medium text-white/50 uppercase">
            {bug.language}
          </span>
          <span className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs text-white/40">
            {bug.category}
          </span>
        </div>
        <CodeViewer
          code={bug.buggyCode}
          language={bug.language}
          bugLine={bug.bugLine}
          revealed={true}
        />
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Answer breakdown                                                     */}
      {/* ------------------------------------------------------------------ */}
      <div className="space-y-3 rounded-xl border border-white/10 bg-white/5 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-white/50">
          Answer Breakdown
        </h2>

        {/* Your answer */}
        {myAnswerIdx !== null && myAnswerText !== null ? (
          <div
            className={cn(
              "flex items-start gap-3 rounded-lg border p-4",
              myRecord.correct
                ? "border-green-500/40 bg-green-900/20"
                : "border-red-500/40 bg-red-900/20"
            )}
          >
            <span className="mt-0.5 text-lg leading-none">
              {myRecord.correct ? "✅" : "❌"}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-white/50">Your answer</p>
              <p className="mt-0.5 font-medium text-white">
                <span className="mr-2 font-mono text-sm text-white/60">
                  [{myAnswerLabel}]
                </span>
                {myAnswerText}
              </p>
              {!myRecord.correct && (
                <p className="mt-1 text-xs text-red-300">
                  This was not the bug on line {bug.bugLine}.
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-white/10 bg-white/5 p-4">
            <p className="text-sm text-white/40">You did not submit an answer.</p>
          </div>
        )}

        {/* Correct answer */}
        <div className="flex items-start gap-3 rounded-lg border border-green-500/30 bg-green-900/10 p-4">
          <span className="mt-0.5 text-lg leading-none">✅</span>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-white/50">Correct answer</p>
            <p className="mt-0.5 font-medium text-white">
              <span className="mr-2 font-mono text-sm text-white/60">
                [{OPTION_LABELS[correctIdx]}]
              </span>
              {correctAnswerText}
            </p>
            <p className="mt-2 text-sm text-white/70">{bug.explanation}</p>
          </div>
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Difficulty rating                                                    */}
      {/* ------------------------------------------------------------------ */}
      {(bug.bugId ?? game.gameId) && <RatingWidget bugId={bug.bugId ?? game.gameId} />}

      {/* ------------------------------------------------------------------ */}
      {/* Opponent comparison                                                  */}
      {/* ------------------------------------------------------------------ */}
      {opponentRecord && (
        <div className="rounded-xl border border-white/10 bg-white/5 p-5">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-white/50">
            Opponent
          </h2>

          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-lg">
                {opponentRecord.correct ? "✅" : opponentRecord.answer !== null ? "❌" : "⏱️"}
              </span>
              <span className="font-medium text-white">
                {opponentRecord.correct
                  ? "Correct"
                  : opponentRecord.answer !== null
                  ? "Wrong"
                  : "Did not submit"}
              </span>
            </div>

            {opponentRecord.timeElapsedMs !== null && (
              <span className="text-sm text-white/60">
                in {formatTime(opponentRecord.timeElapsedMs)}
              </span>
            )}

            {/* Tiebreaker note */}
            {myRecord.correct && opponentRecord.correct && (
              <span className="ml-auto text-sm text-white/50">
                {(myRecord.timeElapsedMs ?? Infinity) <
                (opponentRecord.timeElapsedMs ?? Infinity)
                  ? "You were faster"
                  : (myRecord.timeElapsedMs ?? Infinity) >
                    (opponentRecord.timeElapsedMs ?? Infinity)
                  ? "Opponent was faster"
                  : "Exact tie"}
              </span>
            )}
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Stats row                                                            */}
      {/* ------------------------------------------------------------------ */}
      <div className="grid grid-cols-3 gap-3">
        {/* Your time */}
        <div className="flex flex-col items-center gap-1 rounded-xl border border-white/10 bg-white/5 p-4">
          <span className="text-xs font-medium uppercase tracking-wider text-white/40">
            Your Time
          </span>
          <span className="font-mono text-lg font-bold text-white">
            {formatTime(myRecord.timeElapsedMs)}
          </span>
        </div>

        {/* Result */}
        <div className="flex flex-col items-center gap-1 rounded-xl border border-white/10 bg-white/5 p-4">
          <span className="text-xs font-medium uppercase tracking-wider text-white/40">
            Result
          </span>
          <span
            className={cn(
              "text-lg font-bold capitalize",
              outcome === "win"
                ? "text-green-400"
                : outcome === "loss"
                ? "text-red-400"
                : "text-gray-300"
            )}
          >
            {outcome}
          </span>
        </div>

        {/* Elo */}
        <div className="flex flex-col items-center gap-1 rounded-xl border border-white/10 bg-white/5 p-4">
          <span className="text-xs font-medium uppercase tracking-wider text-white/40">
            New Elo
          </span>
          <span className="font-mono text-lg font-bold text-white">{newElo}</span>
          <span className="text-xs text-white/40">was {eloBefore}</span>
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* New Achievements                                                     */}
      {/* ------------------------------------------------------------------ */}
      {newAchievements && newAchievements.length > 0 && (
        <div className="rounded-xl border border-yellow-500/40 bg-yellow-900/20 p-5">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-yellow-400">
            🏆 New Achievements Unlocked!
          </h2>
          <div className="flex flex-wrap gap-2">
            {newAchievements.map((achievement) => (
              <span
                key={achievement}
                className="inline-flex items-center gap-1.5 rounded-full border border-yellow-500/40 bg-yellow-900/40 px-3 py-1 text-sm font-medium text-yellow-300"
              >
                🏅 {ACHIEVEMENT_NAMES[achievement] ?? achievement}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Actions                                                              */}
      {/* ------------------------------------------------------------------ */}
      <div className="flex flex-col items-center gap-3 pb-4 sm:flex-row sm:justify-center">
        <Button size="lg" onClick={onPlayAgain} className="min-w-48">
          Play Again
        </Button>

        {opponentId && (
          <Button
            size="lg"
            variant="outline"
            className="min-w-48"
            onClick={rematchState === "idle" ? handleRematch : undefined}
            disabled={rematchState === "waiting" || rematchState === "declined"}
          >
            {rematchState === "idle" && "Rematch"}
            {rematchState === "waiting" && `Waiting... ${countdown}s`}
            {rematchState === "declined" && "Opponent declined"}
          </Button>
        )}
      </div>
    </div>
  )
}
