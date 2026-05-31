# Platform Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add single-elimination tournaments, org/team mode, VS Code extension for practice, and community bug difficulty ratings.

**Architecture:** Tournaments use DynamoDB bracket entities advanced by Vercel Cron. Orgs use DynamoDB with invite codes and a separate leaderboard. VS Code extension calls existing /api/bugs/random with Bearer API token. Bug ratings use DynamoDB ADD expressions for atomic aggregates.

**Tech Stack:** Vercel Cron Jobs, DynamoDB, @upstash/redis (notifications), VS Code Extension API, @vscode/vsce

---

## Task 1 — Tournament Core Logic

### Files
- `src/lib/tournaments.ts` — all bracket types and business logic

### Steps

- [ ] Create `src/lib/tournaments.ts`

```typescript
// src/lib/tournaments.ts
import { v4 as uuidv4 } from "uuid"
import {
  getItem,
  putItem,
  putItemIfNotExists,
  updateItem,
  queryItems,
  ddb,
  TABLE_NAME,
} from "@/lib/dynamodb"
import { UpdateCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb"

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
    { expressionAttributeNames: {} }
  )

  // Sort by Elo descending (seed 1 = highest Elo)
  const players = (playerItems as unknown as TournamentPlayer[]).sort(
    (a, b) => b.elo - a.elo
  )

  const numPlayers = players.length
  const now = Date.now()
  const round = 1

  // Seed pairing: 1v8, 2v7, 3v6, 4v5 for 8-player bracket
  // For smaller brackets, highest seed gets byes
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
```

- [ ] Commit: `git add src/lib/tournaments.ts && git commit -m "feat: tournament core logic — types, createTournament, registerForTournament, generateBracket, advanceTournament, getTournament"`

---

## Task 2 — Tournament API Routes

### Files
- `src/app/api/tournaments/route.ts`
- `src/app/api/tournaments/[id]/route.ts`
- `src/app/api/tournaments/[id]/register/route.ts`
- `src/app/api/cron/tournament-tick/route.ts`

### Steps

- [ ] Create `src/app/api/tournaments/route.ts`

```typescript
// src/app/api/tournaments/route.ts
import { NextRequest, NextResponse } from "next/server"
import { safeAuth } from "@/lib/test-auth"
import { createTournament, getAllActiveTournaments } from "@/lib/tournaments"

export async function GET() {
  const tournaments = await getAllActiveTournaments()
  return NextResponse.json({ tournaments })
}

export async function POST(req: NextRequest) {
  const session = await safeAuth()
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const adminEmails = (process.env.ADMIN_EMAILS ?? "").split(",").map((s) => s.trim().toLowerCase())
  if (!adminEmails.includes(session.user.email.toLowerCase())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { name, startTime, maxPlayers, prizeDescription } = await req.json() as {
    name: string
    startTime: number
    maxPlayers?: number
    prizeDescription?: string
  }

  if (!name || !startTime) {
    return NextResponse.json({ error: "name and startTime required" }, { status: 400 })
  }

  const tournament = await createTournament(
    name,
    startTime,
    maxPlayers ?? 8,
    prizeDescription ?? ""
  )

  return NextResponse.json(tournament, { status: 201 })
}
```

- [ ] Create `src/app/api/tournaments/[id]/route.ts`

```typescript
// src/app/api/tournaments/[id]/route.ts
import { NextRequest, NextResponse } from "next/server"
import { getTournament } from "@/lib/tournaments"

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const result = await getTournament(id)

  if (!result) {
    return NextResponse.json({ error: "Tournament not found" }, { status: 404 })
  }

  return NextResponse.json(result)
}
```

- [ ] Create `src/app/api/tournaments/[id]/register/route.ts`

```typescript
// src/app/api/tournaments/[id]/register/route.ts
import { NextRequest, NextResponse } from "next/server"
import { safeAuth } from "@/lib/test-auth"
import { getUser } from "@/lib/users"
import { registerForTournament } from "@/lib/tournaments"

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await safeAuth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id: tournamentId } = await params
  const userId = session.user.id

  const profile = await getUser(userId)
  if (!profile) {
    return NextResponse.json({ error: "User not found" }, { status: 404 })
  }

  const result = await registerForTournament(
    tournamentId,
    userId,
    profile.displayName,
    profile.elo
  )

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }

  return NextResponse.json({ success: true })
}
```

- [ ] Create `src/app/api/cron/tournament-tick/route.ts`

```typescript
// src/app/api/cron/tournament-tick/route.ts
import { NextRequest, NextResponse } from "next/server"
import { getAllActiveTournaments, advanceTournament, generateBracket } from "@/lib/tournaments"

export async function POST(req: NextRequest) {
  const secret = req.headers.get("authorization")?.replace("Bearer ", "")
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const tournaments = await getAllActiveTournaments()
  const now = Date.now()
  const results: string[] = []

  for (const t of tournaments) {
    // Auto-close registration and generate bracket when startTime arrives
    if (
      t.status === "registration_open" &&
      now >= t.startTime &&
      t.registeredPlayers.length >= 2
    ) {
      await generateBracket(t.tournamentId)
      results.push(`${t.tournamentId}: bracket generated`)
      continue
    }

    // Advance completed rounds
    if (
      t.status === "round_1" ||
      t.status === "round_2" ||
      t.status === "final"
    ) {
      await advanceTournament(t.tournamentId)
      results.push(`${t.tournamentId}: advance attempted`)
    }
  }

  return NextResponse.json({ processed: results })
}
```

- [ ] Add Vercel Cron config to `vercel.json` (create if missing):

```json
{
  "crons": [
    {
      "path": "/api/cron/tournament-tick",
      "schedule": "*/5 * * * *"
    }
  ]
}
```

- [ ] Commit: `git add src/app/api/tournaments/ src/app/api/cron/ vercel.json && git commit -m "feat: tournament API routes and Vercel Cron tick endpoint"`

---

## Task 3 — Tournament Pages with SVG Bracket

### Files
- `src/app/(game)/tournaments/page.tsx`
- `src/app/(game)/tournaments/[id]/page.tsx`

### Steps

- [ ] Create `src/app/(game)/tournaments/page.tsx`

```typescript
// src/app/(game)/tournaments/page.tsx
"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { Tournament } from "@/lib/tournaments"

function Countdown({ targetMs }: { targetMs: number }) {
  const [remaining, setRemaining] = useState(targetMs - Date.now())

  useEffect(() => {
    const iv = setInterval(() => setRemaining(targetMs - Date.now()), 1000)
    return () => clearInterval(iv)
  }, [targetMs])

  if (remaining <= 0) return <span className="text-green-400 text-sm">Starting soon</span>

  const totalSec = Math.floor(remaining / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60

  return (
    <span className="font-mono text-sm text-yellow-300">
      {String(h).padStart(2, "0")}:{String(m).padStart(2, "0")}:{String(s).padStart(2, "0")}
    </span>
  )
}

const STATUS_LABELS: Record<string, string> = {
  registration_open: "Registration Open",
  registration_closed: "Starting",
  round_1: "Round 1 Active",
  round_2: "Round 2 Active",
  final: "Final",
  completed: "Completed",
  created: "Upcoming",
}

export default function TournamentsPage() {
  const [tournaments, setTournaments] = useState<Tournament[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/tournaments")
      .then((r) => r.json())
      .then((d) => {
        setTournaments(d.tournaments ?? [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-8">
        <p className="text-white/50">Loading tournaments...</p>
      </div>
    )
  }

  const upcoming = tournaments.filter(
    (t) => t.status === "registration_open" || t.status === "created"
  )
  const active = tournaments.filter(
    (t) =>
      t.status === "round_1" ||
      t.status === "round_2" ||
      t.status === "final" ||
      t.status === "registration_closed"
  )

  return (
    <div className="mx-auto max-w-2xl space-y-8 px-4 py-8">
      <h1 className="text-2xl font-bold text-white">Tournaments</h1>

      {upcoming.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-white/50">
            Upcoming
          </h2>
          {upcoming.map((t) => (
            <Card key={t.tournamentId} className="border-white/10 bg-white/5">
              <CardHeader className="pb-2">
                <CardTitle className="text-white">{t.name}</CardTitle>
              </CardHeader>
              <CardContent className="flex items-center justify-between gap-4">
                <div className="space-y-1">
                  <p className="text-xs text-white/50">
                    {STATUS_LABELS[t.status]}
                  </p>
                  <p className="text-xs text-white/40">
                    {t.registeredPlayers.length} / {t.maxPlayers} players
                  </p>
                  {t.startTime > Date.now() && (
                    <div className="flex items-center gap-2 text-xs text-white/40">
                      Starts in: <Countdown targetMs={t.startTime} />
                    </div>
                  )}
                  {t.prizeDescription && (
                    <p className="text-xs text-yellow-300/70">{t.prizeDescription}</p>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() =>
                      fetch(`/api/tournaments/${t.tournamentId}/register`, {
                        method: "POST",
                      }).then(() => window.location.reload())
                    }
                    disabled={t.status !== "registration_open"}
                  >
                    Register
                  </Button>
                  <Button size="sm" variant="outline" asChild>
                    <Link href={`/tournaments/${t.tournamentId}`}>View</Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </section>
      )}

      {active.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-white/50">
            Live
          </h2>
          {active.map((t) => (
            <Card key={t.tournamentId} className="border-yellow-500/30 bg-yellow-900/10">
              <CardHeader className="pb-2">
                <CardTitle className="text-white">{t.name}</CardTitle>
              </CardHeader>
              <CardContent className="flex items-center justify-between gap-4">
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-yellow-300">
                    {STATUS_LABELS[t.status]}
                  </p>
                  <p className="text-xs text-white/40">
                    {t.registeredPlayers.length} players
                  </p>
                </div>
                <Button size="sm" variant="outline" asChild>
                  <Link href={`/tournaments/${t.tournamentId}`}>Watch Bracket</Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </section>
      )}

      {upcoming.length === 0 && active.length === 0 && (
        <div className="rounded-xl border border-white/10 bg-white/5 px-6 py-16 text-center">
          <p className="text-white/50">No tournaments scheduled right now.</p>
          <p className="mt-1 text-sm text-white/30">Check back soon!</p>
        </div>
      )}
    </div>
  )
}
```

- [ ] Create `src/app/(game)/tournaments/[id]/page.tsx`

```typescript
// src/app/(game)/tournaments/[id]/page.tsx
"use client"

import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import type { Tournament, TournamentMatch } from "@/lib/tournaments"

type BracketData = {
  tournament: Tournament
  rounds: Record<number, TournamentMatch[]>
}

// ---------------------------------------------------------------------------
// SVG Bracket Component
// ---------------------------------------------------------------------------

const BOX_W = 180
const BOX_H = 52
const COL_GAP = 100
const ROW_GAP = 20

function MatchBox({
  match,
  x,
  y,
}: {
  match: TournamentMatch | null
  x: number
  y: number
}) {
  const p1 = match?.player1Id ?? "TBD"
  const p2 = match?.player2Id ?? "TBD"
  const winner = match?.winnerId

  return (
    <g>
      <rect
        x={x}
        y={y}
        width={BOX_W}
        height={BOX_H}
        rx={6}
        fill="#1a1a2e"
        stroke="#ffffff20"
        strokeWidth={1}
      />
      {/* Player 1 row */}
      <rect
        x={x}
        y={y}
        width={BOX_W}
        height={BOX_H / 2}
        rx={6}
        fill={winner === p1 ? "#14532d80" : "transparent"}
      />
      <text
        x={x + 10}
        y={y + BOX_H / 4 + 4}
        fontSize={11}
        fill={winner === p1 ? "#86efac" : "#ffffffaa"}
        fontFamily="monospace"
      >
        {p1.slice(0, 18)}
      </text>
      {/* Divider */}
      <line
        x1={x}
        y1={y + BOX_H / 2}
        x2={x + BOX_W}
        y2={y + BOX_H / 2}
        stroke="#ffffff15"
        strokeWidth={1}
      />
      {/* Player 2 row */}
      <rect
        x={x}
        y={y + BOX_H / 2}
        width={BOX_W}
        height={BOX_H / 2}
        rx={6}
        fill={winner === p2 ? "#14532d80" : "transparent"}
      />
      <text
        x={x + 10}
        y={y + (BOX_H * 3) / 4 + 4}
        fontSize={11}
        fill={winner === p2 ? "#86efac" : "#ffffffaa"}
        fontFamily="monospace"
      >
        {p2 === "TBD" ? "TBD" : p2.slice(0, 18)}
      </text>
    </g>
  )
}

function BracketSVG({ rounds }: { rounds: Record<number, TournamentMatch[]> }) {
  // Layout: QF (round 1, 4 matches), SF (round 2, 2 matches), F (round 3, 1 match)
  // viewBox="0 0 900 400"
  const cols = [0, BOX_W + COL_GAP, 2 * (BOX_W + COL_GAP)]

  const getMatchY = (roundNum: number, matchIdx: number): number => {
    const totalMatches = Math.pow(2, 3 - roundNum) // r1=4, r2=2, r3=1
    const slotH = 360 / totalMatches
    return 20 + matchIdx * slotH + (slotH - BOX_H) / 2
  }

  return (
    <svg
      viewBox="0 0 900 400"
      className="w-full rounded-xl border border-white/10 bg-[#0d0d1a]"
    >
      {/* Column headers */}
      {["Quarter-Finals", "Semi-Finals", "Final"].map((label, ci) => (
        <text
          key={label}
          x={cols[ci] + BOX_W / 2}
          y={12}
          textAnchor="middle"
          fontSize={10}
          fill="#ffffff50"
          fontFamily="sans-serif"
          letterSpacing={1}
        >
          {label.toUpperCase()}
        </text>
      ))}

      {/* Round 1 matches */}
      {(rounds[1] ?? []).map((match, i) => (
        <MatchBox
          key={match.matchId}
          match={match}
          x={cols[0]}
          y={getMatchY(1, i)}
        />
      ))}

      {/* Round 2 matches */}
      {(rounds[2] ?? []).map((match, i) => (
        <MatchBox
          key={match.matchId}
          match={match}
          x={cols[1]}
          y={getMatchY(2, i)}
        />
      ))}

      {/* Final */}
      {(rounds[3] ?? []).map((match, i) => (
        <MatchBox
          key={match.matchId}
          match={match}
          x={cols[2]}
          y={getMatchY(3, i)}
        />
      ))}

      {/* Connector lines from QF to SF */}
      {(rounds[1] ?? []).map((_, i) => {
        const fromY = getMatchY(1, i) + BOX_H / 2
        const toMatchIdx = Math.floor(i / 2)
        const toY = getMatchY(2, toMatchIdx) + BOX_H / 2
        const midX = cols[0] + BOX_W + COL_GAP / 2
        return (
          <path
            key={`qf-sf-${i}`}
            d={`M ${cols[0] + BOX_W} ${fromY} H ${midX} V ${toY} H ${cols[1]}`}
            fill="none"
            stroke="#ffffff20"
            strokeWidth={1}
          />
        )
      })}

      {/* Connector lines from SF to F */}
      {(rounds[2] ?? []).map((_, i) => {
        const fromY = getMatchY(2, i) + BOX_H / 2
        const toY = getMatchY(3, 0) + BOX_H / 2
        const midX = cols[1] + BOX_W + COL_GAP / 2
        return (
          <path
            key={`sf-f-${i}`}
            d={`M ${cols[1] + BOX_W} ${fromY} H ${midX} V ${toY} H ${cols[2]}`}
            fill="none"
            stroke="#ffffff20"
            strokeWidth={1}
          />
        )
      })}
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function TournamentBracketPage() {
  const { id } = useParams<{ id: string }>()
  const [data, setData] = useState<BracketData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/tournaments/${id}`)
      .then((r) => r.json())
      .then((d) => {
        setData(d)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [id])

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8">
        <p className="text-white/50">Loading bracket...</p>
      </div>
    )
  }

  if (!data?.tournament) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8">
        <p className="text-white/50">Tournament not found.</p>
      </div>
    )
  }

  const { tournament, rounds } = data

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">{tournament.name}</h1>
        <span className="rounded-full border border-yellow-500/40 bg-yellow-900/20 px-3 py-1 text-xs font-semibold text-yellow-300">
          {tournament.status.replace("_", " ").toUpperCase()}
        </span>
      </div>

      {tournament.prizeDescription && (
        <p className="text-sm text-yellow-200/70">{tournament.prizeDescription}</p>
      )}

      {Object.keys(rounds).length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-white/5 px-6 py-12 text-center">
          <p className="text-white/50">
            Bracket has not been generated yet.
          </p>
          <p className="mt-1 text-sm text-white/30">
            {tournament.registeredPlayers.length} / {tournament.maxPlayers} players registered.
          </p>
        </div>
      ) : (
        <BracketSVG rounds={rounds} />
      )}

      {tournament.winnerId && (
        <div className="rounded-xl border border-yellow-500/40 bg-yellow-900/20 p-5 text-center">
          <p className="text-sm text-white/50">Tournament Winner</p>
          <p className="mt-1 text-xl font-bold text-yellow-300">{tournament.winnerId}</p>
        </div>
      )}
    </div>
  )
}
```

- [ ] Commit: `git add src/app/\(game\)/tournaments/ && git commit -m "feat: tournament list page and SVG bracket view"`

---

## Task 4 — Org/Team Core

### Files
- `src/lib/orgs.ts`
- `src/app/api/org/route.ts`
- `src/app/api/org/join/route.ts`
- `src/app/api/org/[id]/route.ts`
- `src/app/api/org/[id]/leaderboard/route.ts`
- `src/app/api/org/[id]/invite/route.ts`

### Steps

- [ ] Create `src/lib/orgs.ts`

```typescript
// src/lib/orgs.ts
import { v4 as uuidv4 } from "uuid"
import {
  getItem,
  putItem,
  putItemIfNotExists,
  updateItem,
  deleteItem,
  queryItems,
  ddb,
  TABLE_NAME,
} from "@/lib/dynamodb"
import { UpdateCommand, ScanCommand } from "@aws-sdk/lib-dynamodb"
import crypto from "crypto"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Org = {
  orgId: string
  name: string
  slug: string
  adminId: string
  memberCount: number
  createdAt: number
  inviteCode: string
}

export type OrgMember = {
  orgId: string
  userId: string
  displayName: string
  elo: number
  joinedAt: number
  role: "admin" | "member"
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateInviteCode(): string {
  return crypto.randomBytes(4).toString("hex").toUpperCase()
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48)
}

// ---------------------------------------------------------------------------
// createOrg
// ---------------------------------------------------------------------------

export async function createOrg(name: string, adminId: string, adminDisplayName: string, adminElo: number): Promise<Org> {
  const orgId = uuidv4()
  const now = Date.now()
  const inviteCode = generateInviteCode()
  const slug = slugify(name)

  const org: Org = {
    orgId,
    name,
    slug,
    adminId,
    memberCount: 1,
    createdAt: now,
    inviteCode,
  }

  await putItem({
    pk: `ORG#${orgId}`,
    sk: "META",
    ...org,
    // Invite code index so we can find org by code
    gsi1pk: `INVITE#${inviteCode}`,
    gsi1sk: orgId,
  })

  // Write admin as first member
  await putItem({
    pk: `ORG#${orgId}`,
    sk: `MEMBER#${adminId}`,
    orgId,
    userId: adminId,
    displayName: adminDisplayName,
    elo: adminElo,
    joinedAt: now,
    role: "admin",
  })

  // Reverse index on the user
  await putItem({
    pk: `USER#${adminId}`,
    sk: `ORG#${orgId}`,
    orgId,
    orgName: name,
    joinedAt: now,
  })

  return org
}

// ---------------------------------------------------------------------------
// joinOrg
// ---------------------------------------------------------------------------

export async function joinOrg(
  inviteCode: string,
  userId: string,
  displayName: string,
  elo: number
): Promise<{ success: boolean; orgId?: string; error?: string }> {
  // Find org by invite code via GSI
  const { items } = await queryItems(
    "gsi1pk = :pk",
    { ":pk": `INVITE#${inviteCode}` },
    { indexName: "gsi1" }
  )

  if (items.length === 0) {
    return { success: false, error: "Invalid invite code" }
  }

  const orgId = items[0].gsi1sk as string ?? items[0].orgId as string

  // Check user is not already a member
  const existing = await getItem(`ORG#${orgId}`, `MEMBER#${userId}`)
  if (existing) {
    return { success: false, error: "Already a member of this org" }
  }

  const now = Date.now()
  const orgMeta = await getItem(`ORG#${orgId}`, "META") as Org & { pk: string; sk: string } | null
  if (!orgMeta) return { success: false, error: "Org not found" }

  // Write member item
  await putItem({
    pk: `ORG#${orgId}`,
    sk: `MEMBER#${userId}`,
    orgId,
    userId,
    displayName,
    elo,
    joinedAt: now,
    role: "member",
  })

  // Write reverse user index
  await putItem({
    pk: `USER#${userId}`,
    sk: `ORG#${orgId}`,
    orgId,
    orgName: orgMeta.name,
    joinedAt: now,
  })

  // Increment memberCount
  await ddb.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { pk: `ORG#${orgId}`, sk: "META" },
      UpdateExpression: "ADD #mc :inc",
      ExpressionAttributeNames: { "#mc": "memberCount" },
      ExpressionAttributeValues: { ":inc": 1 },
    })
  )

  // Seed org leaderboard entry for the new member
  await putItem({
    pk: `LEADERBOARD#ORG#${orgId}`,
    sk: `RANK#${String(elo).padStart(12, "0")}#${userId}`,
    userId,
    displayName,
    elo,
    updatedAt: now,
  })

  return { success: true, orgId }
}

// ---------------------------------------------------------------------------
// getOrg
// ---------------------------------------------------------------------------

export async function getOrg(orgId: string): Promise<{
  org: Org | null
  members: OrgMember[]
}> {
  const { items } = await queryItems(
    "pk = :pk",
    { ":pk": `ORG#${orgId}` }
  )

  const meta = items.find((i) => i.sk === "META") as (Org & { pk: string; sk: string }) | undefined
  if (!meta) return { org: null, members: [] }

  const members = items
    .filter((i) => typeof i.sk === "string" && (i.sk as string).startsWith("MEMBER#"))
    .map((i) => i as unknown as OrgMember)

  return { org: meta as unknown as Org, members }
}

// ---------------------------------------------------------------------------
// getOrgLeaderboard
// ---------------------------------------------------------------------------

export async function getOrgLeaderboard(orgId: string): Promise<
  { userId: string; displayName: string; elo: number }[]
> {
  const { items } = await queryItems(
    "pk = :pk",
    { ":pk": `LEADERBOARD#ORG#${orgId}` },
    { scanIndexForward: false, limit: 50 }
  )

  return items.map((i) => ({
    userId: i.userId as string,
    displayName: i.displayName as string,
    elo: i.elo as number,
  }))
}

// ---------------------------------------------------------------------------
// getUserOrgs
// ---------------------------------------------------------------------------

export async function getUserOrgs(userId: string): Promise<
  { orgId: string; orgName: string; joinedAt: number }[]
> {
  const { items } = await queryItems(
    "pk = :pk AND begins_with(sk, :prefix)",
    { ":pk": `USER#${userId}`, ":prefix": "ORG#" }
  )

  return items.map((i) => ({
    orgId: i.orgId as string,
    orgName: i.orgName as string,
    joinedAt: i.joinedAt as number,
  }))
}

// ---------------------------------------------------------------------------
// regenerateInviteCode
// ---------------------------------------------------------------------------

export async function regenerateInviteCode(
  orgId: string,
  requestingUserId: string
): Promise<{ success: boolean; inviteCode?: string; error?: string }> {
  const { org } = await getOrg(orgId)
  if (!org) return { success: false, error: "Org not found" }
  if (org.adminId !== requestingUserId) return { success: false, error: "Forbidden" }

  const newCode = generateInviteCode()

  await ddb.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { pk: `ORG#${orgId}`, sk: "META" },
      UpdateExpression: "SET #ic = :code, gsi1pk = :gsi1pk",
      ExpressionAttributeNames: { "#ic": "inviteCode" },
      ExpressionAttributeValues: {
        ":code": newCode,
        ":gsi1pk": `INVITE#${newCode}`,
      },
    })
  )

  return { success: true, inviteCode: newCode }
}
```

- [ ] Create `src/app/api/org/route.ts`

```typescript
// src/app/api/org/route.ts
import { NextRequest, NextResponse } from "next/server"
import { safeAuth } from "@/lib/test-auth"
import { getUser } from "@/lib/users"
import { createOrg, getUserOrgs } from "@/lib/orgs"

export async function GET() {
  const session = await safeAuth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const orgs = await getUserOrgs(session.user.id)
  return NextResponse.json({ orgs })
}

export async function POST(req: NextRequest) {
  const session = await safeAuth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { name } = await req.json() as { name: string }
  if (!name?.trim()) {
    return NextResponse.json({ error: "name required" }, { status: 400 })
  }

  const profile = await getUser(session.user.id)
  if (!profile) {
    return NextResponse.json({ error: "User not found" }, { status: 404 })
  }

  const org = await createOrg(
    name.trim(),
    session.user.id,
    profile.displayName,
    profile.elo
  )

  return NextResponse.json(org, { status: 201 })
}
```

- [ ] Create `src/app/api/org/join/route.ts`

```typescript
// src/app/api/org/join/route.ts
import { NextRequest, NextResponse } from "next/server"
import { safeAuth } from "@/lib/test-auth"
import { getUser } from "@/lib/users"
import { joinOrg } from "@/lib/orgs"

export async function POST(req: NextRequest) {
  const session = await safeAuth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { inviteCode } = await req.json() as { inviteCode: string }
  if (!inviteCode?.trim()) {
    return NextResponse.json({ error: "inviteCode required" }, { status: 400 })
  }

  const profile = await getUser(session.user.id)
  if (!profile) {
    return NextResponse.json({ error: "User not found" }, { status: 404 })
  }

  const result = await joinOrg(
    inviteCode.trim().toUpperCase(),
    session.user.id,
    profile.displayName,
    profile.elo
  )

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }

  return NextResponse.json({ success: true, orgId: result.orgId })
}
```

- [ ] Create `src/app/api/org/[id]/route.ts`

```typescript
// src/app/api/org/[id]/route.ts
import { NextRequest, NextResponse } from "next/server"
import { getOrg } from "@/lib/orgs"

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const result = await getOrg(id)

  if (!result.org) {
    return NextResponse.json({ error: "Org not found" }, { status: 404 })
  }

  return NextResponse.json(result)
}
```

- [ ] Create `src/app/api/org/[id]/leaderboard/route.ts`

```typescript
// src/app/api/org/[id]/leaderboard/route.ts
import { NextRequest, NextResponse } from "next/server"
import { getOrgLeaderboard } from "@/lib/orgs"

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const players = await getOrgLeaderboard(id)
  return NextResponse.json({ players })
}
```

- [ ] Create `src/app/api/org/[id]/invite/route.ts`

```typescript
// src/app/api/org/[id]/invite/route.ts
import { NextRequest, NextResponse } from "next/server"
import { safeAuth } from "@/lib/test-auth"
import { regenerateInviteCode } from "@/lib/orgs"

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await safeAuth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  const result = await regenerateInviteCode(id, session.user.id)

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: result.error === "Forbidden" ? 403 : 404 })
  }

  return NextResponse.json({ inviteCode: result.inviteCode })
}
```

- [ ] Commit: `git add src/lib/orgs.ts src/app/api/org/ && git commit -m "feat: org/team core logic and CRUD API routes"`

---

## Task 5 — Org Pages + LeaderboardTabs

### Files
- `src/app/(social)/org/page.tsx`
- `src/app/(social)/org/[id]/page.tsx`
- `src/components/leaderboard/LeaderboardTabs.tsx` (modify)

### Steps

- [ ] Create `src/app/(social)/org/page.tsx`

```typescript
// src/app/(social)/org/page.tsx
"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

type OrgEntry = {
  orgId: string
  orgName: string
  joinedAt: number
}

export default function MyOrgsPage() {
  const router = useRouter()
  const [orgs, setOrgs] = useState<OrgEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState("")
  const [joinCode, setJoinCode] = useState("")
  const [creating, setCreating] = useState(false)
  const [joining, setJoining] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch("/api/org")
      .then((r) => r.json())
      .then((d) => {
        setOrgs(d.orgs ?? [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  async function handleCreate() {
    if (!newName.trim()) return
    setCreating(true)
    setError(null)
    const res = await fetch("/api/org", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim() }),
    })
    const data = await res.json()
    if (!res.ok) {
      setError(data.error ?? "Failed to create org")
      setCreating(false)
      return
    }
    router.push(`/org/${data.orgId}`)
  }

  async function handleJoin() {
    if (!joinCode.trim()) return
    setJoining(true)
    setError(null)
    const res = await fetch("/api/org/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inviteCode: joinCode.trim() }),
    })
    const data = await res.json()
    if (!res.ok) {
      setError(data.error ?? "Failed to join org")
      setJoining(false)
      return
    }
    router.push(`/org/${data.orgId}`)
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-xl px-4 py-8">
        <p className="text-white/50">Loading...</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-xl space-y-8 px-4 py-8">
      <h1 className="text-2xl font-bold text-white">My Orgs</h1>

      {orgs.length === 0 ? (
        <p className="text-sm text-white/40">You are not a member of any org yet.</p>
      ) : (
        <div className="space-y-3">
          {orgs.map((o) => (
            <Card key={o.orgId} className="border-white/10 bg-white/5">
              <CardHeader className="pb-2">
                <CardTitle className="text-white">{o.orgName}</CardTitle>
              </CardHeader>
              <CardContent>
                <Button size="sm" variant="outline" asChild>
                  <Link href={`/org/${o.orgId}`}>View</Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {error && (
        <p className="rounded-lg border border-red-500/30 bg-red-900/20 px-4 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      <div className="grid gap-6 sm:grid-cols-2">
        {/* Create org */}
        <div className="space-y-3 rounded-xl border border-white/10 bg-white/5 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-white/50">
            Create Org
          </h2>
          <div className="space-y-2">
            <Label htmlFor="org-name" className="text-white/70">
              Org Name
            </Label>
            <Input
              id="org-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Acme Corp"
              className="bg-white/5 text-white"
            />
          </div>
          <Button onClick={handleCreate} disabled={creating || !newName.trim()} className="w-full">
            {creating ? "Creating..." : "Create"}
          </Button>
        </div>

        {/* Join org */}
        <div className="space-y-3 rounded-xl border border-white/10 bg-white/5 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-white/50">
            Join Org
          </h2>
          <div className="space-y-2">
            <Label htmlFor="invite-code" className="text-white/70">
              Invite Code
            </Label>
            <Input
              id="invite-code"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              placeholder="ABCD1234"
              maxLength={8}
              className="bg-white/5 font-mono text-white"
            />
          </div>
          <Button onClick={handleJoin} disabled={joining || !joinCode.trim()} variant="outline" className="w-full">
            {joining ? "Joining..." : "Join"}
          </Button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] Create `src/app/(social)/org/[id]/page.tsx`

```typescript
// src/app/(social)/org/[id]/page.tsx
"use client"

import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import { useSession } from "next-auth/react"
import { Button } from "@/components/ui/button"
import { LeaderboardTable } from "@/components/leaderboard/LeaderboardTable"
import type { Org, OrgMember } from "@/lib/orgs"

type LeaderboardPlayer = {
  userId: string
  displayName: string
  elo: number
}

export default function OrgDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { data: session } = useSession()
  const [org, setOrg] = useState<Org | null>(null)
  const [members, setMembers] = useState<OrgMember[]>([])
  const [leaderboard, setLeaderboard] = useState<LeaderboardPlayer[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      fetch(`/api/org/${id}`).then((r) => r.json()),
      fetch(`/api/org/${id}/leaderboard`).then((r) => r.json()),
    ]).then(([orgData, lbData]) => {
      setOrg(orgData.org ?? null)
      setMembers(orgData.members ?? [])
      setLeaderboard(lbData.players ?? [])
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [id])

  async function handleRegenerateInvite() {
    const res = await fetch(`/api/org/${id}/invite`, { method: "POST" })
    const data = await res.json()
    if (res.ok && data.inviteCode) {
      setOrg((prev) => prev ? { ...prev, inviteCode: data.inviteCode } : prev)
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-8">
        <p className="text-white/50">Loading...</p>
      </div>
    )
  }

  if (!org) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-8">
        <p className="text-white/50">Org not found.</p>
      </div>
    )
  }

  const isAdmin = session?.user?.id === org.adminId

  return (
    <div className="mx-auto max-w-2xl space-y-8 px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">{org.name}</h1>
        <span className="text-xs text-white/40">{members.length} members</span>
      </div>

      {/* Invite code — admin only */}
      {isAdmin && (
        <div className="rounded-xl border border-white/10 bg-white/5 p-5">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-white/50">
            Invite Code
          </h2>
          <div className="flex items-center gap-3">
            <span className="rounded-lg border border-white/20 bg-white/10 px-4 py-2 font-mono text-lg text-white tracking-widest">
              {org.inviteCode}
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => navigator.clipboard.writeText(org.inviteCode)}
            >
              Copy
            </Button>
            <Button size="sm" variant="outline" onClick={handleRegenerateInvite}>
              Regenerate
            </Button>
          </div>
        </div>
      )}

      {/* Leaderboard */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-white/50">
          Leaderboard
        </h2>
        {leaderboard.length === 0 ? (
          <p className="text-sm text-white/40">No rankings yet.</p>
        ) : (
          <LeaderboardTable
            players={leaderboard.map((p, i) => ({
              ...p,
              rank: i + 1,
              gamesPlayed: 0,
              gamesWon: 0,
              avatar: null,
            }))}
            currentUserId={session?.user?.id}
          />
        )}
      </div>

      {/* Member list */}
      <div className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-white/50">
          Members
        </h2>
        <div className="divide-y divide-white/5 rounded-xl border border-white/10 overflow-hidden">
          {members.map((m) => (
            <div key={m.userId} className="flex items-center justify-between px-4 py-3">
              <div>
                <p className="text-sm font-medium text-white">{m.displayName}</p>
                <p className="text-xs text-white/40">{m.role}</p>
              </div>
              <span className="font-mono text-sm text-white/60">{m.elo} Elo</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
```

- [ ] Modify `src/components/leaderboard/LeaderboardTabs.tsx` — add "My Org" tab when the user belongs to an org:

```typescript
// src/components/leaderboard/LeaderboardTabs.tsx
"use client"

import { Tabs } from "@base-ui/react/tabs"
import { LeaderboardTable } from "@/components/leaderboard/LeaderboardTable"
import type { LeaderboardPlayer } from "@/app/api/leaderboard/route"

type LeaderboardTabsProps = {
  globalPlayers: LeaderboardPlayer[]
  seasonPlayers: LeaderboardPlayer[]
  orgPlayers?: LeaderboardPlayer[]
  currentUserId?: string
  seasonName: string
  orgName?: string
}

export function LeaderboardTabs({
  globalPlayers,
  seasonPlayers,
  orgPlayers,
  currentUserId,
  seasonName,
  orgName,
}: LeaderboardTabsProps) {
  return (
    <Tabs.Root defaultValue="alltime" className="space-y-4">
      <Tabs.List className="flex gap-1 rounded-lg border border-white/10 bg-white/5 p-1 w-fit">
        <Tabs.Tab
          value="alltime"
          className="px-4 py-1.5 text-sm font-medium rounded-md transition-colors
            text-white/60 hover:text-white/80
            data-[selected]:bg-white/10 data-[selected]:text-white"
        >
          All Time
        </Tabs.Tab>
        <Tabs.Tab
          value="season"
          className="px-4 py-1.5 text-sm font-medium rounded-md transition-colors
            text-white/60 hover:text-white/80
            data-[selected]:bg-white/10 data-[selected]:text-white"
        >
          {seasonName}
        </Tabs.Tab>
        {orgPlayers && orgPlayers.length > 0 && (
          <Tabs.Tab
            value="org"
            className="px-4 py-1.5 text-sm font-medium rounded-md transition-colors
              text-white/60 hover:text-white/80
              data-[selected]:bg-white/10 data-[selected]:text-white"
          >
            {orgName ?? "My Org"}
          </Tabs.Tab>
        )}
      </Tabs.List>

      <Tabs.Panel value="alltime" className="focus:outline-none">
        <LeaderboardTable players={globalPlayers} currentUserId={currentUserId} />
      </Tabs.Panel>

      <Tabs.Panel value="season" className="focus:outline-none">
        {seasonPlayers.length === 0 ? (
          <div className="rounded-xl border border-white/10 bg-white/5 px-6 py-16 text-center">
            <p className="text-white/50">No season rankings yet.</p>
            <p className="mt-1 text-sm text-white/30">
              Play a game during {seasonName} to appear here!
            </p>
          </div>
        ) : (
          <LeaderboardTable players={seasonPlayers} currentUserId={currentUserId} />
        )}
      </Tabs.Panel>

      {orgPlayers && orgPlayers.length > 0 && (
        <Tabs.Panel value="org" className="focus:outline-none">
          <LeaderboardTable players={orgPlayers} currentUserId={currentUserId} />
        </Tabs.Panel>
      )}
    </Tabs.Root>
  )
}
```

- [ ] Update `src/app/(social)/leaderboard/page.tsx` to fetch org leaderboard when `session.user.id` belongs to an org (pass `orgPlayers` and `orgName` to `LeaderboardTabs`).

  Fetch the user's first org via `GET /api/org`, then if present fetch `GET /api/org/[orgId]/leaderboard`. Pass results as `orgPlayers` and `orgName` props.

- [ ] Commit: `git add src/app/\(social\)/org/ src/components/leaderboard/LeaderboardTabs.tsx && git commit -m "feat: org pages, leaderboard My Org tab"`

---

## Task 6 — API Token for VS Code

### Files
- `src/lib/api-token.ts`
- `src/app/api/user/token/route.ts`
- `src/app/api/bugs/random/route.ts` (modify)
- `src/app/(social)/profile/page.tsx` (modify)

### Steps

- [ ] Create `src/lib/api-token.ts`

```typescript
// src/lib/api-token.ts
import crypto from "crypto"
import bcrypt from "bcryptjs"
import { getItem, putItem, deleteItem, queryItems } from "@/lib/dynamodb"

// ---------------------------------------------------------------------------
// generateApiToken
// ---------------------------------------------------------------------------

export async function generateApiToken(userId: string): Promise<string> {
  const rawToken = crypto.randomBytes(32).toString("hex")
  const hashed = await bcrypt.hash(rawToken, 10)
  const now = Date.now()

  await putItem({
    pk: `USER#${userId}`,
    sk: "API_TOKEN",
    userId,
    token: hashed,
    createdAt: now,
    // Token is non-expiring; user can revoke manually
  })

  // Return the raw token once — never stored in plain text
  return rawToken
}

// ---------------------------------------------------------------------------
// validateApiToken
// ---------------------------------------------------------------------------

export async function validateApiToken(
  rawToken: string
): Promise<string | null> {
  // rawToken format: "<userId>.<hex>" or plain hex
  // For plain hex we must scan USER#*/API_TOKEN — expensive.
  // Use format: "<userId>.<hex>" so we can do O(1) lookup.
  const dotIndex = rawToken.indexOf(".")
  if (dotIndex === -1) return null

  const userId = rawToken.slice(0, dotIndex)
  const hex = rawToken.slice(dotIndex + 1)

  const item = await getItem(`USER#${userId}`, "API_TOKEN")
  if (!item) return null

  const valid = await bcrypt.compare(hex, item.token as string)
  return valid ? userId : null
}

// ---------------------------------------------------------------------------
// revokeApiToken
// ---------------------------------------------------------------------------

export async function revokeApiToken(userId: string): Promise<void> {
  await deleteItem(`USER#${userId}`, "API_TOKEN")
}

// ---------------------------------------------------------------------------
// hasApiToken
// ---------------------------------------------------------------------------

export async function hasApiToken(userId: string): Promise<boolean> {
  const item = await getItem(`USER#${userId}`, "API_TOKEN")
  return item !== null
}
```

- [ ] Create `src/app/api/user/token/route.ts`

```typescript
// src/app/api/user/token/route.ts
import { NextResponse } from "next/server"
import { safeAuth } from "@/lib/test-auth"
import { generateApiToken, revokeApiToken, hasApiToken } from "@/lib/api-token"

export async function GET() {
  const session = await safeAuth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const userId = session.user.id
  const exists = await hasApiToken(userId)

  if (!exists) {
    // Auto-generate on first visit so user always has a token to copy
    const rawToken = await generateApiToken(userId)
    // Return prefixed token: userId.hex
    return NextResponse.json({
      token: `${userId}.${rawToken}`,
      isNew: true,
    })
  }

  // Token exists — return masked version (show last 8 chars)
  return NextResponse.json({
    token: null, // raw token was shown once at creation; cannot re-display
    masked: "••••••••••••••••••••••••••••••••",
    exists: true,
  })
}

export async function POST() {
  const session = await safeAuth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const userId = session.user.id
  const rawToken = await generateApiToken(userId)

  return NextResponse.json({ token: `${userId}.${rawToken}`, isNew: true })
}

export async function DELETE() {
  const session = await safeAuth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  await revokeApiToken(session.user.id)
  return NextResponse.json({ success: true })
}
```

- [ ] Modify `src/app/api/bugs/random/route.ts` — accept `Authorization: Bearer <token>` as an auth alternative:

  In the `GET` handler, before calling `safeAuth()`, check for `request.headers.get("authorization")`. If it starts with `"Bearer "`, strip the prefix and call `validateApiToken(raw)`. If that returns a userId, use it directly as the authenticated user (skip session auth). Existing logic for `bugsSeen` already uses `session?.user?.id`, so just assign the resolved userId into the same variable.

  Key addition at the top of the handler (before the current `safeAuth()` call):

```typescript
// Bearer token auth for VS Code extension
let resolvedUserId: string | null = null
const authHeader = request.headers.get("authorization") ?? ""
if (authHeader.startsWith("Bearer ")) {
  const raw = authHeader.slice(7)
  resolvedUserId = await validateApiToken(raw)
}
// Fall back to session cookie auth
if (!resolvedUserId) {
  const session = (await safeAuth()) ?? await getTestSessionFromCookies()
  resolvedUserId = session?.user?.id ?? null
}
```

  Then replace the two `session?.user?.id` references with `resolvedUserId`.

  Add import: `import { validateApiToken } from "@/lib/api-token"`

- [ ] Add API Token section to `src/app/(social)/profile/page.tsx`:

  Add a new `ApiTokenSection` client component inside `profile/page.tsx` (or as a separate file imported there). It:
  - On mount calls `GET /api/user/token`
  - If `isNew === true`, shows the full token in a copyable `<code>` block with a warning "Store this token securely — it will not be shown again."
  - If `exists === true`, shows masked token + "Regenerate" button (calls `POST /api/user/token`) + "Revoke" button (calls `DELETE /api/user/token`).
  - Renders below the existing stats section with header "VS Code Extension Token".

- [ ] Commit: `git add src/lib/api-token.ts src/app/api/user/token/ src/app/api/bugs/random/route.ts src/app/\(social\)/profile/page.tsx && git commit -m "feat: API token generation, Bearer auth on /api/bugs/random, profile token UI"`

---

## Task 7 — VS Code Extension

### Files
- `vscode-extension/package.json`
- `vscode-extension/src/extension.ts`
- `vscode-extension/src/BugPanel.ts`
- `vscode-extension/src/api.ts`
- `scripts/build-extension.sh`

### Steps

- [ ] Run `mkdir -p vscode-extension/src` to create the directory structure, then create `vscode-extension/package.json`:

```json
{
  "name": "vscode-bughunt",
  "displayName": "BugHunt",
  "description": "Practice debugging challenges from BugHunt directly in VS Code",
  "version": "0.1.0",
  "publisher": "bughunt",
  "engines": { "vscode": "^1.85.0" },
  "categories": ["Education", "Other"],
  "activationEvents": [],
  "main": "./out/extension.js",
  "contributes": {
    "commands": [
      {
        "command": "bughunt.startPractice",
        "title": "BugHunt: Start Practice"
      },
      {
        "command": "bughunt.dailyChallenge",
        "title": "BugHunt: Daily Challenge"
      },
      {
        "command": "bughunt.myStats",
        "title": "BugHunt: My Stats"
      }
    ],
    "configuration": {
      "title": "BugHunt",
      "properties": {
        "bughunt.apiToken": {
          "type": "string",
          "default": "",
          "description": "Your BugHunt API token (get it from https://bughunt.vercel.app/profile)"
        },
        "bughunt.apiBase": {
          "type": "string",
          "default": "https://bughunt.vercel.app",
          "description": "BugHunt API base URL"
        }
      }
    }
  },
  "scripts": {
    "compile": "tsc -p ./",
    "watch": "tsc -watch -p ./",
    "package": "npx @vscode/vsce package"
  },
  "devDependencies": {
    "@types/vscode": "^1.85.0",
    "@vscode/vsce": "^2.22.0",
    "typescript": "^5.3.0"
  }
}
```

- [ ] Create `vscode-extension/src/api.ts`

```typescript
// vscode-extension/src/api.ts

export interface BugQuestion {
  bugId: string
  language: string
  category: string
  difficulty: number
  buggyCode: string
  bugLine: number
  options: [string, string, string, string]
  hint: string
}

export interface BugReveal extends BugQuestion {
  correctAnswer: number
  explanation: string
  correctCode: string
}

export async function fetchRandomBug(
  apiBase: string,
  token: string,
  language?: string
): Promise<BugQuestion> {
  const url = new URL(`${apiBase}/api/bugs/random`)
  if (language) url.searchParams.set("language", language)

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`)
  }

  return res.json() as Promise<BugQuestion>
}

export async function fetchBugReveal(
  apiBase: string,
  token: string,
  bugId: string
): Promise<BugReveal> {
  const url = new URL(`${apiBase}/api/bugs/random`)
  url.searchParams.set("reveal", "1")
  url.searchParams.set("bugId", bugId)

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`)
  }

  return res.json() as Promise<BugReveal>
}

export async function fetchDailyChallenge(
  apiBase: string,
  token: string
): Promise<BugQuestion> {
  const res = await fetch(`${apiBase}/api/daily`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`)
  }

  return res.json() as Promise<BugQuestion>
}

export async function fetchUserStats(
  apiBase: string,
  token: string
): Promise<{ elo: number; rank: string; currentStreak: number }> {
  const res = await fetch(`${apiBase}/api/user/profile`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<{ elo: number; rank: string; currentStreak: number }>
}
```

- [ ] Create `vscode-extension/src/BugPanel.ts`

```typescript
// vscode-extension/src/BugPanel.ts
import * as vscode from "vscode"
import type { BugQuestion, BugReveal } from "./api"
import { fetchBugReveal } from "./api"

const OPTION_LABELS = ["A", "B", "C", "D"] as const

export class BugPanel {
  public static currentPanel: BugPanel | undefined
  private readonly _panel: vscode.WebviewPanel
  private _bug: BugQuestion | null = null
  private _apiBase: string
  private _token: string
  private _disposables: vscode.Disposable[] = []

  private constructor(
    panel: vscode.WebviewPanel,
    apiBase: string,
    token: string
  ) {
    this._panel = panel
    this._apiBase = apiBase
    this._token = token

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables)
    this._panel.webview.onDidReceiveMessage(
      async (msg: { type: string; answer?: number }) => {
        if (msg.type === "answer" && this._bug && msg.answer !== undefined) {
          await this._handleAnswer(msg.answer)
        }
        if (msg.type === "next") {
          vscode.commands.executeCommand("bughunt.startPractice")
        }
      },
      null,
      this._disposables
    )
  }

  public static createOrShow(
    extensionUri: vscode.Uri,
    apiBase: string,
    token: string
  ): BugPanel {
    const column = vscode.ViewColumn.Beside

    if (BugPanel.currentPanel) {
      BugPanel.currentPanel._panel.reveal(column)
      BugPanel.currentPanel._apiBase = apiBase
      BugPanel.currentPanel._token = token
      return BugPanel.currentPanel
    }

    const panel = vscode.window.createWebviewPanel(
      "bughunt",
      "BugHunt Practice",
      column,
      {
        enableScripts: true,
        localResourceRoots: [extensionUri],
      }
    )

    BugPanel.currentPanel = new BugPanel(panel, apiBase, token)
    return BugPanel.currentPanel
  }

  public showBug(bug: BugQuestion): void {
    this._bug = bug
    this._panel.webview.html = this._getLoadedHtml(bug)
  }

  public showLoading(): void {
    this._panel.webview.html = this._getLoadingHtml()
  }

  public showError(msg: string): void {
    this._panel.webview.html = this._getErrorHtml(msg)
  }

  private async _handleAnswer(answerIdx: number): Promise<void> {
    if (!this._bug) return
    const reveal = await fetchBugReveal(this._apiBase, this._token, this._bug.bugId).catch(
      () => null
    )
    if (!reveal) return
    const correct = answerIdx === reveal.correctAnswer
    this._panel.webview.html = this._getRevealHtml(reveal, answerIdx, correct)
  }

  private _getLoadingHtml(): string {
    return `<!DOCTYPE html><html><body style="background:#0d0d1a;color:#fff;font-family:sans-serif;padding:2rem;">
      <p>Loading bug...</p></body></html>`
  }

  private _getErrorHtml(msg: string): string {
    return `<!DOCTYPE html><html><body style="background:#0d0d1a;color:#f87171;font-family:sans-serif;padding:2rem;">
      <p>${msg}</p></body></html>`
  }

  private _getLoadedHtml(bug: BugQuestion): string {
    const escaped = bug.buggyCode
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")

    const lines = escaped.split("\n")
    const codeLines = lines
      .map((line, i) => {
        const num = i + 1
        const highlight = num === bug.bugLine
          ? 'style="background:#7f1d1d40;display:block;"'
          : ""
        return `<span ${highlight}>${String(num).padStart(3, " ")}  ${line}</span>`
      })
      .join("\n")

    const optionButtons = bug.options
      .map(
        (opt, i) =>
          `<button onclick="pick(${i})" data-idx="${i}" style="display:block;width:100%;margin:6px 0;padding:10px 14px;background:#1e1e3a;border:1px solid #ffffff25;border-radius:8px;color:#e2e8f0;text-align:left;cursor:pointer;font-size:13px;">
            <strong style="color:#94a3b8">${OPTION_LABELS[i]}.</strong> ${opt.replace(/</g, "&lt;")}
          </button>`
      )
      .join("")

    return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><style>
  body{background:#0d0d1a;color:#e2e8f0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:1.5rem;margin:0}
  pre{background:#11112a;border:1px solid #ffffff15;border-radius:8px;padding:1rem;overflow-x:auto;font-size:12px;line-height:1.7}
  h2{font-size:14px;text-transform:uppercase;letter-spacing:.1em;color:#64748b;margin-top:1.5rem}
  .badge{display:inline-block;background:#1e1e3a;border:1px solid #ffffff20;border-radius:4px;padding:2px 8px;font-size:11px;color:#94a3b8;margin-right:6px}
  .hint{font-size:12px;color:#64748b;margin-top:.5rem}
</style></head>
<body>
  <div><span class="badge">${bug.language}</span><span class="badge">Difficulty ${bug.difficulty}</span><span class="badge">${bug.category}</span></div>
  <pre><code>${codeLines}</code></pre>
  <p class="hint">Hint: ${bug.hint.replace(/</g, "&lt;")}</p>
  <h2>What is the bug?</h2>
  <div id="options">${optionButtons}</div>
<script>
  const vscode = acquireVsCodeApi();
  function pick(idx) {
    document.querySelectorAll('button').forEach(b => b.disabled = true);
    vscode.postMessage({ type: 'answer', answer: idx });
  }
</script>
</body></html>`
  }

  private _getRevealHtml(
    reveal: BugReveal,
    userAnswer: number,
    correct: boolean
  ): string {
    const correctLabel = OPTION_LABELS[reveal.correctAnswer]
    const userLabel = OPTION_LABELS[userAnswer]

    return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><style>
  body{background:#0d0d1a;color:#e2e8f0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:1.5rem;margin:0}
  .banner{padding:1rem 1.5rem;border-radius:10px;margin-bottom:1rem;font-size:1.1rem;font-weight:700}
  .win{background:#14532d40;border:1px solid #16a34a60;color:#86efac}
  .loss{background:#7f1d1d40;border:1px solid #dc262660;color:#fca5a5}
  pre{background:#11112a;border:1px solid #ffffff15;border-radius:8px;padding:1rem;overflow-x:auto;font-size:12px;line-height:1.7}
  .expl{background:#1e1e3a;border:1px solid #ffffff10;border-radius:8px;padding:1rem;font-size:13px;color:#cbd5e1;margin-top:1rem}
  button{margin-top:1.5rem;padding:10px 24px;background:#3b82f6;border:none;border-radius:8px;color:#fff;font-size:14px;cursor:pointer}
</style></head>
<body>
  <div class="banner ${correct ? "win" : "loss"}">${correct ? "Correct!" : "Incorrect"}</div>
  <p style="font-size:13px;color:#94a3b8">
    Your answer: <strong>${userLabel}. ${reveal.options[userAnswer].replace(/</g, "&lt;")}</strong><br>
    Correct answer: <strong>${correctLabel}. ${reveal.options[reveal.correctAnswer].replace(/</g, "&lt;")}</strong>
  </p>
  <div class="expl">${reveal.explanation.replace(/</g, "&lt;")}</div>
  <button onclick="next()">Next Bug</button>
<script>
  const vscode = acquireVsCodeApi();
  function next() { vscode.postMessage({ type: 'next' }); }
</script>
</body></html>`
  }

  public dispose(): void {
    BugPanel.currentPanel = undefined
    this._panel.dispose()
    while (this._disposables.length) {
      const d = this._disposables.pop()
      if (d) d.dispose()
    }
  }
}
```

- [ ] Create `vscode-extension/src/extension.ts`

```typescript
// vscode-extension/src/extension.ts
import * as vscode from "vscode"
import { BugPanel } from "./BugPanel"
import {
  fetchRandomBug,
  fetchDailyChallenge,
  fetchUserStats,
} from "./api"

function getConfig(): { apiBase: string; token: string } {
  const cfg = vscode.workspace.getConfiguration("bughunt")
  return {
    apiBase: (cfg.get<string>("apiBase") ?? "https://bughunt.vercel.app").replace(/\/$/, ""),
    token: cfg.get<string>("apiToken") ?? "",
  }
}

function requireToken(token: string): boolean {
  if (!token) {
    vscode.window
      .showErrorMessage(
        "BugHunt: No API token set. Add your token in Settings > BugHunt.",
        "Open Settings"
      )
      .then((choice) => {
        if (choice === "Open Settings") {
          vscode.commands.executeCommand("workbench.action.openSettings", "bughunt.apiToken")
        }
      })
    return false
  }
  return true
}

export function activate(context: vscode.ExtensionContext): void {
  // Command: Start Practice
  context.subscriptions.push(
    vscode.commands.registerCommand("bughunt.startPractice", async () => {
      const { apiBase, token } = getConfig()
      if (!requireToken(token)) return

      // Detect language of current active file
      const lang = vscode.window.activeTextEditor?.document.languageId

      const panel = BugPanel.createOrShow(context.extensionUri, apiBase, token)
      panel.showLoading()

      try {
        const bug = await fetchRandomBug(apiBase, token, lang)
        panel.showBug(bug)
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        panel.showError(`Failed to load bug: ${msg}`)
        vscode.window.showErrorMessage(`BugHunt: ${msg}`)
      }
    })
  )

  // Command: Daily Challenge
  context.subscriptions.push(
    vscode.commands.registerCommand("bughunt.dailyChallenge", async () => {
      const { apiBase, token } = getConfig()
      if (!requireToken(token)) return

      const panel = BugPanel.createOrShow(context.extensionUri, apiBase, token)
      panel.showLoading()

      try {
        const bug = await fetchDailyChallenge(apiBase, token)
        panel.showBug(bug)
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        panel.showError(`Failed to load daily challenge: ${msg}`)
        vscode.window.showErrorMessage(`BugHunt: ${msg}`)
      }
    })
  )

  // Command: My Stats
  context.subscriptions.push(
    vscode.commands.registerCommand("bughunt.myStats", async () => {
      const { apiBase, token } = getConfig()
      if (!requireToken(token)) return

      try {
        const stats = await fetchUserStats(apiBase, token)
        vscode.window.showInformationMessage(
          `BugHunt — Elo: ${stats.elo} | Rank: ${stats.rank} | Streak: ${stats.currentStreak}`
        )
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        vscode.window.showErrorMessage(`BugHunt: ${msg}`)
      }
    })
  )
}

export function deactivate(): void {
  // Nothing to clean up
}
```

- [ ] Create `scripts/build-extension.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
EXT_DIR="${ROOT_DIR}/vscode-extension"

echo "Building BugHunt VS Code Extension..."
cd "${EXT_DIR}"

npm install
npx tsc -p ./
npx @vscode/vsce package

echo "Done. Install locally with:"
echo "  code --install-extension ${EXT_DIR}/vscode-bughunt-*.vsix"
```

- [ ] Make build script executable: `chmod +x scripts/build-extension.sh`

- [ ] Commit: `git add vscode-extension/ scripts/build-extension.sh && git commit -m "feat: VS Code extension — BugPanel webview, commands, api.ts, build script"`

---

## Task 8 — Bug Difficulty Ratings

### Files
- `src/app/api/bugs/[id]/rate/route.ts`
- `src/app/api/admin/bugs/health/route.ts`
- `src/components/game/RatingWidget.tsx` (new)
- `src/components/game/GameResult.tsx` (modify)
- `src/app/(game)/practice/page.tsx` (modify)
- `src/app/admin/page.tsx` (modify)

### Steps

- [ ] Create `src/app/api/bugs/[id]/rate/route.ts`

```typescript
// src/app/api/bugs/[id]/rate/route.ts
import { NextRequest, NextResponse } from "next/server"
import { safeAuth } from "@/lib/test-auth"
import { putItemIfNotExists, ddb, TABLE_NAME } from "@/lib/dynamodb"
import { UpdateCommand } from "@aws-sdk/lib-dynamodb"

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await safeAuth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id: bugId } = await params
  const userId = session.user.id

  const { rating } = await req.json() as { rating: number }
  if (rating !== 1 && rating !== 2 && rating !== 3) {
    return NextResponse.json(
      { error: "rating must be 1 (too easy), 2 (fair), or 3 (too hard)" },
      { status: 400 }
    )
  }

  const now = Date.now()

  // Write rating item — idempotent: only one rating per bug per user
  const written = await putItemIfNotExists({
    pk: `BUG#${bugId}`,
    sk: `RATING#${userId}`,
    bugId,
    userId,
    rating,
    createdAt: now,
  })

  if (!written) {
    // Already rated — return success without double-counting
    return NextResponse.json({ success: true, alreadyRated: true })
  }

  // Atomically increment aggregate on BUG#id/META
  await ddb.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { pk: `BUG#${bugId}`, sk: "META" },
      UpdateExpression: "ADD #rc :one, #rs :r",
      ExpressionAttributeNames: {
        "#rc": "ratingCount",
        "#rs": "ratingSum",
      },
      ExpressionAttributeValues: {
        ":one": 1,
        ":r": rating,
      },
    })
  )

  return NextResponse.json({ success: true })
}
```

- [ ] Create `src/app/api/admin/bugs/health/route.ts`

```typescript
// src/app/api/admin/bugs/health/route.ts
import { NextResponse } from "next/server"
import { safeAuth } from "@/lib/test-auth"
import { getAllBugs } from "@/lib/bugs"

export async function GET() {
  const session = await safeAuth()
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const adminEmails = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())

  if (!adminEmails.includes(session.user.email.toLowerCase())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const bugs = await getAllBugs()

  // Compute ratingAvg and deviation score |ratingAvg - 2|
  const report = bugs
    .filter((b) => (b.ratingCount ?? 0) > 0)
    .map((b) => {
      const ratingCount = (b.ratingCount as number) ?? 0
      const ratingSum = (b.ratingSum as number) ?? 0
      const ratingAvg = ratingCount > 0 ? ratingSum / ratingCount : 2
      const deviation = Math.abs(ratingAvg - 2)
      return {
        bugId: b.bugId,
        language: b.language,
        category: b.category,
        difficulty: b.difficulty,
        ratingCount,
        ratingAvg: Math.round(ratingAvg * 100) / 100,
        deviation: Math.round(deviation * 100) / 100,
      }
    })
    .sort((a, b) => b.deviation - a.deviation)

  return NextResponse.json({ bugs: report })
}
```

  Note: `getAllBugs` may not exist yet in `src/lib/bugs.ts`. Add a simple `getAllBugs` export there that reads the `BUG#INDEX/META` item and fetches all bugs by their IDs. If a batch-fetch helper is needed, use `Promise.all` over `getItem` calls on `BUG#<id>/META`.

- [ ] Create `src/components/game/RatingWidget.tsx`

```typescript
// src/components/game/RatingWidget.tsx
"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"

interface RatingWidgetProps {
  bugId: string
}

const RATINGS = [
  { value: 1, label: "Too Easy", emoji: "😴" },
  { value: 2, label: "Fair", emoji: "👍" },
  { value: 3, label: "Too Hard", emoji: "🤯" },
] as const

export function RatingWidget({ bugId }: RatingWidgetProps) {
  const [submitted, setSubmitted] = useState(false)
  const [selected, setSelected] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleRate(rating: number) {
    if (submitted || loading) return
    setSelected(rating)
    setLoading(true)

    await fetch(`/api/bugs/${bugId}/rate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rating }),
    })

    setLoading(false)
    setSubmitted(true)
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <p className="mb-3 text-sm font-medium text-white/60">
        Was this bug&apos;s difficulty fair?
      </p>
      {submitted ? (
        <p className="text-sm text-green-400">
          Thanks for your feedback!
        </p>
      ) : (
        <div className="flex gap-2">
          {RATINGS.map(({ value, label, emoji }) => (
            <Button
              key={value}
              size="sm"
              variant={selected === value ? "default" : "outline"}
              onClick={() => handleRate(value)}
              disabled={loading}
              className="flex-1 gap-1"
            >
              <span>{emoji}</span>
              <span className="hidden sm:inline">{label}</span>
            </Button>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] Modify `src/components/game/GameResult.tsx` — add `RatingWidget` below the Answer Breakdown section:

  - Add `import { RatingWidget } from "@/components/game/RatingWidget"` near the top imports.
  - Add a `bugId` prop to `GameResultProps`: `bugId: string`.
  - Render `<RatingWidget bugId={bugId} />` after the Answer Breakdown `</div>` block and before the Opponent comparison section.
  - Update all callers of `<GameResult>` to pass `bugId={game.bugId}` (or however the bug ID is available in the result page — check `src/app/game/result/[gameId]/page.tsx`).

- [ ] Modify `src/app/(game)/practice/page.tsx` — add `RatingWidget` after the answer reveal:

  Find the section that renders the reveal/explanation after an answer is submitted. Import `RatingWidget` and render `<RatingWidget bugId={currentBug.bugId} />` below the explanation block, conditioned on `revealed === true`.

- [ ] Add "Bug Health" tab to `src/app/admin/page.tsx`:

  Add a new `BugHealthSection` component inside `admin/page.tsx`. It:
  - Fetches `GET /api/admin/bugs/health` on mount.
  - Renders a table with columns: Language, Category, Difficulty, Avg Rating, Count, Deviation.
  - Rows are sorted by deviation descending (already sorted by API).
  - A "Adjust Difficulty" button per row calls `PATCH /api/admin/bugs/[bugId]` with `{ difficulty: newDiff }` after prompting `window.prompt("New difficulty (1-5):")`.
  - Add a "Bug Health" tab button alongside the existing admin tab controls and conditionally render `<BugHealthSection />` when that tab is active.

- [ ] Commit: `git add src/app/api/bugs/ src/app/api/admin/bugs/health/ src/components/game/RatingWidget.tsx src/components/game/GameResult.tsx src/app/\(game\)/practice/ src/app/admin/ && git commit -m "feat: bug difficulty ratings — rate endpoint, health report, RatingWidget in GameResult and practice page, admin Bug Health tab"`

---

## Implementation Notes

### DynamoDB patterns used (consistent with `src/lib/dynamodb.ts`)
- PK/SK keys are lowercase `pk`/`sk` per the existing table schema.
- `putItemIfNotExists` uses `attribute_not_exists(pk)` condition — already in `src/lib/dynamodb.ts`.
- `queryItems` accepts `begins_with` via `KeyConditionExpression` string; the `expressionAttributeNames` option handles reserved-word aliasing.
- GSI1 (`gsi1pk` / `gsi1sk`) is the existing secondary index name per `src/lib/game.ts` and adjacent files.
- Leaderboard sort keys use `zeroPad(elo, 12)` for lexicographic ordering — match the helper in `src/lib/game.ts`.

### Bearer token format
The API token uses a `<userId>.<hex>` format so the `validateApiToken` function can do an O(1) DynamoDB lookup (`USER#userId/API_TOKEN`) instead of a full-table scan. This must be documented in the profile page UI.

### Vercel Cron
`vercel.json` schedule `"*/5 * * * *"` runs the tournament tick every 5 minutes. The route validates `Authorization: Bearer <CRON_SECRET>` where `CRON_SECRET` is set in Vercel environment variables.

### VS Code Extension distribution
For hackathon demo: `bash scripts/build-extension.sh` produces `vscode-extension/vscode-bughunt-0.1.0.vsix`. Install with `code --install-extension vscode-extension/vscode-bughunt-0.1.0.vsix`. The extension requires Node.js and VS Code 1.85+.

### `getAllBugs` in `src/lib/bugs.ts`
The admin health route calls `getAllBugs()`. Add this export to `src/lib/bugs.ts`:

```typescript
export async function getAllBugs(): Promise<Bug[]> {
  const index = await getBugIndex()
  const allIds = [...index.bugIds, ...index.pendingBugIds]
  const bugs = await Promise.all(allIds.map((id) => getBug(id)))
  return bugs.filter((b): b is Bug => b !== null)
}
```

### Incremental testing order
1. Task 1 + 2: verify tournament creation and registration via `curl` or Postman against local dev server.
2. Task 3: visual check of bracket SVG in browser.
3. Task 4 + 5: create an org, join it, confirm leaderboard tab appears.
4. Task 6: generate a token, call `/api/bugs/random` with `Authorization: Bearer <token>` from curl.
5. Task 7: `bash scripts/build-extension.sh`, install `.vsix`, configure token in VS Code settings, run `BugHunt: Start Practice`.
6. Task 8: play a game to result page, verify rating buttons appear and call the rate endpoint.
