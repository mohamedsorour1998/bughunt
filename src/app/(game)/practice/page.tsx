"use client"

import { useEffect, useState, useCallback } from "react"
import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { CodeViewer } from "@/components/game/CodeViewer"
import { AnswerOptions } from "@/components/game/AnswerOptions"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BugData {
  bugId: string
  language: string
  category: string
  difficulty: 1 | 2 | 3 | 4 | 5
  buggyCode: string
  correctCode: string
  bugLine?: number
  options: [string, string, string, string]
  explanation: string
  hint?: string
}

type PracticeState = "loading" | "playing" | "revealed"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function DifficultySelector({
  selected,
  onChange,
}: {
  selected: number | null
  onChange: (d: number | null) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-white/50">Difficulty:</span>
      <button
        onClick={() => onChange(null)}
        className={[
          "rounded-lg border px-3 py-1 text-sm font-medium transition-colors",
          selected === null
            ? "border-blue-500 bg-blue-900/40 text-white"
            : "border-white/10 bg-white/5 text-white/60 hover:border-white/30",
        ].join(" ")}
      >
        Any
      </button>
      {[1, 2, 3, 4, 5].map((d) => (
        <button
          key={d}
          onClick={() => onChange(d)}
          className={[
            "rounded-lg border px-3 py-1 text-sm font-medium transition-colors",
            selected === d
              ? "border-blue-500 bg-blue-900/40 text-white"
              : "border-white/10 bg-white/5 text-white/60 hover:border-white/30",
          ].join(" ")}
        >
          {"★".repeat(d)}
        </button>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function PracticePage() {
  const router = useRouter()
  const { data: session } = useSession()

  const [practiceState, setPracticeState] = useState<PracticeState>("loading")
  const [bug, setBug] = useState<BugData | null>(null)
  const [difficulty, setDifficulty] = useState<number | null>(null)
  const [selectedAnswer, setSelectedAnswer] = useState<number | undefined>(undefined)
  const [correctAnswer, setCorrectAnswer] = useState<number | undefined>(undefined)
  const [showHint, setShowHint] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isCorrect, setIsCorrect] = useState<boolean | null>(null)

  // ---------------------------------------------------------------------------
  // Fetch a bug
  // ---------------------------------------------------------------------------

  const fetchBug = useCallback(async (diff: number | null) => {
    setPracticeState("loading")
    setSelectedAnswer(undefined)
    setCorrectAnswer(undefined)
    setShowHint(false)
    setError(null)
    setIsCorrect(null)
    setBug(null)

    try {
      const url = diff !== null
        ? `/api/bugs/random?difficulty=${diff}`
        : "/api/bugs/random"
      const res = await fetch(url)

      if (res.status === 404) {
        setError("No bugs available for this difficulty. Try a different one.")
        setPracticeState("playing")
        return
      }

      if (!res.ok) {
        throw new Error("Failed to fetch bug")
      }

      const data: BugData = await res.json()
      setBug(data)
      setPracticeState("playing")
    } catch {
      setError("Failed to load a bug. Please try again.")
      setPracticeState("playing")
    }
  }, [])

  // Load first bug on mount
  useEffect(() => {
    fetchBug(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  function handleDifficultyChange(d: number | null) {
    setDifficulty(d)
    fetchBug(d)
  }

  async function handleAnswer(index: number) {
    if (!bug || practiceState !== "playing") return
    setSelectedAnswer(index)

    // Fetch the correctAnswer from the reveal endpoint
    // We stored correctAnswer client-side after reveal — but the API strips it.
    // We reveal by re-fetching with ?reveal=1 isn't supported; instead we use
    // a separate lookup. For practice mode we simply make a second GET with a
    // special query that returns the full bug including the answer.
    // Since we own the endpoint, we add ?includeAnswer=1 for authenticated users.
    // However the simpler and correct approach: reveal the answer inline by
    // fetching /api/bugs/random is NOT the right approach (it returns a new bug).
    // Instead: we post the answer and get the result from a practice-specific
    // endpoint. But the spec says no backend answer validation for practice.
    //
    // The cleanest approach per spec: store correctAnswer in a separate state
    // variable that's populated when we reveal. We need to actually fetch the
    // full bug to get correctAnswer — so we expose it only at reveal time via
    // a different route. Given we control the data, we fetch the full bug record
    // via a separate practice-answer endpoint.
    //
    // Simplest valid approach given the spec: the practice page fetches the bug,
    // and correctAnswer is not sent initially. At reveal time (after answer picked)
    // we fetch a "reveal" version. We implement this by adding an optional
    // ?reveal=true query param to the same route that only returns correctAnswer
    // when the user has already committed to an answer (honour system in practice).
    //
    // For the MVP: reveal by fetching the same bug by ID with a reveal param.
    // We'll add ?reveal=true&bugId=<id> support to the route, OR — simplest of
    // all — we just return correctAnswer in the response but only after the user
    // has selected. We cannot do that without a server round-trip that verifies
    // an answer was selected.
    //
    // Decision: use /api/bugs/[bugId]/answer — but that doesn't exist yet.
    // Pragmatic solution for Task 13: expose correctAnswer via an additional
    // GET /api/bugs/random?reveal=1&bugId=<id> that returns the full bug.
    // This is a practice-mode convenience — no competitive integrity concern.

    try {
      const res = await fetch(`/api/bugs/random?reveal=1&bugId=${bug.bugId}`)
      let answer: number | undefined
      if (res.ok) {
        const data = await res.json()
        answer = data.correctAnswer as number
      }

      if (answer !== undefined) {
        setCorrectAnswer(answer)
        setIsCorrect(index === answer)
      } else {
        // Fallback: just reveal with selected answer marked, no correct highlighted
        setCorrectAnswer(undefined)
        setIsCorrect(null)
      }
    } catch {
      // Reveal without correct-answer highlighting
      setCorrectAnswer(undefined)
      setIsCorrect(null)
    }

    setPracticeState("revealed")
  }

  function handleNextBug() {
    fetchBug(difficulty)
  }

  // ---------------------------------------------------------------------------
  // Render: loading skeleton
  // ---------------------------------------------------------------------------

  if (practiceState === "loading") {
    return (
      <main className="min-h-screen px-4 py-6 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl space-y-6">
          <div className="flex items-center gap-3">
            <Skeleton className="h-6 w-28 rounded-full" />
            <Skeleton className="h-6 w-24 rounded-full" />
          </div>
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-64 w-full rounded-xl" />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Skeleton className="h-16 w-full rounded-xl" />
            <Skeleton className="h-16 w-full rounded-xl" />
            <Skeleton className="h-16 w-full rounded-xl" />
            <Skeleton className="h-16 w-full rounded-xl" />
          </div>
        </div>
      </main>
    )
  }

  // ---------------------------------------------------------------------------
  // Render: playing / revealed
  // ---------------------------------------------------------------------------

  return (
    <main className="min-h-screen px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl space-y-6">
        {/* Header row */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Badge
              variant="outline"
              className="border-purple-500/50 bg-purple-900/20 font-semibold text-purple-300"
            >
              Practice Mode
            </Badge>
            <span className="text-xs text-white/40 font-medium">No Elo change</span>
            {bug && (
              <>
                <Badge variant="secondary" className="font-mono text-xs uppercase">
                  {bug.language}
                </Badge>
                <DifficultyStars difficulty={bug.difficulty} />
              </>
            )}
          </div>

          <Button
            variant="ghost"
            size="sm"
            className="text-white/50 hover:text-white"
            onClick={() => router.push("/")}
          >
            ← Back
          </Button>
        </div>

        {/* Difficulty selector */}
        <DifficultySelector selected={difficulty} onChange={handleDifficultyChange} />

        {/* Error state */}
        {error && (
          <div className="rounded-lg border border-red-500/40 bg-red-900/20 px-4 py-3 text-sm text-red-300">
            {error}
            <button className="ml-3 underline" onClick={() => setError(null)}>
              Dismiss
            </button>
          </div>
        )}

        {bug && (
          <>
            {/* Code viewer */}
            <CodeViewer
              code={bug.buggyCode}
              language={bug.language}
              bugLine={bug.bugLine}
              revealed={practiceState === "revealed"}
            />

            {/* Hint button (playing state only) */}
            {practiceState === "playing" && bug.hint && (
              <div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowHint((v) => !v)}
                  className="border-yellow-500/30 text-yellow-400/80 hover:border-yellow-500/60 hover:text-yellow-300"
                >
                  {showHint ? "Hide Hint" : "Show Hint"}
                </Button>
                {showHint && (
                  <p className="mt-2 text-sm text-yellow-200/70 italic pl-1">
                    {bug.hint}
                  </p>
                )}
              </div>
            )}

            {/* Answer options */}
            <AnswerOptions
              options={bug.options}
              selectedAnswer={selectedAnswer}
              correctAnswer={correctAnswer}
              revealed={practiceState === "revealed"}
              disabled={practiceState !== "playing"}
              onAnswer={handleAnswer}
            />

            {/* Revealed state: explanation + next button */}
            {practiceState === "revealed" && (
              <div className="space-y-4">
                {/* Explanation card */}
                <div
                  className={[
                    "rounded-xl border p-4 space-y-2",
                    isCorrect === true
                      ? "border-green-500/40 bg-green-900/20"
                      : isCorrect === false
                        ? "border-red-500/40 bg-red-900/20"
                        : "border-white/10 bg-white/5",
                  ].join(" ")}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-lg">
                      {isCorrect === true ? "✓" : isCorrect === false ? "✗" : "→"}
                    </span>
                    <span
                      className={[
                        "font-semibold text-sm",
                        isCorrect === true
                          ? "text-green-300"
                          : isCorrect === false
                            ? "text-red-300"
                            : "text-white/70",
                      ].join(" ")}
                    >
                      {isCorrect === true
                        ? "Correct!"
                        : isCorrect === false
                          ? "Incorrect"
                          : "Answer revealed"}
                    </span>
                    {correctAnswer !== undefined && (
                      <span className="text-xs text-white/40 ml-1">
                        (Correct: {["A", "B", "C", "D"][correctAnswer]})
                      </span>
                    )}
                  </div>

                  {correctAnswer !== undefined && (
                    <p className="text-sm text-white/60">
                      <span className="font-medium text-white/80">Correct answer: </span>
                      {bug.options[correctAnswer]}
                    </p>
                  )}

                  <p className="text-sm text-white/70 leading-relaxed">{bug.explanation}</p>
                </div>

                {/* Sign-in nudge for guests */}
                {!session?.user && (
                  <div className="rounded-lg border border-blue-500/30 bg-blue-900/10 px-4 py-3 text-sm text-blue-300">
                    Sign in to track your progress and compete on the leaderboard.{" "}
                    <button
                      className="underline font-medium"
                      onClick={() => router.push("/login")}
                    >
                      Sign in
                    </button>
                  </div>
                )}

                {/* Next Bug button */}
                <Button
                  size="lg"
                  className="w-full sm:w-auto"
                  onClick={handleNextBug}
                >
                  Next Bug →
                </Button>
              </div>
            )}
          </>
        )}

        {/* Empty state when no bug loaded and no error */}
        {!bug && !error && practiceState === "playing" && (
          <div className="text-center py-12 text-white/40">
            <p>No bug loaded.</p>
            <Button className="mt-4" onClick={() => fetchBug(difficulty)}>
              Load a bug
            </Button>
          </div>
        )}
      </div>
    </main>
  )
}
