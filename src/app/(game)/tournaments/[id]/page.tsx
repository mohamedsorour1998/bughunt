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
