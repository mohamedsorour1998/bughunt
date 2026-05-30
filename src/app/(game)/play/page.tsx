"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { CodeViewer } from "@/components/game/CodeViewer"
import { AnswerOptions } from "@/components/game/AnswerOptions"
import { GameTimer } from "@/components/game/GameTimer"
import { MatchmakingOverlay } from "@/components/game/MatchmakingOverlay"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PlayState = "idle" | "matchmaking" | "playing" | "submitting" | "completed"

interface BugData {
  bugId: string
  language: string
  category: string
  difficulty: number
  buggyCode: string
  bugLine?: number
  options: [string, string, string, string]
  hint?: string
  correctAnswer?: number
  explanation?: string
  correctCode?: string
}

interface GameData {
  gameId: string
  player1Id: string
  player2Id: string | null
  bugId: string
  status: "waiting" | "active" | "completed"
  winnerId: string | null
  createdAt: number
  expiresAt: number
}

interface PlayerRecord {
  gameId: string
  userId: string
  answer: number | null
  correct: boolean | null
  submittedAt: number | null
  timeElapsedMs: number | null
}

interface StatusResponse {
  game: GameData
  bug: BugData | null
  player: PlayerRecord | null
}

interface SubmitResult {
  correct: boolean
  answer: number
  submittedAt: number
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getRankFromElo(elo: number): string {
  if (elo >= 2000) return "Grandmaster"
  if (elo >= 1800) return "Master"
  if (elo >= 1600) return "Diamond"
  if (elo >= 1400) return "Platinum"
  if (elo >= 1200) return "Gold"
  if (elo >= 1000) return "Silver"
  return "Bronze"
}

function DifficultyStars({ difficulty }: { difficulty: number }) {
  return (
    <span className="text-base" aria-label={`Difficulty: ${difficulty} out of 5`}>
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i} className={i < difficulty ? "text-yellow-400" : "text-white/20"}>
          ★
        </span>
      ))}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function PlayPage() {
  const router = useRouter()
  const { data: session, status: sessionStatus } = useSession()

  const [playState, setPlayState] = useState<PlayState>("idle")
  const [gameId, setGameId] = useState<string | null>(null)
  const [gameData, setGameData] = useState<GameData | null>(null)
  const [bugData, setBugData] = useState<BugData | null>(null)
  const [playerRecord, setPlayerRecord] = useState<PlayerRecord | null>(null)
  const [selectedAnswer, setSelectedAnswer] = useState<number | undefined>(undefined)
  const [submitResult, setSubmitResult] = useState<SubmitResult | null>(null)
  const [opponentSubmitted, setOpponentSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cancelLoading, setCancelLoading] = useState(false)

  // User's Elo from session (may be undefined)
  const [userElo, setUserElo] = useState<number>(1200)

  // Fetch user profile to get elo
  useEffect(() => {
    if (session?.user?.id) {
      fetch("/api/user/profile")
        .then((r) => r.json())
        .then((data) => {
          if (typeof data?.elo === "number") {
            setUserElo(data.elo)
          }
        })
        .catch(() => {
          // silently ignore — default elo will be used
        })
    }
  }, [session?.user?.id])

  // Polling ref — cleared on unmount and state changes
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => stopPolling()
  }, [])

  // ---------------------------------------------------------------------------
  // Matchmaking — start polling when entering matchmaking state
  // ---------------------------------------------------------------------------

  const startMatchmakingPolling = useCallback(
    (id: string) => {
      stopPolling()
      pollRef.current = setInterval(async () => {
        try {
          const res = await fetch(`/api/game/status?gameId=${id}`)
          if (!res.ok) return
          const data: StatusResponse = await res.json()
          if (data.game?.status === "active") {
            stopPolling()
            setGameData(data.game)
            setBugData(data.bug)
            setPlayerRecord(data.player)
            setPlayState("playing")
          }
        } catch {
          // Network hiccup — will retry
        }
      }, 3000)
    },
    []
  )

  // ---------------------------------------------------------------------------
  // Gameplay polling — continues until game completes
  // ---------------------------------------------------------------------------

  const startGameplayPolling = useCallback(
    (id: string) => {
      stopPolling()
      pollRef.current = setInterval(async () => {
        try {
          const res = await fetch(`/api/game/status?gameId=${id}`)
          if (!res.ok) return
          const data: StatusResponse = await res.json()

          if (data.game) setGameData(data.game)
          if (data.player) setPlayerRecord(data.player)

          // Detect opponent submission via the [gameId] route
          const detailRes = await fetch(`/api/game/${id}`)
          if (detailRes.ok) {
            const detail = await detailRes.json()
            const myId = session?.user?.id
            const isPlayer1 = data.game?.player1Id === myId
            const opponentPlayer = isPlayer1
              ? detail.players?.player2
              : detail.players?.player1
            if (opponentPlayer?.submitted) {
              setOpponentSubmitted(true)
            }
          }

          if (data.game?.status === "completed") {
            stopPolling()
            setPlayState("completed")
            router.push(`/game/result/${id}`)
          }
        } catch {
          // Network hiccup — will retry
        }
      }, 3000)
    },
    [session?.user?.id, router]
  )

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  async function handleFindMatch() {
    setError(null)
    setPlayState("matchmaking")
    try {
      const res = await fetch("/api/game/matchmake", { method: "POST" })
      if (!res.ok) throw new Error("Matchmaking failed")
      const data = await res.json()
      const id: string = data.gameId

      if (data.status === "active") {
        // Immediately go to playing — fetch full game status
        const statusRes = await fetch(`/api/game/status?gameId=${id}`)
        if (statusRes.ok) {
          const statusData: StatusResponse = await statusRes.json()
          setGameId(id)
          setGameData(statusData.game)
          setBugData(statusData.bug)
          setPlayerRecord(statusData.player)
          setPlayState("playing")
          startGameplayPolling(id)
        } else {
          throw new Error("Failed to fetch game status")
        }
      } else {
        // Waiting in queue — start polling for a match
        setGameId(id)
        startMatchmakingPolling(id)
      }
    } catch (err) {
      stopPolling()
      setPlayState("idle")
      setError(err instanceof Error ? err.message : "Failed to start matchmaking")
    }
  }

  async function handleCancel() {
    setCancelLoading(true)
    stopPolling()
    try {
      await fetch("/api/game/cancel", { method: "POST" })
    } catch {
      // Ignore cancel errors
    } finally {
      setCancelLoading(false)
      setGameId(null)
      setGameData(null)
      setBugData(null)
      setPlayerRecord(null)
      setSelectedAnswer(undefined)
      setSubmitResult(null)
      setOpponentSubmitted(false)
      setPlayState("idle")
    }
  }

  async function handleAnswer(index: number) {
    if (!gameId || playState !== "playing") return
    setSelectedAnswer(index)
    setPlayState("submitting")
    setError(null)

    try {
      const res = await fetch("/api/game/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gameId, answer: index }),
      })

      if (res.status === 409) {
        // Already submitted
        setPlayState("playing")
        return
      }

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        throw new Error(errData?.error ?? "Submission failed")
      }

      const result: SubmitResult = await res.json()
      setSubmitResult(result)
      setPlayState("playing")
      // Continue polling for game completion
      startGameplayPolling(gameId)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submission failed")
      setPlayState("playing")
    }
  }

  async function handleTimerExpire() {
    if (!gameId) return
    // Submit with the currently selected answer (or -1 mapped to 0 as fallback)
    // The server rejects answers < 0 so we guard here; use 0 as timeout answer if nothing selected
    const answer = selectedAnswer ?? 0
    // Only auto-submit if not already submitted
    if (submitResult === null) {
      await handleAnswer(answer)
    }
  }

  // ---------------------------------------------------------------------------
  // Render: not-loaded session
  // ---------------------------------------------------------------------------

  if (sessionStatus === "loading") {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <div className="text-white/50">Loading...</div>
      </main>
    )
  }

  // ---------------------------------------------------------------------------
  // Render: not signed in
  // ---------------------------------------------------------------------------

  if (!session?.user) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-4">
        <div className="text-center">
          <h1 className="mb-2 text-3xl font-bold text-white">BugHunt</h1>
          <p className="text-white/60">Sign in to play competitive debugging battles</p>
        </div>
        <Button
          size="lg"
          onClick={() => router.push("/login")}
          className="min-w-40"
        >
          Sign in to play
        </Button>
      </main>
    )
  }

  // ---------------------------------------------------------------------------
  // Render: matchmaking overlay
  // ---------------------------------------------------------------------------

  if (playState === "matchmaking") {
    return (
      <main className="min-h-screen">
        <MatchmakingOverlay
          userElo={userElo}
          onCancel={handleCancel}
          isLoading={cancelLoading}
        />
      </main>
    )
  }

  // ---------------------------------------------------------------------------
  // Render: playing / submitting
  // ---------------------------------------------------------------------------

  if ((playState === "playing" || playState === "submitting") && gameData && bugData) {
    const hasSubmitted = submitResult !== null
    const isSubmitting = playState === "submitting"
    const answersDisabled = hasSubmitted || isSubmitting

    return (
      <main className="min-h-screen px-4 py-6 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl space-y-6">
          {/* Header row */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Badge variant="secondary" className="font-mono text-xs uppercase">
                {bugData.language}
              </Badge>
              <DifficultyStars difficulty={bugData.difficulty} />
            </div>

            <div className="flex items-center gap-3">
              {/* Opponent status */}
              <span className="text-sm text-white/50">
                {opponentSubmitted ? "Opponent submitted!" : "Opponent thinking..."}
              </span>

              <GameTimer
                createdAt={gameData.createdAt}
                onExpire={handleTimerExpire}
              />
            </div>
          </div>

          {/* Error banner */}
          {error && (
            <div className="rounded-lg border border-red-500/40 bg-red-900/20 px-4 py-3 text-sm text-red-300">
              {error}
              <button
                className="ml-3 underline"
                onClick={() => setError(null)}
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Code viewer */}
          <CodeViewer
            code={bugData.buggyCode}
            language={bugData.language}
            bugLine={bugData.bugLine}
            revealed={false}
          />

          {/* Answer options + submitting indicator */}
          <div className="space-y-3">
            {isSubmitting && (
              <div className="flex items-center gap-2 text-sm text-white/50">
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
                Submitting...
              </div>
            )}

            <AnswerOptions
              options={bugData.options}
              selectedAnswer={selectedAnswer}
              disabled={answersDisabled}
              onAnswer={handleAnswer}
            />
          </div>

          {/* Post-submit waiting message */}
          {hasSubmitted && !isSubmitting && (
            <p className="text-center text-sm text-white/40">
              Answer submitted — waiting for opponent...
            </p>
          )}
        </div>
      </main>
    )
  }

  // ---------------------------------------------------------------------------
  // Render: idle (default)
  // ---------------------------------------------------------------------------

  const rank = getRankFromElo(userElo)

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 px-4 py-12">
      <div className="w-full max-w-md space-y-6 text-center">
        <div className="space-y-2">
          <h1 className="text-4xl font-bold tracking-tight text-white">BugHunt</h1>
          <p className="text-white/60">Find an opponent and race to spot the bug</p>
        </div>

        {/* Elo + rank */}
        <div className="flex items-center justify-center gap-3">
          <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 py-2">
            <span className="text-xs font-medium uppercase tracking-wider text-white/40">
              Elo
            </span>
            <span className="font-mono text-lg font-bold text-white">
              {userElo.toLocaleString()}
            </span>
          </div>
          <Badge variant="secondary">{rank}</Badge>
        </div>

        {/* Error */}
        {error && (
          <div className="rounded-lg border border-red-500/40 bg-red-900/20 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        {/* Find match button */}
        <Button
          size="lg"
          className="w-full sm:w-auto sm:min-w-48"
          onClick={handleFindMatch}
        >
          Find Match
        </Button>
      </div>
    </main>
  )
}
