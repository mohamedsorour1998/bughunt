/**
 * Daily Challenge data layer.
 *
 * DynamoDB entities used:
 *
 * Daily meta (written by cron):
 *   PK: DAILY#<YYYY-MM-DD>  SK: META
 *   Fields: bugId, date, totalPlayers, avgTimeMs
 *
 * Daily submission (written per user on submit):
 *   PK: DAILY#<YYYY-MM-DD>  SK: SUBMISSION#<userId>
 *   Fields: userId, correct, timeElapsedMs, submittedAt
 *   expiresAt: midnight UTC + 30 days (epoch seconds)
 *
 * Daily leaderboard entry (correct answers only, sorted by time ascending):
 *   PK: LEADERBOARD#DAILY#<YYYY-MM-DD>  SK: RANK#<paddedTime>#<userId>
 *   Fields: userId, displayName, timeElapsedMs, correct
 */
import {
  getItem,
  putItem,
  putItemIfNotExists,
  queryItems,
  ddb,
  TABLE_NAME,
} from "@/lib/dynamodb"
import { getUser, updateUser } from "@/lib/users"
import { getBug } from "@/lib/bugs"
import { UpdateCommand } from "@aws-sdk/lib-dynamodb"
import type { Bug } from "@/lib/bugs"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DailyMeta = {
  date: string      // "YYYY-MM-DD"
  bugId: string
  totalPlayers: number
  avgTimeMs: number
}

export type DailySubmission = {
  userId: string
  correct: boolean
  timeElapsedMs: number
  submittedAt: number
}

export type DailyLeaderboardEntry = {
  rank: number
  userId: string
  displayName: string
  timeElapsedMs: number
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** "YYYY-MM-DD" for today in UTC. */
export function todayUTC(): string {
  return new Date().toISOString().slice(0, 10)
}

/** Alias for todayUTC — used by cron routes and the task description. */
export function getTodayDateStr(): string {
  return todayUTC()
}

/** Zero-pad a number to 15 chars for lexicographic sort (covers ms up to ~317 years). */
function padTime(ms: number): string {
  return String(ms).padStart(15, "0")
}

/** epoch seconds for midnight UTC + offsetDays. */
function midnightUTCEpoch(offsetDays = 0): number {
  const now = new Date()
  const midnight = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + 1 + offsetDays
    )
  )
  return Math.floor(midnight.getTime() / 1000)
}

// ---------------------------------------------------------------------------
// getDailyMeta
// ---------------------------------------------------------------------------

export async function getDailyMeta(date: string): Promise<DailyMeta | null> {
  const item = await getItem(`DAILY#${date}`, "META")
  if (!item) return null
  return {
    date: item.date as string,
    bugId: item.bugId as string,
    totalPlayers: (item.totalPlayers as number) ?? 0,
    avgTimeMs: (item.avgTimeMs as number) ?? 0,
  }
}

// ---------------------------------------------------------------------------
// setDailyMeta — called by cron
// ---------------------------------------------------------------------------

/**
 * Conditionally seed today's daily meta — only writes if no META item exists yet.
 * Returns true when this call won the race and wrote the item, false when another
 * concurrent invocation already seeded it (caller should re-fetch via getDailyMeta).
 */
export async function setDailyMeta(date: string, bugId: string): Promise<boolean> {
  return putItemIfNotExists({
    pk: `DAILY#${date}`,
    sk: "META",
    date,
    bugId,
    totalPlayers: 0,
    avgTimeMs: 0,
    expiresAt: midnightUTCEpoch(30),
  })
}

// ---------------------------------------------------------------------------
// getDailyChallenge — full payload for GET /api/daily
// ---------------------------------------------------------------------------

export type DailyChallengePayload = {
  date: string
  bug: Omit<Bug, "correctAnswer" | "correctCode"> & { bugId: string }
  submission: DailySubmission | null     // null if user hasn't submitted yet
  leaderboard: DailyLeaderboardEntry[]   // top 10
  totalPlayers: number
}

export async function getDailyChallenge(
  date: string,
  userId: string
): Promise<DailyChallengePayload | null> {
  const meta = await getDailyMeta(date)
  if (!meta) return null

  const bug = await getBug(meta.bugId)
  if (!bug) return null

  const [submissionItem, leaderboard] = await Promise.all([
    getItem(`DAILY#${date}`, `SUBMISSION#${userId}`),
    getDailyLeaderboard(date, 10),
  ])

  const submission: DailySubmission | null = submissionItem
    ? {
        userId: submissionItem.userId as string,
        correct: submissionItem.correct as boolean,
        timeElapsedMs: submissionItem.timeElapsedMs as number,
        submittedAt: submissionItem.submittedAt as number,
      }
    : null

  // Strip correctAnswer and correctCode before user has submitted
  const { correctAnswer, correctCode, ...bugWithoutAnswer } = bug

  return {
    date,
    bug: submission
      ? { ...bug }                         // reveal full bug after submission
      : { ...bugWithoutAnswer, bugId: bug.bugId } as DailyChallengePayload["bug"],
    submission,
    leaderboard,
    totalPlayers: meta.totalPlayers,
  }
}

// ---------------------------------------------------------------------------
// submitDailyAnswer
// ---------------------------------------------------------------------------

export type SubmitDailyResult =
  | { ok: true; correct: boolean; correctAnswer: number; explanation: string; rank: number | null }
  | { ok: false; error: "already_submitted" | "daily_not_found" | "bug_not_found" }

export async function submitDailyAnswer(
  date: string,
  userId: string,
  answer: number,
  timeElapsedMs: number
): Promise<SubmitDailyResult> {
  const meta = await getDailyMeta(date)
  if (!meta) return { ok: false, error: "daily_not_found" }

  const bug = await getBug(meta.bugId)
  if (!bug) return { ok: false, error: "bug_not_found" }

  const correct = answer === bug.correctAnswer
  const submittedAt = Date.now()

  // Idempotency: putItemIfNotExists returns false if already submitted
  const written = await putItemIfNotExists({
    pk: `DAILY#${date}`,
    sk: `SUBMISSION#${userId}`,
    userId,
    correct,
    timeElapsedMs,
    submittedAt,
    answer,
    expiresAt: midnightUTCEpoch(30),
  })

  if (!written) return { ok: false, error: "already_submitted" }

  // Write leaderboard entry (correct answers only, sorted by time)
  let rank: number | null = null
  if (correct) {
    const user = await getUser(userId)
    await putItem({
      pk: `LEADERBOARD#DAILY#${date}`,
      sk: `RANK#${padTime(timeElapsedMs)}#${userId}`,
      userId,
      displayName: user?.displayName ?? "Unknown",
      timeElapsedMs,
      correct: true,
      submittedAt,
      expiresAt: midnightUTCEpoch(30),
    })
    // Compute rank by counting entries with faster time.
    // ConsistentRead avoids missing the sibling entry we (or a concurrent
    // submitter) just wrote moments ago under a submission burst.
    const { items } = await queryItems(
      "pk = :pk AND sk < :sk",
      {
        ":pk": `LEADERBOARD#DAILY#${date}`,
        ":sk": `RANK#${padTime(timeElapsedMs)}#`,
      },
      { consistentRead: true }
    )
    rank = items.length + 1
  }

  // Atomically increment totalPlayers
  await ddb.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { pk: `DAILY#${date}`, sk: "META" },
      UpdateExpression: "SET #tp = if_not_exists(#tp, :zero) + :one",
      ExpressionAttributeNames: { "#tp": "totalPlayers" },
      ExpressionAttributeValues: { ":zero": 0, ":one": 1 },
    })
  )

  // Update daily streak on user profile
  const userProfile = await getUser(userId)
  if (userProfile) {
    const yesterday = new Date()
    yesterday.setUTCDate(yesterday.getUTCDate() - 1)
    const yesterdayStr = yesterday.toISOString().slice(0, 10)

    const newStreak =
      userProfile.lastDailyDate === yesterdayStr
        ? userProfile.dailyStreak + 1
        : userProfile.lastDailyDate === date
        ? userProfile.dailyStreak     // already counted today (shouldn't happen due to idempotency guard above)
        : 1

    await updateUser(userId, {
      lastDailyDate: date,
      dailyStreak: newStreak,
    })
  }

  return {
    ok: true,
    correct,
    correctAnswer: bug.correctAnswer,
    explanation: bug.explanation,
    rank,
  }
}

// ---------------------------------------------------------------------------
// getDailyLeaderboard
// ---------------------------------------------------------------------------

export async function getDailyLeaderboard(
  date: string,
  limit = 10
): Promise<DailyLeaderboardEntry[]> {
  const { items } = await queryItems(
    "pk = :pk AND begins_with(sk, :prefix)",
    {
      ":pk": `LEADERBOARD#DAILY#${date}`,
      ":prefix": "RANK#",
    },
    { limit, scanIndexForward: true }
  )

  return items.map((item, index) => ({
    rank: index + 1,
    userId: item.userId as string,
    displayName: (item.displayName as string) ?? "Unknown",
    timeElapsedMs: item.timeElapsedMs as number,
  }))
}

// ---------------------------------------------------------------------------
// getUserDailySubmission — returns user's submission for a given date or null
// ---------------------------------------------------------------------------

export async function getUserDailySubmission(
  userId: string,
  date: string
): Promise<{ answer: number; correct: boolean; timeElapsedMs: number; submittedAt: number } | null> {
  const item = await getItem(`DAILY#${date}`, `SUBMISSION#${userId}`)
  if (!item) return null
  return {
    answer: item.answer as number,
    correct: item.correct as boolean,
    timeElapsedMs: item.timeElapsedMs as number,
    submittedAt: item.submittedAt as number,
  }
}
