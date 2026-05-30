import { v4 as uuidv4 } from "uuid"
import {
  getItem,
  putItem,
  updateItem,
  deleteItem,
  cacheGet,
  cacheSet,
  ddb,
  TABLE_NAME,
} from "@/lib/dynamodb"
import { UpdateCommand } from "@aws-sdk/lib-dynamodb"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Bug = {
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
  timesServed: number
  source: string
  status: "active" | "pending_review"
  createdAt: number
}

export type BugIndex = {
  bugIds: string[]
  pendingBugIds: string[]
  byDifficulty: {
    "1": string[]
    "2": string[]
    "3": string[]
    "4": string[]
    "5": string[]
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BUG_INDEX_PK = "BUG#INDEX"
const BUG_INDEX_SK = "META"
const BUG_INDEX_CACHE_KEY = "bug:index"
const BUG_INDEX_CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

// ---------------------------------------------------------------------------
// getBug
// ---------------------------------------------------------------------------

/** Fetch a single bug by its ID. Returns null if not found. */
export async function getBug(bugId: string): Promise<Bug | null> {
  const item = await getItem(`BUG#${bugId}`, "META")
  if (!item) return null
  return itemToBug(item)
}

// ---------------------------------------------------------------------------
// getBugIndex
// ---------------------------------------------------------------------------

/** Read the BUG#INDEX item from DynamoDB (with 5-minute in-memory cache). */
export async function getBugIndex(): Promise<BugIndex | null> {
  const cached = cacheGet(BUG_INDEX_CACHE_KEY)
  if (cached !== undefined) {
    return cached as BugIndex | null
  }

  const item = await getItem(BUG_INDEX_PK, BUG_INDEX_SK)
  if (!item) {
    cacheSet(BUG_INDEX_CACHE_KEY, null, BUG_INDEX_CACHE_TTL_MS)
    return null
  }

  const index: BugIndex = {
    bugIds: (item.bugIds as string[]) ?? [],
    pendingBugIds: (item.pendingBugIds as string[]) ?? [],
    byDifficulty: {
      "1": ((item.byDifficulty as Record<string, string[]>)?.["1"]) ?? [],
      "2": ((item.byDifficulty as Record<string, string[]>)?.["2"]) ?? [],
      "3": ((item.byDifficulty as Record<string, string[]>)?.["3"]) ?? [],
      "4": ((item.byDifficulty as Record<string, string[]>)?.["4"]) ?? [],
      "5": ((item.byDifficulty as Record<string, string[]>)?.["5"]) ?? [],
    },
  }

  cacheSet(BUG_INDEX_CACHE_KEY, index, BUG_INDEX_CACHE_TTL_MS)
  return index
}

// ---------------------------------------------------------------------------
// putBugIndex
// ---------------------------------------------------------------------------

/** Write (or overwrite) the BUG#INDEX item. Invalidates the in-memory cache. */
export async function putBugIndex(index: BugIndex): Promise<void> {
  await putItem({
    pk: BUG_INDEX_PK,
    sk: BUG_INDEX_SK,
    bugIds: index.bugIds,
    pendingBugIds: index.pendingBugIds,
    byDifficulty: index.byDifficulty,
  })
  cacheSet(BUG_INDEX_CACHE_KEY, index, BUG_INDEX_CACHE_TTL_MS)
}

// ---------------------------------------------------------------------------
// selectBugForGame
// ---------------------------------------------------------------------------

/**
 * Pick the best bug for a game given the average Elo of two players and the
 * bugs each player has already seen.
 *
 * Algorithm:
 * 1. Map avgElo → targetDifficulty (1–5)
 * 2. Try targetDifficulty first, then widen outward (±1, ±2 …)
 * 3. From eligible candidates, weight toward lower timesServed and pick one at
 *    random using a simple inverse-frequency weighting.
 */
export async function selectBugForGame(
  avgElo: number,
  player1BugsSeen: string[],
  player2BugsSeen: string[]
): Promise<Bug | null> {
  const index = await getBugIndex()
  if (!index) return null

  // Elo → difficulty: ceil(elo / 400), capped at 5
  const targetDifficulty = Math.min(5, Math.ceil(avgElo / 400)) as 1 | 2 | 3 | 4 | 5

  const seenSet = new Set([...player1BugsSeen, ...player2BugsSeen])

  // Build priority order: target first, then expand outward
  const order = buildDifficultyOrder(targetDifficulty)

  let candidates: string[] = []
  for (const d of order) {
    const ids = index.byDifficulty[String(d) as "1" | "2" | "3" | "4" | "5"] ?? []
    const unseen = ids.filter((id) => !seenSet.has(id))
    if (unseen.length > 0) {
      candidates = unseen
      break
    }
  }

  if (candidates.length === 0) return null

  // Fetch all candidates to get timesServed, then weight toward lower values
  const bugs = await Promise.all(candidates.map((id) => getBug(id)))
  const validBugs = bugs.filter((b): b is Bug => b !== null)
  if (validBugs.length === 0) return null

  return weightedRandomBug(validBugs)
}

// ---------------------------------------------------------------------------
// markBugServed
// ---------------------------------------------------------------------------

/** Atomically increment timesServed by 1 for the given bug. */
export async function markBugServed(bugId: string): Promise<void> {
  await ddb.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { pk: `BUG#${bugId}`, sk: "META" },
      UpdateExpression: "SET #ts = if_not_exists(#ts, :zero) + :one",
      ExpressionAttributeNames: { "#ts": "timesServed" },
      ExpressionAttributeValues: { ":zero": 0, ":one": 1 },
    })
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Return difficulty levels in priority order: target first, then ±1, ±2 …
 * e.g. target=3 → [3, 2, 4, 1, 5]
 */
function buildDifficultyOrder(target: 1 | 2 | 3 | 4 | 5): Array<1 | 2 | 3 | 4 | 5> {
  const all: Array<1 | 2 | 3 | 4 | 5> = [1, 2, 3, 4, 5]
  return [target, ...all.filter((d) => d !== target).sort((a, b) => Math.abs(a - target) - Math.abs(b - target))]
}

/**
 * Pick a random bug weighted inversely by timesServed.
 * Bugs served fewer times are more likely to be picked.
 * Weight = 1 / (timesServed + 1)
 */
function weightedRandomBug(bugs: Bug[]): Bug {
  const weights = bugs.map((b) => 1 / (b.timesServed + 1))
  const total = weights.reduce((s, w) => s + w, 0)
  let rnd = Math.random() * total
  for (let i = 0; i < bugs.length; i++) {
    rnd -= weights[i]
    if (rnd <= 0) return bugs[i]
  }
  return bugs[bugs.length - 1]
}

/** Map a raw DynamoDB item to a typed Bug. */
function itemToBug(item: Record<string, unknown>): Bug {
  return {
    bugId: item.bugId as string,
    language: item.language as string,
    category: item.category as string,
    difficulty: item.difficulty as 1 | 2 | 3 | 4 | 5,
    buggyCode: item.buggyCode as string,
    correctCode: item.correctCode as string,
    bugLine: item.bugLine as number,
    options: item.options as [string, string, string, string],
    correctAnswer: item.correctAnswer as 0 | 1 | 2 | 3,
    explanation: item.explanation as string,
    hint: item.hint as string,
    timesServed: (item.timesServed as number) ?? 0,
    source: (item.source as string) ?? "manual",
    status: (item.status as "active" | "pending_review") ?? "active",
    createdAt: item.createdAt as number,
  }
}

// ---------------------------------------------------------------------------
// getBugForPractice
// ---------------------------------------------------------------------------

/**
 * Pick a random bug for practice mode.
 *
 * @param difficulty - If provided (1–5), restrict to that difficulty tier.
 *                     If omitted, a random difficulty 1–5 is chosen.
 * @param bugsSeen   - Optional list of bugIds already seen by the user.
 *                     These are excluded from the candidate pool.
 */
export async function getBugForPractice(
  difficulty?: number,
  bugsSeen: string[] = []
): Promise<Bug | null> {
  const index = await getBugIndex()
  if (!index) return null

  const seenSet = new Set(bugsSeen)

  let candidates: string[] = []

  if (difficulty !== undefined && difficulty >= 1 && difficulty <= 5) {
    // Use the requested difficulty tier
    const key = String(difficulty) as "1" | "2" | "3" | "4" | "5"
    candidates = (index.byDifficulty[key] ?? []).filter((id) => !seenSet.has(id))

    // If no unseen bugs at this difficulty, fall back to all difficulties
    if (candidates.length === 0) {
      candidates = index.bugIds.filter((id) => !seenSet.has(id))
    }
  } else {
    // No difficulty filter — pick from all unseen bugs
    candidates = index.bugIds.filter((id) => !seenSet.has(id))

    // If every bug has been seen, allow repeats
    if (candidates.length === 0) {
      candidates = [...index.bugIds]
    }
  }

  if (candidates.length === 0) return null

  // Pick a uniformly random candidate (no Elo weighting in practice mode)
  const randomId = candidates[Math.floor(Math.random() * candidates.length)]
  return getBug(randomId)
}

// ---------------------------------------------------------------------------
// createBug
// ---------------------------------------------------------------------------

/**
 * Persist a new bug to DynamoDB and update BUG#INDEX.
 * Bugs with status="active" are added to bugIds + byDifficulty.
 * Bugs with status="pending_review" are added to pendingBugIds only.
 */
export async function createBug(
  data: Omit<Bug, "bugId" | "timesServed" | "createdAt">
): Promise<Bug> {
  const bug = makeBug(data)

  await putItem({
    pk: `BUG#${bug.bugId}`,
    sk: "META",
    bugId: bug.bugId,
    language: bug.language,
    category: bug.category,
    difficulty: bug.difficulty,
    buggyCode: bug.buggyCode,
    correctCode: bug.correctCode,
    bugLine: bug.bugLine,
    options: bug.options,
    correctAnswer: bug.correctAnswer,
    explanation: bug.explanation,
    hint: bug.hint,
    timesServed: bug.timesServed,
    source: bug.source,
    status: bug.status,
    createdAt: bug.createdAt,
  })

  // Update index
  const existing = await getBugIndex()
  const index: BugIndex = existing ?? {
    bugIds: [],
    pendingBugIds: [],
    byDifficulty: { "1": [], "2": [], "3": [], "4": [], "5": [] },
  }

  if (bug.status === "active") {
    if (!index.bugIds.includes(bug.bugId)) {
      index.bugIds.push(bug.bugId)
    }
    const key = String(bug.difficulty) as "1" | "2" | "3" | "4" | "5"
    if (!index.byDifficulty[key].includes(bug.bugId)) {
      index.byDifficulty[key].push(bug.bugId)
    }
  } else {
    // pending_review
    if (!index.pendingBugIds.includes(bug.bugId)) {
      index.pendingBugIds.push(bug.bugId)
    }
  }

  await putBugIndex(index)
  return bug
}

// ---------------------------------------------------------------------------
// approveBug
// ---------------------------------------------------------------------------

/**
 * Move a pending_review bug to active:
 * - Update status in DynamoDB
 * - Move from pendingBugIds to bugIds + byDifficulty in index
 */
export async function approveBug(bugId: string): Promise<Bug | null> {
  const bug = await getBug(bugId)
  if (!bug) return null

  await updateItem(`BUG#${bugId}`, "META", { status: "active" })

  const existing = await getBugIndex()
  const index: BugIndex = existing ?? {
    bugIds: [],
    pendingBugIds: [],
    byDifficulty: { "1": [], "2": [], "3": [], "4": [], "5": [] },
  }

  index.pendingBugIds = index.pendingBugIds.filter((id) => id !== bugId)
  if (!index.bugIds.includes(bugId)) index.bugIds.push(bugId)
  const key = String(bug.difficulty) as "1" | "2" | "3" | "4" | "5"
  if (!index.byDifficulty[key].includes(bugId)) index.byDifficulty[key].push(bugId)

  await putBugIndex(index)
  return { ...bug, status: "active" }
}

// ---------------------------------------------------------------------------
// rejectBug
// ---------------------------------------------------------------------------

/**
 * Permanently delete a pending_review bug and remove it from the index.
 */
export async function rejectBug(bugId: string): Promise<void> {
  await deleteItem(`BUG#${bugId}`, "META")

  const existing = await getBugIndex()
  if (!existing) return

  existing.pendingBugIds = existing.pendingBugIds.filter((id) => id !== bugId)
  existing.bugIds = existing.bugIds.filter((id) => id !== bugId)
  for (const key of ["1", "2", "3", "4", "5"] as const) {
    existing.byDifficulty[key] = existing.byDifficulty[key].filter((id) => id !== bugId)
  }

  await putBugIndex(existing)
}

// ---------------------------------------------------------------------------
// getPendingBugs
// ---------------------------------------------------------------------------

/** Fetch all bugs with status="pending_review". */
export async function getPendingBugs(): Promise<Bug[]> {
  const index = await getBugIndex()
  if (!index || index.pendingBugIds.length === 0) return []

  const bugs = await Promise.all(index.pendingBugIds.map((id) => getBug(id)))
  return bugs.filter((b): b is Bug => b !== null)
}

// ---------------------------------------------------------------------------
// Exported utility: build a new Bug record (used by seed script)
// ---------------------------------------------------------------------------

export function makeBug(
  data: Omit<Bug, "bugId" | "timesServed" | "createdAt"> & {
    bugId?: string
    timesServed?: number
    createdAt?: number
  }
): Bug {
  return {
    bugId: data.bugId ?? uuidv4(),
    timesServed: data.timesServed ?? 0,
    createdAt: data.createdAt ?? Date.now(),
    language: data.language,
    category: data.category,
    difficulty: data.difficulty,
    buggyCode: data.buggyCode,
    correctCode: data.correctCode,
    bugLine: data.bugLine,
    options: data.options,
    correctAnswer: data.correctAnswer,
    explanation: data.explanation,
    hint: data.hint,
    source: data.source,
    status: data.status,
  }
}
