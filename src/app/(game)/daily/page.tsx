"use client"

import { useEffect, useState, useRef } from "react"
import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { CodeViewer } from "@/components/game/CodeViewer"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DailyBug = {
  bugId: string
  language: string
  category: string
  difficulty: number
  buggyCode: string
  bugLine: number
  options: [string, string, string, string]
  correctAnswer?: number
  explanation?: string
  hint: string
}

type LeaderboardEntry = {
  rank: number
  userId: string
  displayName: string
  timeElapsedMs: number
}

type DailyPayload = {
  date: string
  bug: DailyBug
  submission: {
    userId: string
    correct: boolean
    timeElapsedMs: number
    submittedAt: number
  } | null
  leaderboard: LeaderboardEntry[]
  totalPlayers: number
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTime(ms: number): string {
  return (ms / 1000).toFixed(1) + "s"
}

const OPTION_LABELS = ["A", "B", "C", "D"] as const

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function DailyChallengePage() {
  const { data: session, status } = useSession()
  const router = useRouter()

  const [payload, setPayload] = useState<DailyPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Timer — running from when the bug loads until submission
  const startTimeRef = useRef<number | null>(null)
  const [elapsedMs, setElapsedMs] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Answer selection state
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<{
    correct: boolean
    correctAnswer: number
    explanation: string
    rank: number | null
  } | null>(null)

  // ---------------------------------------------------------------------------
  // Fetch daily challenge
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login")
      return
    }
    if (status !== "authenticated") return

    async function fetchDaily() {
      try {
        const res = await fetch("/api/daily")
        if (res.status === 404) {
          setError("No daily challenge today. Check back after midnight UTC.")
          return
        }
        if (!res.ok) {
          setError("Failed to load daily challenge.")
          return
        }
        const data: DailyPayload = await res.json()
        setPayload(data)

        // If already submitted, don't start timer
        if (!data.submission) {
          startTimeRef.current = Date.now()
          timerRef.current = setInterval(() => {
            setElapsedMs(Date.now() - (startTimeRef.current ?? Date.now()))
          }, 100)
        } else {
          setElapsedMs(data.submission.timeElapsedMs)
        }
      } catch {
        setError("Network error. Please try again.")
      } finally {
        setLoading(false)
      }
    }

    fetchDaily()

    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [status, router])

  // ---------------------------------------------------------------------------
  // Submit answer
  // ---------------------------------------------------------------------------

  async function handleSubmit() {
    if (selectedAnswer === null || !payload || result) return
    setSubmitting(true)

    // Stop timer
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    const finalTime = Date.now() - (startTimeRef.current ?? Date.now())
    setElapsedMs(finalTime)

    try {
      const res = await fetch("/api/daily/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answer: selectedAnswer, timeElapsedMs: finalTime }),
      })

      if (res.status === 409) {
        toast.error("You already submitted today!")
        return
      }

      const data = await res.json()
      setResult(data)

      if (data.correct) {
        toast.success(`Correct! Rank #${data.rank ?? "?"}`)
      } else {
        toast.error("Incorrect — see explanation below")
      }
    } catch {
      toast.error("Submission failed. Please try again.")
    } finally {
      setSubmitting(false)
    }
  }

  // ---------------------------------------------------------------------------
  // Share button
  // ---------------------------------------------------------------------------

  function handleShare() {
    if (!payload) return
    const timeMs = result?.rank != null ? elapsedMs : 0
    const rank = result?.rank ?? ""
    const correct = result?.correct ?? payload.submission?.correct ?? false
    const url = `${window.location.origin}/share/daily/${payload.date}?correct=${correct}&time=${timeMs}&rank=${rank}`
    navigator.clipboard.writeText(url).then(() => {
      toast.success("Share link copied!")
    })
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-white/60">Loading today&apos;s challenge...</p>
      </main>
    )
  }

  if (error) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-4">
        <p className="text-white/60">{error}</p>
        <Button onClick={() => router.push("/play")}>Play a regular game</Button>
      </main>
    )
  }

  if (!payload) return null

  const alreadySubmitted = !!payload.submission
  const submitted = !!result || alreadySubmitted
  const submissionData = result ?? (payload.submission
    ? {
        correct: payload.submission.correct,
        correctAnswer: payload.bug.correctAnswer ?? 0,
        explanation: payload.bug.explanation ?? "",
        rank: null,
      }
    : null)

  // Daily streak from session (if available)
  const dailyStreak = (session?.user as { dailyStreak?: number } | undefined)?.dailyStreak

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-white">Daily Challenge</h1>
            {dailyStreak != null && dailyStreak > 0 && (
              <span className="text-sm text-orange-400 font-semibold">
                🔥 Day {dailyStreak} streak
              </span>
            )}
          </div>
          <p className="text-sm text-white/50">{payload.date}</p>
        </div>
        <div className="text-right">
          <p className="font-mono text-xl font-bold text-white">{formatTime(elapsedMs)}</p>
          <p className="text-xs text-white/40">{payload.totalPlayers} players today</p>
        </div>
      </div>

      {/* Code viewer */}
      <CodeViewer
        code={payload.bug.buggyCode}
        language={payload.bug.language}
        bugLine={payload.bug.bugLine}
        revealed={submitted}
      />

      {/* Options */}
      {!submitted && (
        <div className="space-y-2">
          {payload.bug.options.map((option, idx) => (
            <button
              key={idx}
              onClick={() => setSelectedAnswer(idx)}
              className={cn(
                "w-full rounded-lg border p-4 text-left transition-colors",
                selectedAnswer === idx
                  ? "border-emerald-500/60 bg-emerald-900/20 text-white"
                  : "border-white/10 bg-white/5 text-white/70 hover:border-white/20 hover:bg-white/10"
              )}
            >
              <span className="mr-3 font-mono text-sm text-white/40">
                [{OPTION_LABELS[idx]}]
              </span>
              {option}
            </button>
          ))}

          <Button
            size="lg"
            className="w-full"
            onClick={handleSubmit}
            disabled={selectedAnswer === null || submitting}
          >
            {submitting ? "Submitting..." : "Submit Answer"}
          </Button>
        </div>
      )}

      {/* Revealed options after submission */}
      {submitted && submissionData && (
        <div className="space-y-2">
          {payload.bug.options.map((option, idx) => (
            <div
              key={idx}
              className={cn(
                "w-full rounded-lg border p-4 text-left",
                idx === submissionData.correctAnswer
                  ? "border-green-500/60 bg-green-900/20 text-white"
                  : idx === selectedAnswer && idx !== submissionData.correctAnswer
                  ? "border-red-500/60 bg-red-900/20 text-white/70"
                  : "border-white/10 bg-white/5 text-white/40"
              )}
            >
              <span className="mr-3 font-mono text-sm text-white/40">
                [{OPTION_LABELS[idx]}]
              </span>
              {option}
              {idx === submissionData.correctAnswer && (
                <span className="ml-2 text-green-400 text-xs font-semibold">✓ Correct</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Result */}
      {submitted && submissionData && (
        <div
          className={cn(
            "rounded-xl border p-5 space-y-3",
            submissionData.correct
              ? "border-green-500/40 bg-green-900/20"
              : "border-red-500/40 bg-red-900/20"
          )}
        >
          <div className="flex items-center justify-between">
            <h2
              className={cn(
                "text-lg font-bold",
                submissionData.correct ? "text-green-400" : "text-red-400"
              )}
            >
              {submissionData.correct ? "Correct!" : "Incorrect"}
            </h2>
            {submissionData.rank != null && (
              <span className="text-sm text-white/60">Rank #{submissionData.rank}</span>
            )}
          </div>
          <p className="text-sm text-white/80">{submissionData.explanation}</p>
          <div className="flex gap-3">
            <Button size="sm" onClick={handleShare} variant="outline">
              Share Result
            </Button>
            <Button size="sm" onClick={() => router.push("/play")}>
              Play Ranked
            </Button>
          </div>
        </div>
      )}

      {/* Leaderboard */}
      {payload.leaderboard.length > 0 && (
        <div className="rounded-xl border border-white/10 bg-white/5 p-5">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-white/50">
            Today&apos;s Leaderboard
          </h2>
          <ol className="space-y-2">
            {payload.leaderboard.map((entry) => (
              <li
                key={entry.userId}
                className="flex items-center justify-between text-sm"
              >
                <div className="flex items-center gap-3">
                  <span className="w-6 text-center font-mono text-white/40">
                    #{entry.rank}
                  </span>
                  <span className="text-white">{entry.displayName}</span>
                </div>
                <span className="font-mono text-white/60">
                  {formatTime(entry.timeElapsedMs)}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </main>
  )
}
