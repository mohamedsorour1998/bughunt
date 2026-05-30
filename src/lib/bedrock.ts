import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime"

const client = new BedrockRuntimeClient({ region: process.env.AWS_REGION ?? "us-east-1" })

export async function generateBug(
  language: string,
  category: string,
  difficulty: 1 | 2 | 3 | 4 | 5
): Promise<{
  buggyCode: string
  correctCode: string
  bugLine: number
  options: [string, string, string, string]
  correctAnswer: 0 | 1 | 2 | 3
  explanation: string
  hint: string
} | null> {
  const prompt = `You are a programming bug generator for a competitive debugging game. Generate a realistic, tricky bug in ${language} code.

Requirements:
- Difficulty level: ${difficulty}/5 (1=beginner, 5=expert)
- Category: ${category}
- The bug should look plausible — it's the kind of mistake a real developer would make
- buggyCode: a short function (5-20 lines) with exactly ONE bug
- correctCode: the same code with the bug fixed
- bugLine: the 1-indexed line number where the bug is
- options: 4 multiple-choice strings describing what the bug might be (only one is correct)
- correctAnswer: index (0-3) of the correct option
- explanation: 2-3 sentences explaining the bug
- hint: one sentence hint without giving away the answer

Respond with ONLY valid JSON matching this schema:
{"buggyCode":"...","correctCode":"...","bugLine":N,"options":["...","...","...","..."],"correctAnswer":N,"explanation":"...","hint":"..."}`

  try {
    const body = JSON.stringify({
      messages: [{ role: "user", content: prompt }],
      inferenceConfig: { maxNewTokens: 1024, temperature: 0.7 },
    })

    const command = new InvokeModelCommand({
      modelId: "amazon.nova-lite-v1:0",
      contentType: "application/json",
      accept: "application/json",
      body,
    })

    const response = await client.send(command)
    const raw = new TextDecoder().decode(response.body)
    const parsed = JSON.parse(raw)

    // Nova response format: output.message.content[0].text
    const text: string =
      parsed?.output?.message?.content?.[0]?.text ??
      parsed?.content?.[0]?.text ??
      ""

    if (!text) return null

    // Extract JSON from the response (strip any surrounding markdown fences)
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return null

    const bug = JSON.parse(jsonMatch[0])

    // Validate required fields
    if (
      typeof bug.buggyCode !== "string" ||
      typeof bug.correctCode !== "string" ||
      typeof bug.bugLine !== "number" ||
      !Array.isArray(bug.options) ||
      bug.options.length !== 4 ||
      typeof bug.correctAnswer !== "number" ||
      bug.correctAnswer < 0 ||
      bug.correctAnswer > 3 ||
      typeof bug.explanation !== "string" ||
      typeof bug.hint !== "string"
    ) {
      return null
    }

    return {
      buggyCode: bug.buggyCode,
      correctCode: bug.correctCode,
      bugLine: bug.bugLine,
      options: bug.options as [string, string, string, string],
      correctAnswer: bug.correctAnswer as 0 | 1 | 2 | 3,
      explanation: bug.explanation,
      hint: bug.hint,
    }
  } catch {
    return null
  }
}
