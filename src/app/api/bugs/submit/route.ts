import { NextRequest, NextResponse } from "next/server"
import { safeAuth, getTestSession, getTestSessionFromCookies } from "@/lib/test-auth"
import { createBug } from "@/lib/bugs"
import { rateLimitCheck } from "@/lib/redis"

export async function POST(req: NextRequest) {
  const session =
    (await safeAuth()) ??
    getTestSession(req) ??
    (await getTestSessionFromCookies())
  if (!session?.user?.id)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const userId = session.user.id

  // Rate limit: 3 submissions per day
  let allowed = true
  try {
    allowed = await rateLimitCheck(userId, "bug_submit", 3, 86400)
  } catch {
    // Redis unavailable — allow through
  }
  if (!allowed)
    return NextResponse.json(
      { error: "Daily submission limit reached (3/day)" },
      { status: 429 }
    )

  let body: {
    language?: string
    category?: string
    difficulty?: number
    buggyCode?: string
    correctCode?: string
    bugLine?: number
    options?: [string, string, string, string]
    correctAnswer?: number
    explanation?: string
    hint?: string
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  }

  const {
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
  } = body

  // Validate required fields
  if (
    !language ||
    !category ||
    !difficulty ||
    !buggyCode ||
    !options ||
    correctAnswer === undefined
  ) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
  }

  // Validate difficulty range
  if (difficulty < 1 || difficulty > 5) {
    return NextResponse.json(
      { error: "difficulty must be between 1 and 5" },
      { status: 400 }
    )
  }

  // Validate correctAnswer range
  if (correctAnswer < 0 || correctAnswer > 3) {
    return NextResponse.json(
      { error: "correctAnswer must be 0-3" },
      { status: 400 }
    )
  }

  // Validate options length
  if (!Array.isArray(options) || options.length !== 4) {
    return NextResponse.json(
      { error: "options must be an array of 4 strings" },
      { status: 400 }
    )
  }

  // Bedrock quality check — score 0-1, reject below 0.7
  let qualityScore = 1.0
  let qualityFeedback = "Accepted"
  try {
    const { BedrockRuntimeClient, InvokeModelCommand } = await import(
      "@aws-sdk/client-bedrock-runtime"
    )
    const client = new BedrockRuntimeClient({
      region: process.env.AWS_REGION ?? "us-east-1",
    })
    const prompt = `Rate this bug submission for a debugging game (0.0-1.0):
Language: ${language}, Category: ${category}
Code: ${buggyCode.slice(0, 300)}
Correct option: ${options[correctAnswer]}
Explanation: ${explanation}
Is it: real/non-trivial (not typo), plausible distractors, accurate explanation, 5-20 lines?
Return JSON only: {"score":0.0-1.0,"feedback":"one sentence"}`

    const cmd = new InvokeModelCommand({
      modelId: "amazon.nova-lite-v1:0",
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify({
        messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
      }),
    })
    const response = await client.send(cmd)
    const text =
      JSON.parse(new TextDecoder().decode(response.body))?.output?.message
        ?.content?.[0]?.text ?? "{}"
    const parsed = JSON.parse(text.replace(/```json|```/g, "").trim())
    qualityScore = parsed.score ?? 1.0
    qualityFeedback = parsed.feedback ?? "Accepted"
  } catch {
    // If Bedrock fails, proceed with default score
  }

  if (qualityScore < 0.7) {
    return NextResponse.json(
      {
        rejected: true,
        feedback: qualityFeedback,
        score: qualityScore,
      },
      { status: 422 }
    )
  }

  // Create bug with pending_review status
  const bug = await createBug({
    language,
    category,
    difficulty: difficulty as 1 | 2 | 3 | 4 | 5,
    buggyCode,
    correctCode: correctCode ?? buggyCode,
    bugLine: bugLine ?? 1,
    options: options as [string, string, string, string],
    correctAnswer: correctAnswer as 0 | 1 | 2 | 3,
    explanation: explanation ?? "",
    hint: hint ?? "",
    source: `community:${userId}`,
    status: "pending_review",
  })

  return NextResponse.json({ ok: true, bugId: bug.bugId, status: "pending_review" })
}
