"use client"

import { useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { Bug } from "@/lib/bugs"

const LANGUAGES = ["Python", "JavaScript", "TypeScript", "Go", "SQL", "Bash"]
const DIFFICULTIES = [1, 2, 3, 4, 5] as const

type GeneratedBug = {
  bugId: string
  language: string
  category: string
  difficulty: 1 | 2 | 3 | 4 | 5
  buggyCode: string
  correctCode: string
  bugLine: number
  options: [string, string, string, string]
  correctAnswer: 0 | 1 | 2 | 3
  explanation: string
  hint: string
  status: "pending_review" | "active"
}

// ---------------------------------------------------------------------------
// Generate Bug Section
// ---------------------------------------------------------------------------
function GenerateBugSection() {
  const [language, setLanguage] = useState("Python")
  const [category, setCategory] = useState("")
  const [difficulty, setDifficulty] = useState<1 | 2 | 3 | 4 | 5>(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [generatedBug, setGeneratedBug] = useState<GeneratedBug | null>(null)
  const [approving, setApproving] = useState(false)
  const [approved, setApproved] = useState(false)

  async function handleGenerate() {
    setLoading(true)
    setError(null)
    setGeneratedBug(null)
    setApproved(false)
    try {
      const res = await fetch("/api/admin/bugs/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language, category, difficulty }),
      })
      if (!res.ok) {
        const data = await res.json()
        setError(data.error ?? "Generation failed")
        return
      }
      const bug = await res.json()
      setGeneratedBug(bug)
    } catch {
      setError("Network error")
    } finally {
      setLoading(false)
    }
  }

  async function handleApprove() {
    if (!generatedBug) return
    setApproving(true)
    try {
      const res = await fetch(`/api/admin/bugs/${generatedBug.bugId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve" }),
      })
      if (res.ok) {
        setApproved(true)
        setGeneratedBug(null)
      } else {
        const data = await res.json()
        setError(data.error ?? "Approve failed")
      }
    } catch {
      setError("Network error")
    } finally {
      setApproving(false)
    }
  }

  return (
    <Card className="bg-gray-900 border-gray-800">
      <CardHeader>
        <CardTitle className="text-white text-lg">Generate Bug via AI (Bedrock Nova)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="space-y-1">
            <Label className="text-gray-300">Language</Label>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="w-full rounded-md border border-gray-700 bg-gray-800 text-white px-3 py-2 text-sm"
            >
              {LANGUAGES.map((l) => (
                <option key={l} value={l}>{l}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-gray-300">Category</Label>
            <Input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="e.g. off-by-one, null handling"
              className="bg-gray-800 border-gray-700 text-white"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-gray-300">Difficulty (1-5)</Label>
            <select
              value={difficulty}
              onChange={(e) => setDifficulty(Number(e.target.value) as 1 | 2 | 3 | 4 | 5)}
              className="w-full rounded-md border border-gray-700 bg-gray-800 text-white px-3 py-2 text-sm"
            >
              {DIFFICULTIES.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>
        </div>

        <Button
          onClick={handleGenerate}
          disabled={loading || !category.trim()}
          className="bg-green-600 hover:bg-green-700 text-white"
        >
          {loading ? "Generating..." : "Generate"}
        </Button>

        {error && <p className="text-red-400 text-sm">{error}</p>}
        {approved && <p className="text-green-400 text-sm">Bug approved and saved!</p>}

        {generatedBug && (
          <div className="space-y-3 border border-gray-700 rounded-md p-4">
            <div>
              <p className="text-gray-400 text-xs mb-1">Buggy Code (bug on line {generatedBug.bugLine}):</p>
              <pre className="bg-gray-800 rounded p-3 text-green-300 text-xs overflow-auto max-h-48">
                {generatedBug.buggyCode}
              </pre>
            </div>
            <div>
              <p className="text-gray-400 text-xs mb-1">Options:</p>
              <ul className="space-y-1">
                {generatedBug.options.map((opt, i) => (
                  <li key={i} className={`text-sm ${i === generatedBug.correctAnswer ? "text-green-400 font-semibold" : "text-gray-300"}`}>
                    {i === generatedBug.correctAnswer ? "✓ " : "  "}{opt}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-gray-400 text-xs mb-1">Explanation:</p>
              <p className="text-gray-200 text-sm">{generatedBug.explanation}</p>
            </div>
            <div>
              <p className="text-gray-400 text-xs mb-1">Hint:</p>
              <p className="text-gray-200 text-sm italic">{generatedBug.hint}</p>
            </div>
            <div className="flex gap-2">
              <Button
                onClick={handleApprove}
                disabled={approving}
                className="bg-green-600 hover:bg-green-700 text-white text-sm"
              >
                {approving ? "Saving..." : "Approve & Save"}
              </Button>
              <Button
                onClick={handleGenerate}
                disabled={loading}
                variant="outline"
                className="border-gray-600 text-gray-300 hover:bg-gray-800 text-sm"
              >
                Regenerate
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Pending Review Section
// ---------------------------------------------------------------------------
function PendingReviewSection() {
  const [bugs, setBugs] = useState<Bug[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  async function fetchPending() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/admin/bugs")
      if (!res.ok) {
        setError("Failed to load pending bugs")
        return
      }
      const data = await res.json()
      setBugs(data)
    } catch {
      setError("Network error")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchPending() }, [])

  async function handleAction(bugId: string, action: "approve" | "reject") {
    setActionLoading(bugId + action)
    try {
      const res = await fetch(`/api/admin/bugs/${bugId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      })
      if (res.ok) {
        setBugs((prev) => prev.filter((b) => b.bugId !== bugId))
      }
    } catch {
      // ignore
    } finally {
      setActionLoading(null)
    }
  }

  return (
    <Card className="bg-gray-900 border-gray-800">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-white text-lg">Pending Review ({bugs.length})</CardTitle>
        <Button
          onClick={fetchPending}
          variant="outline"
          className="border-gray-600 text-gray-300 hover:bg-gray-800 text-xs px-2 py-1 h-auto"
        >
          Refresh
        </Button>
      </CardHeader>
      <CardContent>
        {loading && <p className="text-gray-400 text-sm">Loading...</p>}
        {error && <p className="text-red-400 text-sm">{error}</p>}
        {!loading && bugs.length === 0 && <p className="text-gray-500 text-sm">No bugs pending review.</p>}
        <div className="space-y-3">
          {bugs.map((bug) => (
            <div key={bug.bugId} className="border border-gray-700 rounded-md p-3 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-green-400 text-sm font-semibold">{bug.language}</span>
                <span className="text-gray-400 text-xs">{bug.category}</span>
                <span className="text-yellow-400 text-xs">Difficulty: {bug.difficulty}</span>
              </div>
              <pre className="bg-gray-800 rounded p-2 text-green-300 text-xs overflow-auto max-h-32">
                {bug.buggyCode.slice(0, 300)}{bug.buggyCode.length > 300 ? "..." : ""}
              </pre>
              <p className="text-gray-300 text-xs">{bug.explanation}</p>
              <div className="flex gap-2">
                <Button
                  onClick={() => handleAction(bug.bugId, "approve")}
                  disabled={actionLoading === bug.bugId + "approve"}
                  className="bg-green-600 hover:bg-green-700 text-white text-xs px-3 py-1 h-auto"
                >
                  {actionLoading === bug.bugId + "approve" ? "..." : "Approve"}
                </Button>
                <Button
                  onClick={() => handleAction(bug.bugId, "reject")}
                  disabled={actionLoading === bug.bugId + "reject"}
                  variant="outline"
                  className="border-red-700 text-red-400 hover:bg-red-900/20 text-xs px-3 py-1 h-auto"
                >
                  {actionLoading === bug.bugId + "reject" ? "..." : "Reject"}
                </Button>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Manual Create Section
// ---------------------------------------------------------------------------
function CreateBugSection() {
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [form, setForm] = useState({
    language: "Python",
    category: "",
    difficulty: "1",
    buggyCode: "",
    correctCode: "",
    bugLine: "1",
    option0: "",
    option1: "",
    option2: "",
    option3: "",
    correctAnswer: "0",
    explanation: "",
    hint: "",
  })

  function update(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  async function handleSubmit() {
    setSubmitting(true)
    setError(null)
    setSuccess(false)
    try {
      const res = await fetch("/api/admin/bugs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          language: form.language,
          category: form.category,
          difficulty: parseInt(form.difficulty),
          buggyCode: form.buggyCode,
          correctCode: form.correctCode,
          bugLine: parseInt(form.bugLine),
          options: [form.option0, form.option1, form.option2, form.option3],
          correctAnswer: parseInt(form.correctAnswer),
          explanation: form.explanation,
          hint: form.hint,
        }),
      })
      if (res.ok) {
        setSuccess(true)
        setForm({
          language: "Python", category: "", difficulty: "1",
          buggyCode: "", correctCode: "", bugLine: "1",
          option0: "", option1: "", option2: "", option3: "",
          correctAnswer: "0", explanation: "", hint: "",
        })
      } else {
        const data = await res.json()
        setError(data.error ?? "Failed to create bug")
      }
    } catch {
      setError("Network error")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card className="bg-gray-900 border-gray-800">
      <CardHeader>
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 text-white text-lg font-semibold text-left"
        >
          <span>{open ? "▼" : "▶"}</span>
          <CardTitle className="text-white text-lg">Create Bug Manually</CardTitle>
        </button>
      </CardHeader>
      {open && (
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-1">
              <Label className="text-gray-300">Language</Label>
              <select value={form.language} onChange={(e) => update("language", e.target.value)}
                className="w-full rounded-md border border-gray-700 bg-gray-800 text-white px-3 py-2 text-sm">
                {LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-gray-300">Category</Label>
              <Input value={form.category} onChange={(e) => update("category", e.target.value)}
                placeholder="e.g. off-by-one" className="bg-gray-800 border-gray-700 text-white" />
            </div>
            <div className="space-y-1">
              <Label className="text-gray-300">Difficulty</Label>
              <select value={form.difficulty} onChange={(e) => update("difficulty", e.target.value)}
                className="w-full rounded-md border border-gray-700 bg-gray-800 text-white px-3 py-2 text-sm">
                {DIFFICULTIES.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label className="text-gray-300">Buggy Code</Label>
              <textarea value={form.buggyCode} onChange={(e) => update("buggyCode", e.target.value)}
                rows={6} placeholder="Code with one bug..."
                className="w-full rounded-md border border-gray-700 bg-gray-800 text-green-300 font-mono px-3 py-2 text-xs resize-y" />
            </div>
            <div className="space-y-1">
              <Label className="text-gray-300">Correct Code</Label>
              <textarea value={form.correctCode} onChange={(e) => update("correctCode", e.target.value)}
                rows={6} placeholder="Fixed code..."
                className="w-full rounded-md border border-gray-700 bg-gray-800 text-green-300 font-mono px-3 py-2 text-xs resize-y" />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label className="text-gray-300">Bug Line (1-indexed)</Label>
              <Input type="number" value={form.bugLine} onChange={(e) => update("bugLine", e.target.value)}
                min={1} className="bg-gray-800 border-gray-700 text-white" />
            </div>
            <div className="space-y-1">
              <Label className="text-gray-300">Correct Answer Index (0-3)</Label>
              <select value={form.correctAnswer} onChange={(e) => update("correctAnswer", e.target.value)}
                className="w-full rounded-md border border-gray-700 bg-gray-800 text-white px-3 py-2 text-sm">
                <option value="0">0</option>
                <option value="1">1</option>
                <option value="2">2</option>
                <option value="3">3</option>
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-gray-300">Options (A, B, C, D)</Label>
            {[0, 1, 2, 3].map((i) => (
              <Input key={i}
                value={form[`option${i}` as keyof typeof form]}
                onChange={(e) => update(`option${i}`, e.target.value)}
                placeholder={`Option ${i}`}
                className="bg-gray-800 border-gray-700 text-white" />
            ))}
          </div>

          <div className="space-y-1">
            <Label className="text-gray-300">Explanation</Label>
            <textarea value={form.explanation} onChange={(e) => update("explanation", e.target.value)}
              rows={3} placeholder="2-3 sentences explaining the bug..."
              className="w-full rounded-md border border-gray-700 bg-gray-800 text-white px-3 py-2 text-sm resize-y" />
          </div>

          <div className="space-y-1">
            <Label className="text-gray-300">Hint</Label>
            <Input value={form.hint} onChange={(e) => update("hint", e.target.value)}
              placeholder="One sentence hint..." className="bg-gray-800 border-gray-700 text-white" />
          </div>

          {error && <p className="text-red-400 text-sm">{error}</p>}
          {success && <p className="text-green-400 text-sm">Bug created and set to active!</p>}

          <Button onClick={handleSubmit} disabled={submitting}
            className="bg-blue-600 hover:bg-blue-700 text-white">
            {submitting ? "Saving..." : "Create Bug"}
          </Button>
        </CardContent>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Admin Page
// ---------------------------------------------------------------------------
export default function AdminPage() {
  const { status } = useSession()
  const router = useRouter()
  const [isAdmin, setIsAdmin] = useState(false)

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/")
      return
    }
    if (status === "authenticated") {
      fetch("/api/admin/check")
        .then(r => r.json())
        .then(data => {
          if (!data.isAdmin) router.push("/")
          else setIsAdmin(true)
        })
        .catch(() => router.push("/"))
    }
  }, [status, router])

  if (status === "loading" || !isAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-950">
        <p className="text-gray-400">Loading...</p>
      </div>
    )
  }

  return (
    <main className="min-h-screen bg-gray-950 py-8 px-4">
      <div className="max-w-4xl mx-auto space-y-8">
        <div>
          <h1 className="text-3xl font-bold text-white">Admin Dashboard</h1>
          <p className="text-gray-400 text-sm mt-1">Manage AI-generated and manual bug submissions</p>
        </div>
        <GenerateBugSection />
        <PendingReviewSection />
        <CreateBugSection />
      </div>
    </main>
  )
}
