"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useSession } from "next-auth/react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { CodeViewer } from "@/components/game/CodeViewer"
import { AnswerOptions } from "@/components/game/AnswerOptions"
import { GameTimer } from "@/components/game/GameTimer"
import { MatchmakingOverlay } from "@/components/game/MatchmakingOverlay"
import { DuelHeader, type DuelPlayerInfo, type RoundOutcome } from "@/components/game/DuelHeader"
import { cn } from "@/lib/utils"

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
  bugIds: string[]
  bugId: string
  currentRound: number
  roundStartedAt: number[]
  status: "waiting" | "active" | "completed"
  winnerId: string | null
  createdAt: number
  expiresAt: number
}

interface RoundAnswer {
  bugId: string
  answer: number | null
  correct: boolean | null
  submittedAt: number | null
  timeElapsedMs: number | null
}

interface PlayerRecord {
  gameId: string
  userId: string
  answers: RoundAnswer[]
}

interface StatusResponse {
  game: GameData
  bug: BugData | null
  bugs: BugData[] | null
  player: PlayerRecord | null
}

interface SubmitResult {
  correct: boolean
  answer: number
  submittedAt: number
  roundIndex: number
}

const ROUNDS_PER_GAME = 3

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
  const searchParams = useSearchParams()
  const joinGameId = searchParams.get("join")
  const rematchGameId = searchParams.get("gameId")
  const { data: session, status: sessionStatus } = useSession()

  const [playState, setPlayState] = useState<PlayState>("idle")
  const [gameId, setGameId] = useState<string | null>(null)
  const [gameData, setGameData] = useState<GameData | null>(null)
  const [bugData, setBugData] = useState<BugData | null>(null)
  const [playerRecord, setPlayerRecord] = useState<PlayerRecord | null>(null)
  const [selectedAnswer, setSelectedAnswer] = useState<number | undefined>(undefined)
  const [roundAnswers, setRoundAnswers] = useState<Record<number, SubmitResult>>({})
  const [opponentSubmittedRounds, setOpponentSubmittedRounds] = useState<Set<number>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [cancelLoading, setCancelLoading] = useState(false)

  // User's Elo from session (may be undefined)
  const [userElo, setUserElo] = useState<number>(1200)
  const [myProfile, setMyProfile] = useState<DuelPlayerInfo | null>(null)
  const [opponentProfile, setOpponentProfile] = useState<DuelPlayerInfo | null>(null)

  // Fetch user profile to get elo
  useEffect(() => {
    if (session?.user?.id) {
      fetch("/api/user/profile")
        .then((r) => r.json())
        .then((data) => {
          if (typeof data?.elo === "number") {
            setUserElo(data.elo)
          }
          if (data?.displayName) {
            setMyProfile({
              displayName: data.displayName as string,
              elo: (data.elo as number) ?? 1200,
              avatar: (data.avatar as string | null) ?? null,
            })
          }
        })
        .catch(() => {
          // silently ignore — default elo will be used
        })
    }
  }, [session?.user?.id])

  // Fetch the opponent's public profile for the duel header
  const player1Id = gameData?.player1Id ?? null
  const player2Id = gameData?.player2Id ?? null
  useEffect(() => {
    const myId = session?.user?.id
    if (!myId || !player1Id) return
    const oppId = player1Id === myId ? player2Id : player1Id
    if (!oppId) return
    let cancelled = false
    fetch(`/api/user/profile/${oppId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((p) => {
        if (cancelled || !p) return
        setOpponentProfile({
          displayName: (p.displayName as string) ?? "Opponent",
          elo: (p.elo as number) ?? 1200,
          avatar: (p.avatar as string | null) ?? null,
        })
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [session?.user?.id, player1Id, player2Id])

  // Polling ref — cleared on unmount and state changes
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const esRef = useRef<EventSource | null>(null)

  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }

  function stopSSE() {
    if (esRef.current) { esRef.current.close(); esRef.current = null }
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => { stopPolling(); stopSSE() }
  }, [])

  // ---------------------------------------------------------------------------
  // Gameplay polling fallback — used when EventSource is unavailable or errors
  // ---------------------------------------------------------------------------

  const startPollingFallback = useCallback(
    (id: string) => {
      stopPolling()
      pollRef.current = setInterval(async () => {
        try {
          const res = await fetch(`/api/game/status?gameId=${id}`)
          if (!res.ok) return
          const data: StatusResponse = await res.json()

          if (data.game) {
            setGameData((prev) => {
              if (prev && prev.currentRound !== data.game.currentRound) {
                setSelectedAnswer(undefined)
                if (data.bug) setBugData(data.bug)
              }
              return data.game
            })
          }
          if (data.player) setPlayerRecord(data.player)

          // Detect per-round opponent submissions via the [gameId] route
          const detailRes = await fetch(`/api/game/${id}`)
          if (detailRes.ok) {
            const detail = await detailRes.json()
            const myId = session?.user?.id
            const isPlayer1 = data.game?.player1Id === myId
            const opponentPlayer: { answers?: { submitted?: boolean }[] } | null = isPlayer1
              ? detail.players?.player2
              : detail.players?.player1
            if (opponentPlayer?.answers) {
              const submittedRounds = opponentPlayer.answers
                .map((a, i) => (a.submitted ? i : -1))
                .filter((i) => i >= 0)
              if (submittedRounds.length > 0) {
                setOpponentSubmittedRounds((prev) => {
                  const next = new Set(prev)
                  submittedRounds.forEach((i) => next.add(i))
                  return next
                })
              }
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
  // Gameplay EventSource — with polling fallback on onerror
  // ---------------------------------------------------------------------------

  const startGameplayPolling = useCallback((id: string) => {
    stopPolling(); stopSSE()
    if (typeof EventSource !== "undefined") {
      const es = new EventSource(`/api/game/stream?gameId=${id}`)
      esRef.current = es
      es.onmessage = (event) => {
        try {
          const data: { type: string; userId?: string; roundIndex?: number; round?: number } = JSON.parse(event.data)
          if (data.type === "player_submitted" && data.userId !== session?.user?.id && typeof data.roundIndex === "number") {
            const idx = data.roundIndex
            setOpponentSubmittedRounds((prev) => {
              const next = new Set(prev)
              next.add(idx)
              return next
            })
          }
          if (data.type === "round_advanced") {
            setSelectedAnswer(undefined)
            fetch(`/api/game/status?gameId=${id}`)
              .then((res) => (res.ok ? res.json() : null))
              .then((statusData: StatusResponse | null) => {
                if (!statusData) return
                setGameData(statusData.game)
                setBugData(statusData.bug)
                setPlayerRecord(statusData.player)
              })
              .catch(() => {})
          }
          if (data.type === "game_resolved") {
            stopSSE(); stopPolling()
            setPlayState("completed")
            router.push(`/game/result/${id}`)
          }
        } catch { /* ignore malformed */ }
      }
      es.onerror = () => { stopSSE(); startPollingFallback(id) }
    } else {
      startPollingFallback(id)
    }
  }, [session?.user?.id, router, startPollingFallback])

  // ---------------------------------------------------------------------------
  // Matchmaking — start polling when entering matchmaking state
  // ---------------------------------------------------------------------------

  const startMatchmakingPolling = useCallback(
    () => {
      stopPolling()
      pollRef.current = setInterval(async () => {
        try {
          // Re-call matchmake: the server returns the active game if one was
          // created for us while we were queued, or keeps us in queue otherwise.
          const res = await fetch("/api/game/matchmake", { method: "POST" })
          if (!res.ok) return
          const data = await res.json()
          if (data.status === "active" && data.gameId) {
            const statusRes = await fetch(`/api/game/status?gameId=${data.gameId}`)
            if (!statusRes.ok) return
            const statusData: StatusResponse = await statusRes.json()
            stopPolling()
            setGameId(data.gameId)
            setGameData(statusData.game)
            setBugData(statusData.bug)
            setPlayerRecord(statusData.player)
            setPlayState("playing")
            startGameplayPolling(data.gameId)
          }
        } catch {
          // Network hiccup — will retry
        }
      }, 3000)
    },
    [startGameplayPolling]
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
        startMatchmakingPolling()
      }
    } catch (err) {
      stopPolling()
      setPlayState("idle")
      setError(err instanceof Error ? err.message : "Failed to start matchmaking")
    }
  }

  // ---------------------------------------------------------------------------
  // Private game join — triggered when ?join=gameId is in the URL
  // ---------------------------------------------------------------------------

  async function handleJoinPrivateGame(gId: string) {
    setError(null)
    try {
      const res = await fetch(`/api/game/join/${gId}`, { method: "POST" })
      if (res.ok) {
        const data = await res.json() as { status: string; gameId: string }
        if (data.status === "joined" || data.status === "active") {
          const statusRes = await fetch(`/api/game/status?gameId=${gId}`)
          if (statusRes.ok) {
            const statusData: StatusResponse = await statusRes.json()
            setGameId(gId)
            setGameData(statusData.game)
            setBugData(statusData.bug)
            setPlayerRecord(statusData.player)
            setPlayState("playing")
            startGameplayPolling(gId)
          }
        } else if (data.status === "waiting") {
          // Creator view: navigate directly; game page will poll for opponent
          const statusRes = await fetch(`/api/game/status?gameId=${gId}`)
          if (statusRes.ok) {
            const statusData: StatusResponse = await statusRes.json()
            setGameId(gId)
            setGameData(statusData.game)
            setBugData(statusData.bug)
            setPlayerRecord(statusData.player)
            setPlayState("playing")
            startGameplayPolling(gId)
          }
        }
      } else {
        const err = await res.json() as { error: string }
        setError(err.error ?? "Could not join game")
      }
    } catch {
      setError("Could not join game")
    }
  }

  // Auto-join private game on mount when ?join param is present
  useEffect(() => {
    if (!session?.user?.id || !joinGameId) return
    handleJoinPrivateGame(joinGameId)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id, joinGameId])

  // ---------------------------------------------------------------------------
  // Rematch entry — triggered when ?gameId=<id> is in the URL (already-active
  // game with both players assigned, created via createGame; just enter it)
  // ---------------------------------------------------------------------------

  async function handleEnterRematchGame(gId: string) {
    setError(null)
    try {
      const statusRes = await fetch(`/api/game/status?gameId=${gId}`)
      if (statusRes.ok) {
        const statusData: StatusResponse = await statusRes.json()
        setGameId(gId)
        setGameData(statusData.game)
        setBugData(statusData.bug)
        setPlayerRecord(statusData.player)
        setPlayState("playing")
        startGameplayPolling(gId)
      } else {
        setError("Could not load rematch game")
      }
    } catch {
      setError("Could not load rematch game")
    }
  }

  // Auto-enter rematch game on mount when ?gameId param is present
  useEffect(() => {
    if (!session?.user?.id || !rematchGameId) return
    handleEnterRematchGame(rematchGameId)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id, rematchGameId])

  async function handleCancel() {
    setCancelLoading(true)
    stopPolling(); stopSSE()
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
      setRoundAnswers({})
      setOpponentSubmittedRounds(new Set())
      setPlayState("idle")
    }
  }

  async function handleAnswer(index: number) {
    if (!gameId || playState !== "playing" || !gameData) return
    const roundIndex = gameData.currentRound
    if (roundAnswers[roundIndex] !== undefined) return
    setSelectedAnswer(index)
    setPlayState("submitting")
    setError(null)

    try {
      const res = await fetch("/api/game/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gameId, roundIndex, answer: index }),
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
      setRoundAnswers((prev) => ({ ...prev, [result.roundIndex]: result }))
      setPlayState("playing")
      // The SSE/poll connection opened on entering "playing" stays alive across
      // all rounds — restarting it here would race with the server publishing
      // round_advanced right after both players submit (Redis pub/sub is
      // fire-and-forget, so a mid-reconnect event would be silently dropped).
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submission failed")
      setPlayState("playing")
    }
  }

  async function handleTimerExpire() {
    if (!gameId || !gameData) return
    // Submit with the currently selected answer (or 0 as fallback if nothing selected)
    const answer = selectedAnswer ?? 0
    // Only auto-submit if this round hasn't been submitted yet
    if (roundAnswers[gameData.currentRound] === undefined) {
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
    const currentRound = gameData.currentRound
    const hasSubmitted =
      roundAnswers[currentRound] !== undefined ||
      playerRecord?.answers?.[currentRound]?.submittedAt != null
    const isSubmitting = playState === "submitting"
    const answersDisabled = hasSubmitted || isSubmitting
    const roundStartedAt = gameData.roundStartedAt[currentRound] ?? gameData.createdAt

    const myId = session?.user?.id
    const oppId = gameData.player1Id === myId ? gameData.player2Id : gameData.player1Id
    const opponentIsBot = !!oppId && oppId.startsWith("bot-")

    const myRoundOutcomes: RoundOutcome[] = Array.from({ length: ROUNDS_PER_GAME }, (_, i) => {
      const local = roundAnswers[i]
      const record = playerRecord?.answers?.[i]
      const submitted = local !== undefined || record?.submittedAt != null
      if (submitted) return (local?.correct ?? record?.correct) ? "correct" : "wrong"
      return i === currentRound ? "current" : "pending"
    })

    const lastVerdict = roundAnswers[currentRound]

    return (
      <main className="min-h-screen px-4 py-6 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl space-y-6">
          {/* Duel header: players, round pips, opponent status */}
          <DuelHeader
            me={myProfile}
            opponent={opponentProfile}
            opponentIsBot={opponentIsBot}
            currentRound={currentRound}
            roundsPerGame={ROUNDS_PER_GAME}
            myRoundOutcomes={myRoundOutcomes}
            opponentSubmittedRounds={opponentSubmittedRounds}
          />

          {/* Meta row: language, difficulty, timer */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Badge variant="secondary" className="font-mono text-xs uppercase">
                {bugData.language}
              </Badge>
              <DifficultyStars difficulty={bugData.difficulty} />
            </div>
            <GameTimer
              key={currentRound}
              createdAt={roundStartedAt}
              onExpire={handleTimerExpire}
            />
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
              selectedAnswer={selectedAnswer ?? playerRecord?.answers?.[currentRound]?.answer ?? undefined}
              disabled={answersDisabled}
              onAnswer={handleAnswer}
            />
          </div>

          {/* Post-submit verdict flash */}
          {hasSubmitted && !isSubmitting && (
            lastVerdict ? (
              <div
                className={cn(
                  "rounded-xl border px-4 py-3 text-center text-sm font-semibold animate-in fade-in slide-in-from-bottom-2 duration-300",
                  lastVerdict.correct
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                    : "border-red-500/40 bg-red-500/10 text-red-300"
                )}
              >
                {lastVerdict.correct ? "✓ Correct!" : "✗ Not quite."} Waiting for opponent...
              </div>
            ) : (
              <p className="text-center text-sm text-white/40">
                Answer submitted — waiting for opponent...
              </p>
            )
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
