import { getItem, cacheGet, cacheSet } from "@/lib/dynamodb"

export type Season = {
  seasonId: string
  seasonNumber: number
  name: string
  startDate: string  // "YYYY-MM-DD"
  endDate: string
  status: "active" | "completed"
}

const SEASON_CACHE_TTL_MS = 5 * 60_000 // 5 minutes

/**
 * Returns the current active season or null if none exists.
 * Fetches SEASON#1 / META and caches for 5 minutes.
 */
export async function getCurrentSeason(): Promise<Season | null> {
  const cacheKey = "season:current"
  const cached = cacheGet(cacheKey)
  if (cached !== undefined) {
    return cached as Season | null
  }

  // For now we only have Season 1 — a more generic implementation would
  // query a SEASON_ACTIVE GSI, but direct getItem is cheaper and correct.
  const item = await getItem("SEASON#1", "META")
  if (!item || item.status !== "active") {
    cacheSet(cacheKey, null, SEASON_CACHE_TTL_MS)
    return null
  }

  const season: Season = {
    seasonId: item.seasonId as string,
    seasonNumber: item.seasonNumber as number,
    name: item.name as string,
    startDate: item.startDate as string,
    endDate: item.endDate as string,
    status: item.status as "active" | "completed",
  }

  cacheSet(cacheKey, season, SEASON_CACHE_TTL_MS)
  return season
}

/**
 * Returns the number of full days remaining until the season ends.
 * Returns 0 if the season has already ended.
 */
export function getDaysRemaining(season: Season): number {
  const end = new Date(season.endDate + "T23:59:59Z").getTime()
  const now = Date.now()
  return Math.max(0, Math.ceil((end - now) / 86_400_000))
}
