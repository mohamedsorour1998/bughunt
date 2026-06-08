/**
 * POST /api/cron/daily-challenge
 * Protected by CRON_SECRET header (set in Vercel project env vars).
 * Vercel Cron Job invokes this at 00:00 UTC daily.
 *
 * Vercel cron.json entry:
 *   { "path": "/api/cron/daily-challenge", "schedule": "0 0 * * *" }
 *
 * Algorithm:
 *   1. Query DynamoDB for bugs used as daily in the last 30 days
 *   2. Pick from remaining active bugs, weighted by lowest timesServed
 *   3. Write DAILY#<today> META item
 *   4. Cache bugId in Redis until midnight UTC
 */
import { NextRequest, NextResponse } from "next/server"
import { getBugIndex, getBug } from "@/lib/bugs"
import { setDailyMeta, getDailyMeta, todayUTC } from "@/lib/daily"
import { setDailyChallengeBugId } from "@/lib/redis"

export async function POST(request: NextRequest) {
  const secret = request.headers.get("x-cron-secret")
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const date = todayUTC()

  // Idempotency: if already picked for today, return early
  const existing = await getDailyMeta(date)
  if (existing) {
    return NextResponse.json({ status: "already_set", bugId: existing.bugId, date })
  }

  // Gather bugIds used in the last 30 days
  const recentlyUsed = new Set<string>()
  for (let i = 1; i <= 30; i++) {
    const d = new Date()
    d.setUTCDate(d.getUTCDate() - i)
    const pastDate = d.toISOString().slice(0, 10)
    const meta = await getDailyMeta(pastDate)
    if (meta) recentlyUsed.add(meta.bugId)
  }

  // Load the bug index
  const index = await getBugIndex()
  if (!index || index.bugIds.length === 0) {
    return NextResponse.json({ error: "No active bugs in index" }, { status: 503 })
  }

  // Candidate pool: active bugs not used in last 30 days
  const candidates = index.bugIds.filter((id) => !recentlyUsed.has(id))
  const pool = candidates.length > 0 ? candidates : index.bugIds  // fallback if all used

  // Fetch all candidates to weight by timesServed (fewer served = higher weight)
  const bugs = (await Promise.all(pool.map((id) => getBug(id)))).filter(
    (b) => b !== null && b.status === "active"
  )

  if (bugs.length === 0) {
    return NextResponse.json({ error: "No eligible bugs" }, { status: 503 })
  }

  // Weighted random: weight = 1 / (timesServed + 1)
  const weights = bugs.map((b) => 1 / (b!.timesServed + 1))
  const total = weights.reduce((s, w) => s + w, 0)
  let rnd = Math.random() * total
  let selected = bugs[bugs.length - 1]!
  for (let i = 0; i < bugs.length; i++) {
    rnd -= weights[i]
    if (rnd <= 0) {
      selected = bugs[i]!
      break
    }
  }

  // Write DynamoDB (conditional — guards against a concurrent invocation winning the race)
  let finalBugId = selected.bugId
  const wrote = await setDailyMeta(date, selected.bugId)
  if (!wrote) {
    // Another invocation already seeded today's challenge — defer to its choice
    // so DynamoDB and Redis never diverge.
    const winner = await getDailyMeta(date)
    finalBugId = winner?.bugId ?? selected.bugId
  }

  try {
    await setDailyChallengeBugId(date, finalBugId)
  } catch {
    // Redis failure is non-fatal — DynamoDB is the source of truth
  }

  return NextResponse.json({
    status: wrote ? "ok" : "already_set",
    date,
    bugId: finalBugId,
  })
}
