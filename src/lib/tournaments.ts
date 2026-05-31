// src/lib/tournaments.ts
import { v4 as uuidv4 } from "uuid"
import {
  getItem,
  putItem,
  updateItem,
  queryItems,
  ddb,
  TABLE_NAME,
} from "@/lib/dynamodb"
import { UpdateCommand } from "@aws-sdk/lib-dynamodb"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TournamentStatus =
  | "created"
  | "registration_open"
  | "registration_closed"
  | "round_1"
  | "round_2"
  | "final"
  | "completed"

export type Tournament = {
  tournamentId: string
  name: string
  status: TournamentStatus
  format: "single_elimination"
  maxPlayers: number
  registeredPlayers: string[]
  startTime: number
  currentRound: number
  winnerId: string | null
  prizeDescription: string
  createdAt: number
}

export type TournamentMatch = {
  tournamentId: string
  round: number
  matchId: string
  player1Id: string | null
  player2Id: string | null
  gameId: string | null
  winnerId: string | null
  status: "pending" | "active" | "completed" | "bye"
}

export type TournamentPlayer = {
  tournamentId: string
  userId: string
  displayName: string
  elo: number
  registeredAt: number
  currentRound: number
  eliminated: boolean
}

// ---------------------------------------------------------------------------
// createTournament
// ---------------------------------------------------------------------------

export async function createTournament(
  name: string,
  startTime: number,
  maxPlayers: number = 8,
  prizeDescription: string = ""
): Promise<Tournament> {
  const tournamentId = uuidv4()
  const now = Date.now()

  const tournament: Tournament = {
    tournamentId,
    name,
    status: "registration_open",
    format: "single_elimination",
    maxPlayers,
    registeredPlayers: [],
    startTime,
    currentRound: 0,
    winnerId: null,
    prizeDescription,
    createdAt: now,
  }

  await putItem({
    pk: `TOURNAMENT#${tournamentId}`,
    sk: "META",
    ...tournament,
    // GSI so we can query all tournaments
    gsi1pk: "TOURNAMENT#ALL",
    gsi1sk: `${now}#${tournamentId}`,
  })

  return tournament
}

// ---------------------------------------------------------------------------
// registerForTournament
// ---------------------------------------------------------------------------

export async function registerForTournament(
  tournamentId: string,
  userId: string,
  displayName: string,
  elo: number
): Promise<{ success: boolean; error?: string }> {
  const meta = await getItem(`TOURNAMENT#${tournamentId}`, "META")
  if (!meta) return { success: false, error: "Tournament not found" }

  const tournament = meta as unknown as Tournament & { pk: string; sk: string }

  if (tournament.status !== "registration_open") {
    return { success: false, error: "Registration is not open" }
  }

  const registeredPlayers = (tournament.registeredPlayers as string[]) ?? []
  if (registeredPlayers.length >= tournament.maxPlayers) {
    return { success: false, error: "Tournament is full" }
  }

  if (registeredPlayers.includes(userId)) {
    return { success: false, error: "Already registered" }
  }

  const now = Date.now()

  // Write player registration item
  await putItem({
    pk: `TOURNAMENT#${tournamentId}`,
    sk: `PLAYER#${userId}`,
    tournamentId,
    userId,
    displayName,
    elo,
    registeredAt: now,
    currentRound: 0,
    eliminated: false,
  })

  // Append userId to registeredPlayers list on META
  await ddb.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { pk: `TOURNAMENT#${tournamentId}`, sk: "META" },
      UpdateExpression: "SET #rp = list_append(#rp, :uid)",
      ExpressionAttributeNames: { "#rp": "registeredPlayers" },
      ExpressionAttributeValues: { ":uid": [userId] },
    })
  )

  return { success: true }
}

// ---------------------------------------------------------------------------
// generateBracket
// ---------------------------------------------------------------------------

export async function generateBracket(tournamentId: string): Promise<void> {
  // Fetch all PLAYER# items
  const { items: playerItems } = await queryItems(
    "pk = :pk AND begins_with(sk, :prefix)",
    { ":pk": `TOURNAMENT#${tournamentId}`, ":prefix": "PLAYER#" },
    { expressionAttributeNames: { "#sk": "sk" } }
  )

  // Sort by Elo descending (seed 1 = highest Elo)
  const players = (playerItems as unknown as TournamentPlayer[]).sort(
    (a, b) => b.elo - a.elo
  )

  const numPlayers = players.length
  const now = Date.now()
  const round = 1

  // Seed pairing: 1v8, 2v7, 3v6, 4v5 for 8-player bracket
  const matchCount = Math.floor(numPlayers / 2)

  for (let i = 0; i < matchCount; i++) {
    const matchId = String(i + 1).padStart(2, "0")
    const player1 = players[i]
    const player2 = players[numPlayers - 1 - i]

    await putItem({
      pk: `TOURNAMENT#${tournamentId}`,
      sk: `ROUND#${String(round).padStart(2, "0")}#MATCH#${matchId}`,
      tournamentId,
      round,
      matchId,
      player1Id: player1.userId,
      player2Id: player2.userId,
      gameId: null,
      winnerId: null,
      status: "pending",
      createdAt: now,
    })
  }

  // Handle bye if odd player count — highest seed advances automatically
  if (numPlayers % 2 === 1) {
    const byePlayer = players[0]
    const byeMatchId = String(matchCount + 1).padStart(2, "0")
    await putItem({
      pk: `TOURNAMENT#${tournamentId}`,
      sk: `ROUND#${String(round).padStart(2, "0")}#MATCH#${byeMatchId}`,
      tournamentId,
      round,
      matchId: byeMatchId,
      player1Id: byePlayer.userId,
      player2Id: null,
      gameId: null,
      winnerId: byePlayer.userId,
      status: "bye",
      createdAt: now,
    })
  }

  // Update tournament status to round_1
  await updateItem(`TOURNAMENT#${tournamentId}`, "META", {
    status: "round_1",
    currentRound: 1,
  })
}

// ---------------------------------------------------------------------------
// advanceTournament
// ---------------------------------------------------------------------------

export async function advanceTournament(tournamentId: string): Promise<void> {
  const meta = await getItem(`TOURNAMENT#${tournamentId}`, "META")
  if (!meta) return

  const tournament = meta as unknown as Tournament & { pk: string; sk: string }
  if (tournament.status === "completed" || tournament.status === "created") return

  const currentRound = tournament.currentRound

  // Fetch all matches for the current round
  const roundPrefix = `ROUND#${String(currentRound).padStart(2, "0")}#`
  const { items: matchItems } = await queryItems(
    "pk = :pk AND begins_with(sk, :prefix)",
    {
      ":pk": `TOURNAMENT#${tournamentId}`,
      ":prefix": roundPrefix,
    }
  )

  const matches = matchItems as unknown as (TournamentMatch & { pk: string; sk: string })[]

  // Check if all matches are complete
  const allComplete = matches.every(
    (m) => m.status === "completed" || m.status === "bye"
  )
  if (!allComplete) return

  // Collect winners
  const winners = matches
    .map((m) => m.winnerId)
    .filter((id): id is string => id !== null)

  if (winners.length === 1) {
    // Tournament complete
    await updateItem(`TOURNAMENT#${tournamentId}`, "META", {
      status: "completed",
      winnerId: winners[0],
    })

    // Write leaderboard standings
    const now = Date.now()
    for (let i = 0; i < winners.length; i++) {
      await putItem({
        pk: `LEADERBOARD#TOURNAMENT#${tournamentId}`,
        sk: `RANK#${String(i + 1).padStart(4, "0")}#${winners[i]}`,
        userId: winners[i],
        finalPosition: i + 1,
        createdAt: now,
      })
    }
    return
  }

  // Generate next round matches
  const nextRound = currentRound + 1
  const now = Date.now()

  for (let i = 0; i < Math.floor(winners.length / 2); i++) {
    const matchId = String(i + 1).padStart(2, "0")
    await putItem({
      pk: `TOURNAMENT#${tournamentId}`,
      sk: `ROUND#${String(nextRound).padStart(2, "0")}#MATCH#${matchId}`,
      tournamentId,
      round: nextRound,
      matchId,
      player1Id: winners[i * 2],
      player2Id: winners[i * 2 + 1],
      gameId: null,
      winnerId: null,
      status: "pending",
      createdAt: now,
    })
  }

  const nextStatus: TournamentStatus =
    nextRound === 2 ? "round_2" : nextRound === 3 ? "final" : "round_1"

  await updateItem(`TOURNAMENT#${tournamentId}`, "META", {
    status: nextStatus,
    currentRound: nextRound,
  })
}

// ---------------------------------------------------------------------------
// getTournament
// ---------------------------------------------------------------------------

export async function getTournament(tournamentId: string): Promise<{
  tournament: Tournament | null
  rounds: Record<number, TournamentMatch[]>
} | null> {
  const { items } = await queryItems(
    "pk = :pk",
    { ":pk": `TOURNAMENT#${tournamentId}` }
  )

  if (items.length === 0) return null

  const metaItem = items.find((i) => i.sk === "META")
  if (!metaItem) return null

  const tournament = metaItem as unknown as Tournament

  const matchItems = items.filter(
    (i) =>
      typeof i.sk === "string" &&
      (i.sk as string).startsWith("ROUND#")
  ) as unknown as TournamentMatch[]

  // Group by round
  const rounds: Record<number, TournamentMatch[]> = {}
  for (const match of matchItems) {
    if (!rounds[match.round]) rounds[match.round] = []
    rounds[match.round].push(match)
  }

  return { tournament, rounds }
}

// ---------------------------------------------------------------------------
// getAllActiveTournaments
// ---------------------------------------------------------------------------

export async function getAllActiveTournaments(): Promise<Tournament[]> {
  const { items } = await queryItems(
    "gsi1pk = :pk",
    { ":pk": "TOURNAMENT#ALL" },
    { indexName: "gsi1", scanIndexForward: false }
  )

  return items
    .filter((i) => i.sk === "META")
    .map((i) => i as unknown as Tournament)
}
