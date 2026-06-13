"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { CodeViewer } from "@/components/game/CodeViewer"
import { AnswerOptions } from "@/components/game/AnswerOptions"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface TeaserBug {
  bugId: string
  language: string
  difficulty: number
  buggyCode: string
  bugLine?: number
  options: [string, string, string, string]
}

export function BugTeaser() {
  const [bug, setBug] = useState<TeaserBug | null>(null)
  const [failed, setFailed] = useState(false)
  const [selected, setSelected] = useState<number | undefined>(undefined)
  const [revealed, setRevealed] = useState(false)
  const [verdict, setVerdict] = useState<{ correctAnswer: number; explanation: string } | null>(null)
  const loadedAtRef = useRef<number>(0)
  const [elapsedMs, setElapsedMs] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch("/api/bugs/random?difficulty=2")
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => {
        if (cancelled) return
        if (b?.buggyCode && Array.isArray(b.options)) {
          setBug(b as TeaserBug)
          loadedAtRef.current = Date.now()
        } else {
          setFailed(true)
        }
      })
      .catch(() => { if (!cancelled) setFailed(true) })
    return () => { cancelled = true }
  }, [])

  async function handleAnswer(index: number) {
    if (!bug || revealed) return
    setSelected(index)
    setElapsedMs(Date.now() - loadedAtRef.current)
    try {
      const res = await fetch(`/api/bugs/random?reveal=1&bugId=${bug.bugId}`)
      if (!res.ok) throw new Error("reveal failed")
      const full = (await res.json()) as { correctAnswer: number; explanation: string }
      setVerdict({ correctAnswer: full.correctAnswer, explanation: full.explanation })
    } catch {
      setVerdict(null)
    } finally {
      setRevealed(true)
    }
  }

  // Never block the landing page on API trouble
  if (failed) return null

  const wasCorrect = revealed && verdict !== null && selected === verdict.correctAnswer

  return (
    <section className="px-4 py-16 sm:px-6">
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="space-y-2 text-center">
          <h2 className="text-3xl font-bold text-white">Can you spot the bug?</h2>
          <p className="text-gray-400">No sign-up needed — this is what a round feels like.</p>
        </div>

        {!bug ? (
          <div className="h-64 animate-pulse rounded-xl border border-white/10 bg-white/5" />
        ) : (
          <>
            <CodeViewer
              code={bug.buggyCode}
              language={bug.language}
              bugLine={bug.bugLine}
              revealed={revealed}
            />
            <AnswerOptions
              options={bug.options}
              selectedAnswer={selected}
              correctAnswer={verdict?.correctAnswer}
              revealed={revealed && verdict !== null}
              disabled={revealed}
              onAnswer={handleAnswer}
            />
            {revealed && (
              <div
                className={cn(
                  "space-y-3 rounded-xl border px-5 py-4 animate-in fade-in slide-in-from-bottom-2 duration-300",
                  wasCorrect
                    ? "border-emerald-500/40 bg-emerald-500/10"
                    : "border-red-500/40 bg-red-500/10"
                )}
              >
                <p className={cn("font-semibold", wasCorrect ? "text-emerald-300" : "text-red-300")}>
                  {wasCorrect
                    ? `✓ Found it${elapsedMs != null ? ` in ${(elapsedMs / 1000).toFixed(1)}s` : ""} — now imagine doing that against a live opponent.`
                    : "✗ Not quite — your future opponents hope you stay this way."}
                </p>
                {verdict?.explanation && (
                  <p className="text-sm text-white/70">{verdict.explanation}</p>
                )}
                <Link href="/play" className={cn(buttonVariants({ size: "lg" }), "font-semibold")}>
                  Play a real match →
                </Link>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  )
}
