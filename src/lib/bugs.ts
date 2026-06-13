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
import { PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb"

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
  ratingCount?: number
  ratingSum?: number
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
  // Optimistic-concurrency token — incremented on every write; callers must
  // pass the version they read back to putBugIndex so concurrent mutations
  // can detect and retry instead of silently clobbering each other.
  version: number
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

/**
 * Read the BUG#INDEX item from DynamoDB (with 5-minute in-memory cache).
 * Pass `bypassCache: true` to force a fresh read — required before retrying
 * a conditional write so we don't re-apply a mutation against a stale version.
 */
export async function getBugIndex(opts?: { bypassCache?: boolean }): Promise<BugIndex | null> {
  if (!opts?.bypassCache) {
    const cached = cacheGet(BUG_INDEX_CACHE_KEY)
    if (cached !== undefined) {
      return cached as BugIndex | null
    }
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
    version: (item.version as number) ?? 0,
  }

  cacheSet(BUG_INDEX_CACHE_KEY, index, BUG_INDEX_CACHE_TTL_MS)
  return index
}

// ---------------------------------------------------------------------------
// putBugIndex
// ---------------------------------------------------------------------------

/**
 * Conditionally write the BUG#INDEX item, requiring the stored version to
 * still match `expectedVersion` (optimistic concurrency). Writes version+1.
 * Returns false on a ConditionalCheckFailedException (caller should re-fetch
 * fresh, re-apply its mutation, and retry) and throws on any other error.
 */
export async function putBugIndex(index: BugIndex, expectedVersion: number): Promise<boolean> {
  const newIndex: BugIndex = { ...index, version: expectedVersion + 1 }
  // 400KB DynamoDB item-size ceiling — warn loudly at 50% so we migrate to
  // per-difficulty shard items (docs/ARCHITECTURE.md, Limit 2) before it bites.
  const approxBytes = JSON.stringify(newIndex).length
  if (approxBytes > 200_000) {
    console.warn(`[bugs] BUG#INDEX is ~${approxBytes}B — past 50% of the 400KB item limit; shard by difficulty soon`)
  }
  try {
    await ddb.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          pk: BUG_INDEX_PK,
          sk: BUG_INDEX_SK,
          bugIds: newIndex.bugIds,
          pendingBugIds: newIndex.pendingBugIds,
          byDifficulty: newIndex.byDifficulty,
          version: newIndex.version,
        },
        // Legacy BUG#INDEX items predate the `version` field — treat a missing
        // attribute as version 0 so the first conditional write against one
        // doesn't spuriously fail (DynamoDB evaluates `version = :v` as false,
        // not an error, when the attribute is absent).
        ConditionExpression: "attribute_not_exists(version) OR version = :expectedVersion",
        ExpressionAttributeValues: { ":expectedVersion": expectedVersion },
      })
    )
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "ConditionalCheckFailedException") {
      return false
    }
    throw err
  }
  cacheSet(BUG_INDEX_CACHE_KEY, newIndex, BUG_INDEX_CACHE_TTL_MS)
  return true
}

// ---------------------------------------------------------------------------
// mutateBugIndex — retry-on-conflict wrapper around putBugIndex
// ---------------------------------------------------------------------------

const BUG_INDEX_RETRY_CAP = 3

/**
 * Read-modify-write the BUG#INDEX with optimistic-concurrency retry.
 * `mutate` receives a fresh copy of the index (or a freshly-initialized empty
 * one if none exists yet) and should return the mutated copy to persist.
 * Retries up to BUG_INDEX_RETRY_CAP times against a freshly-refetched index
 * on version conflicts, throwing if all attempts fail.
 */
async function mutateBugIndex(mutate: (index: BugIndex) => BugIndex): Promise<void> {
  for (let attempt = 0; attempt < BUG_INDEX_RETRY_CAP; attempt++) {
    const existing = await getBugIndex({ bypassCache: attempt > 0 })
    const current: BugIndex = existing ?? {
      bugIds: [],
      pendingBugIds: [],
      byDifficulty: { "1": [], "2": [], "3": [], "4": [], "5": [] },
      version: 0,
    }
    const mutated = mutate(current)
    const ok = await putBugIndex(mutated, current.version)
    if (ok) return
  }
  throw new Error("putBugIndex: exhausted retries due to concurrent BUG#INDEX writes")
}

// ---------------------------------------------------------------------------
// selectBugsForGame
// ---------------------------------------------------------------------------

/**
 * Pick `count` distinct bugs for a multi-round game given the average Elo of
 * two players and the bugs each player has already seen.
 *
 * Algorithm (run once per slot, excluding bugs already chosen this match):
 * 1. Map avgElo → targetDifficulty (1–5)
 * 2. Try targetDifficulty first, then widen outward (±1, ±2 …)
 * 3. If a tier's unseen pool is exhausted, widen to allow previously-seen bugs
 *    so the match can still fill all slots
 * 4. From eligible candidates, weight toward lower timesServed and pick one at
 *    random using a simple inverse-frequency weighting
 *
 * Returns null if fewer than `count` distinct bugs are available overall.
 */
export async function selectBugsForGame(
  avgElo: number,
  player1BugsSeen: string[],
  player2BugsSeen: string[],
  count: number = 3
): Promise<Bug[] | null> {
  const index = await getBugIndex()
  if (!index) return null

  // Elo → difficulty: ceil(elo / 400), capped at 5
  const targetDifficulty = Math.min(5, Math.ceil(avgElo / 400)) as 1 | 2 | 3 | 4 | 5
  const seenSet = new Set([...player1BugsSeen, ...player2BugsSeen])
  const order = buildDifficultyOrder(targetDifficulty)
  const chosenIds = new Set<string>()
  const chosen: Bug[] = []

  for (let slot = 0; slot < count; slot++) {
    let candidates: string[] = []

    // Pass 1: unseen bugs in difficulty-priority order
    for (const d of order) {
      const ids = index.byDifficulty[String(d) as "1" | "2" | "3" | "4" | "5"] ?? []
      const unseen = ids.filter((id) => !seenSet.has(id) && !chosenIds.has(id))
      if (unseen.length > 0) {
        candidates = unseen
        break
      }
    }

    // Pass 2: widen to previously-seen bugs (still excluding ones already chosen this match)
    if (candidates.length === 0) {
      for (const d of order) {
        const ids = index.byDifficulty[String(d) as "1" | "2" | "3" | "4" | "5"] ?? []
        const remaining = ids.filter((id) => !chosenIds.has(id))
        if (remaining.length > 0) {
          candidates = remaining
          break
        }
      }
    }

    if (candidates.length === 0) break

    const bugs = await Promise.all(candidates.map((id) => getBug(id)))
    const validBugs = bugs.filter((b): b is Bug => b !== null && !chosenIds.has(b.bugId))
    if (validBugs.length === 0) break

    const picked = weightedRandomBug(validBugs)
    chosenIds.add(picked.bugId)
    chosen.push(picked)
  }

  if (chosen.length < count) return null
  return chosen
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
    // Preserve "not yet rated" as undefined (not 0) so health route's `?? 0` fallbacks work correctly
    ratingCount: (item.ratingCount as number) ?? undefined,
    ratingSum: (item.ratingSum as number) ?? undefined,
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

  // Update index (retry-on-conflict: re-applies this same mutation to a fresh copy)
  await mutateBugIndex((index) => {
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
    return index
  })

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

  await mutateBugIndex((index) => {
    index.pendingBugIds = index.pendingBugIds.filter((id) => id !== bugId)
    if (!index.bugIds.includes(bugId)) index.bugIds.push(bugId)
    const key = String(bug.difficulty) as "1" | "2" | "3" | "4" | "5"
    if (!index.byDifficulty[key].includes(bugId)) index.byDifficulty[key].push(bugId)
    return index
  })

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

  await mutateBugIndex((index) => {
    index.pendingBugIds = index.pendingBugIds.filter((id) => id !== bugId)
    index.bugIds = index.bugIds.filter((id) => id !== bugId)
    for (const key of ["1", "2", "3", "4", "5"] as const) {
      index.byDifficulty[key] = index.byDifficulty[key].filter((id) => id !== bugId)
    }
    return index
  })
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
