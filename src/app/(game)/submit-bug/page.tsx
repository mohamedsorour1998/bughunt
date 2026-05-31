"use client"

import { useState } from "react"
import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { CodeViewer } from "@/components/game/CodeViewer"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

const LANGUAGES = [
  "javascript",
  "typescript",
  "python",
  "java",
  "go",
  "rust",
  "cpp",
  "c",
  "ruby",
  "php",
]

const DIFFICULTIES = [1, 2, 3, 4, 5] as const

export default function SubmitBugPage() {
  const { status } = useSession()
  const router = useRouter()

  const [language, setLanguage] = useState("javascript")
  const [category, setCategory] = useState("")
  const [difficulty, setDifficulty] = useState<1 | 2 | 3 | 4 | 5>(2)
  const [buggyCode, setBuggyCode] = useState("")
  const [correctCode, setCorrectCode] = useState("")
  const [bugLine, setBugLine] = useState(1)
  const [options, setOptions] = useState(["", "", "", ""])
  const [correctAnswer, setCorrectAnswer] = useState<0 | 1 | 2 | 3>(0)
  const [explanation, setExplanation] = useState("")
  const [hint, setHint] = useState("")

  const [submitting, setSubmitting] = useState(false)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  if (status === "unauthenticated") {
    router.push("/login")
    return null
  }

  function updateOption(idx: number, value: string) {
    const next = [...options]
    next[idx] = value
    setOptions(next)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setSuccessMsg(null)
    setErrorMsg(null)

    try {
      const res = await fetch("/api/bugs/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          language,
          category,
          difficulty,
          buggyCode,
          correctCode,
          bugLine,
          options,
          correctAnswer,
          explanation,
          hint,
        }),
      })

      if (res.status === 429) {
        setErrorMsg("You've reached the daily limit (3 submissions/day)")
        return
      }

      if (res.status === 422) {
        const data = await res.json()
        setErrorMsg(`Your submission was rejected: ${data.feedback}`)
        return
      }

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setErrorMsg(data.error ?? "Submission failed. Please try again.")
        return
      }

      setSuccessMsg("Thank you! Your bug is under review.")
      toast.success("Bug submitted successfully!")
    } catch {
      setErrorMsg("Network error. Please try again.")
    } finally {
      setSubmitting(false)
    }
  }

  const inputClass =
    "w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-emerald-500/60 focus:outline-none focus:ring-1 focus:ring-emerald-500/40"
  const selectClass =
    "w-full rounded-md border border-white/10 bg-gray-900 px-3 py-2 text-sm text-white focus:border-emerald-500/60 focus:outline-none"
  const textareaClass =
    "w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-emerald-500/60 focus:outline-none focus:ring-1 focus:ring-emerald-500/40 font-mono resize-y"

  if (successMsg) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-4">
        <div className="rounded-xl border border-green-500/40 bg-green-900/20 p-8 text-center max-w-md">
          <p className="text-green-400 text-lg font-semibold mb-4">{successMsg}</p>
          <p className="text-white/60 text-sm mb-6">
            Our team will review your submission and approve it if it meets the quality
            standards.
          </p>
          <div className="flex gap-3 justify-center">
            <Button onClick={() => router.push("/practice")}>Play Practice</Button>
            <Button
              variant="outline"
              onClick={() => {
                setSuccessMsg(null)
                setBuggyCode("")
                setCorrectCode("")
                setCategory("")
                setOptions(["", "", "", ""])
                setExplanation("")
                setHint("")
              }}
            >
              Submit Another
            </Button>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-3xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
      <div>
        <h1 className="text-2xl font-bold text-white">Submit a Bug</h1>
        <p className="text-sm text-white/50 mt-1">
          Share a tricky bug for others to find. Submissions are reviewed before going live.
          Max 3 per day.
        </p>
      </div>

      {errorMsg && (
        <div className="rounded-lg border border-red-500/40 bg-red-900/20 px-4 py-3 text-sm text-red-400">
          {errorMsg}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Language + Category + Difficulty */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label className="text-white/70">Language</Label>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className={selectClass}
            >
              {LANGUAGES.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-white/70">Category</Label>
            <Input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="e.g. off-by-one, null-check"
              required
              className={inputClass}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-white/70">Difficulty (1–5)</Label>
            <select
              value={difficulty}
              onChange={(e) =>
                setDifficulty(parseInt(e.target.value) as 1 | 2 | 3 | 4 | 5)
              }
              className={selectClass}
            >
              {DIFFICULTIES.map((d) => (
                <option key={d} value={d}>
                  {d} — {["Beginner", "Easy", "Medium", "Hard", "Expert"][d - 1]}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Buggy Code */}
        <div className="space-y-1.5">
          <Label className="text-white/70">Buggy Code</Label>
          <textarea
            value={buggyCode}
            onChange={(e) => setBuggyCode(e.target.value)}
            placeholder="Paste the code with the bug here (5-20 lines recommended)"
            rows={10}
            required
            className={textareaClass}
          />
          {buggyCode && (
            <div className="mt-2">
              <p className="text-xs text-white/40 mb-1">Preview:</p>
              <CodeViewer
                code={buggyCode}
                language={language}
                bugLine={bugLine}
                revealed={false}
              />
            </div>
          )}
        </div>

        {/* Correct Code */}
        <div className="space-y-1.5">
          <Label className="text-white/70">
            Correct Code{" "}
            <span className="text-white/30 font-normal">(optional — fixed version)</span>
          </Label>
          <textarea
            value={correctCode}
            onChange={(e) => setCorrectCode(e.target.value)}
            placeholder="Paste the fixed version of the code (optional)"
            rows={6}
            className={textareaClass}
          />
        </div>

        {/* Bug Line */}
        <div className="space-y-1.5 max-w-xs">
          <Label className="text-white/70">Bug Line Number</Label>
          <Input
            type="number"
            min={1}
            value={bugLine}
            onChange={(e) => setBugLine(parseInt(e.target.value) || 1)}
            required
            className={inputClass}
          />
        </div>

        {/* Options */}
        <div className="space-y-3">
          <Label className="text-white/70">Answer Options (4 required)</Label>
          <p className="text-xs text-white/30">
            Provide 4 plausible answers. Select the correct one with the radio button.
          </p>
          {options.map((opt, idx) => (
            <div key={idx} className="flex items-center gap-3">
              <input
                type="radio"
                name="correctAnswer"
                value={idx}
                checked={correctAnswer === idx}
                onChange={() => setCorrectAnswer(idx as 0 | 1 | 2 | 3)}
                className="accent-emerald-500 h-4 w-4 shrink-0"
              />
              <Input
                value={opt}
                onChange={(e) => updateOption(idx, e.target.value)}
                placeholder={`Option ${String.fromCharCode(65 + idx)}`}
                required
                className={cn(
                  inputClass,
                  correctAnswer === idx ? "border-emerald-500/40" : ""
                )}
              />
              {correctAnswer === idx && (
                <span className="text-xs text-emerald-400 shrink-0">✓ Correct</span>
              )}
            </div>
          ))}
        </div>

        {/* Explanation */}
        <div className="space-y-1.5">
          <Label className="text-white/70">Explanation</Label>
          <textarea
            value={explanation}
            onChange={(e) => setExplanation(e.target.value)}
            placeholder="Explain what the bug is and why the correct answer fixes it"
            rows={4}
            required
            className={textareaClass}
          />
        </div>

        {/* Hint */}
        <div className="space-y-1.5">
          <Label className="text-white/70">
            Hint{" "}
            <span className="text-white/30 font-normal">(optional)</span>
          </Label>
          <Input
            value={hint}
            onChange={(e) => setHint(e.target.value)}
            placeholder="A subtle hint for players who get stuck"
            className={inputClass}
          />
        </div>

        <Button type="submit" size="lg" className="w-full" disabled={submitting}>
          {submitting ? "Submitting..." : "Submit Bug for Review"}
        </Button>
      </form>
    </main>
  )
}
