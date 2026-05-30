import { getItem, updateItem, queryItems, cacheGet, cacheSet, cacheDel } from "@/lib/dynamodb"

export type UserProfile = {
  userId: string
  email: string
  displayName: string
  avatar: string | null
  elo: number
  rank: string
  gamesPlayed: number
  gamesWon: number
  currentStreak: number
  bestStreak: number
  bugsSeen: string[]
  achievementsUnlocked: string[]
  createdAt: number
}

export type MatchHistoryEntry = {
  gameId: string
  opponentId: string
  opponentName: string
  result: "win" | "loss" | "draw"
  eloBefore: number
  eloAfter: number
  eloChange: number
  createdAt: number
}

export function getRankFromElo(elo: number): string {
  if (elo >= 2000) return "Grandmaster"
  if (elo >= 1800) return "Master"
  if (elo >= 1600) return "Diamond"
  if (elo >= 1400) return "Platinum"
  if (elo >= 1200) return "Gold"
  if (elo >= 1000) return "Silver"
  return "Bronze"
}

const USER_CACHE_TTL_MS = 30_000

export async function getUser(userId: string): Promise<UserProfile | null> {
  const cacheKey = `user:${userId}`
  const cached = cacheGet(cacheKey)
  if (cached !== undefined) {
    return cached as UserProfile
  }

  const item = await getItem(`USER#${userId}`, "PROFILE")
  if (!item) {
    cacheSet(cacheKey, null, USER_CACHE_TTL_MS)
    return null
  }

  const profile: UserProfile = {
    userId: item.userId as string,
    email: item.email as string,
    displayName: item.displayName as string,
    avatar: (item.avatar as string | null) ?? null,
    elo: (item.elo as number) ?? 1200,
    rank: (item.rank as string) ?? getRankFromElo((item.elo as number) ?? 1200),
    gamesPlayed: (item.gamesPlayed as number) ?? 0,
    gamesWon: (item.gamesWon as number) ?? 0,
    currentStreak: (item.currentStreak as number) ?? 0,
    bestStreak: (item.bestStreak as number) ?? 0,
    bugsSeen: (item.bugsSeen as string[]) ?? [],
    achievementsUnlocked: (item.achievementsUnlocked as string[]) ?? [],
    createdAt: item.createdAt as number,
  }

  cacheSet(cacheKey, profile, USER_CACHE_TTL_MS)
  return profile
}

export async function updateUser(
  userId: string,
  updates: Partial<UserProfile>
): Promise<UserProfile> {
  const item = await updateItem(`USER#${userId}`, "PROFILE", updates as Record<string, unknown>)

  // Invalidate cache
  const cacheKey = `user:${userId}`
  cacheDel(cacheKey)

  const profile: UserProfile = {
    userId: item.userId as string,
    email: item.email as string,
    displayName: item.displayName as string,
    avatar: (item.avatar as string | null) ?? null,
    elo: (item.elo as number) ?? 1200,
    rank: (item.rank as string) ?? getRankFromElo((item.elo as number) ?? 1200),
    gamesPlayed: (item.gamesPlayed as number) ?? 0,
    gamesWon: (item.gamesWon as number) ?? 0,
    currentStreak: (item.currentStreak as number) ?? 0,
    bestStreak: (item.bestStreak as number) ?? 0,
    bugsSeen: (item.bugsSeen as string[]) ?? [],
    achievementsUnlocked: (item.achievementsUnlocked as string[]) ?? [],
    createdAt: item.createdAt as number,
  }

  return profile
}

export async function getMatchHistory(
  userId: string,
  limit = 20,
  cursor?: string
): Promise<{ entries: MatchHistoryEntry[]; nextCursor?: string }> {
  let exclusiveStartKey: Record<string, unknown> | undefined
  if (cursor) {
    try {
      exclusiveStartKey = JSON.parse(Buffer.from(cursor, "base64").toString("utf-8")) as Record<string, unknown>
    } catch {
      exclusiveStartKey = undefined
    }
  }

  const { items, lastEvaluatedKey } = await queryItems(
    "pk = :pk AND begins_with(sk, :skPrefix)",
    { ":pk": `USER#${userId}`, ":skPrefix": "GAME#" },
    {
      limit,
      exclusiveStartKey,
      scanIndexForward: false,
    }
  )

  const entries: MatchHistoryEntry[] = items.map((item) => {
    // SK format: GAME#<timestamp>#<gameId>
    const skParts = (item.sk as string).split("#")
    const gameId = skParts.length >= 3 ? skParts[2] : (item.gameId as string) ?? ""

    return {
      gameId,
      opponentId: item.opponentId as string,
      opponentName: item.opponentName as string,
      result: item.result as "win" | "loss" | "draw",
      eloBefore: item.eloBefore as number,
      eloAfter: item.eloAfter as number,
      eloChange: item.eloChange as number,
      createdAt: item.createdAt as number,
    }
  })

  const nextCursor = lastEvaluatedKey
    ? Buffer.from(JSON.stringify(lastEvaluatedKey)).toString("base64")
    : undefined

  return { entries, nextCursor }
}
