"use client"

import { cn } from "@/lib/utils"

export interface DuelPlayerInfo {
  displayName: string
  elo: number
  avatar: string | null
}

export type RoundOutcome = "correct" | "wrong" | "current" | "pending"

interface DuelHeaderProps {
  me: DuelPlayerInfo | null
  opponent: DuelPlayerInfo | null
  opponentIsBot: boolean
  currentRound: number
  roundsPerGame: number
  myRoundOutcomes: RoundOutcome[]
  opponentSubmittedRounds: Set<number>
}

function PlayerCard({
  player,
  align,
  fallbackLabel,
  isBot,
}: {
  player: DuelPlayerInfo | null
  align: "left" | "right"
  fallbackLabel: string
  isBot?: boolean
}) {
  const initial = player?.displayName?.charAt(0)?.toUpperCase() ?? "?"
  return (
    <div className={cn("flex min-w-0 items-center gap-3", align === "right" && "flex-row-reverse text-right")}>
      <div className="relative flex size-10 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/10 font-bold text-white">
        {player?.avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={player.avatar} alt="" className="size-10 rounded-full object-cover" />
        ) : (
          initial
        )}
        {isBot && (
          <span className="absolute -bottom-1 -right-1 rounded-full bg-violet-600 px-1 text-[9px] font-bold uppercase leading-3 text-white">
            AI
          </span>
        )}
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-white">
          {player?.displayName ?? fallbackLabel}
        </p>
        <p className="font-mono text-xs text-white/50">{player ? `${player.elo} Elo` : "…"}</p>
      </div>
    </div>
  )
}

function RoundPips({ outcomes }: { outcomes: RoundOutcome[] }) {
  return (
    <div className="flex items-center gap-2" aria-label="Your round results">
      {outcomes.map((o, i) => (
        <span
          key={i}
          className={cn(
            "flex size-6 items-center justify-center rounded-full border text-xs font-bold transition-colors",
            o === "correct" && "border-emerald-500 bg-emerald-500/20 text-emerald-300",
            o === "wrong" && "border-red-500 bg-red-500/20 text-red-300",
            o === "current" && "animate-pulse border-blue-400 bg-blue-500/20 text-blue-200",
            o === "pending" && "border-white/15 bg-white/5 text-white/30"
          )}
        >
          {o === "correct" ? "✓" : o === "wrong" ? "✗" : i + 1}
        </span>
      ))}
    </div>
  )
}

export function DuelHeader({
  me,
  opponent,
  opponentIsBot,
  currentRound,
  roundsPerGame,
  myRoundOutcomes,
  opponentSubmittedRounds,
}: DuelHeaderProps) {
  const opponentSubmitted = opponentSubmittedRounds.has(currentRound)
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <PlayerCard player={me} align="left" fallbackLabel="You" />
        <div className="flex shrink-0 flex-col items-center gap-0.5">
          <span className="font-mono text-[10px] uppercase tracking-widest text-white/30">
            Round {currentRound + 1}/{roundsPerGame}
          </span>
          <span className="text-lg font-black text-white/70">VS</span>
        </div>
        <PlayerCard player={opponent} align="right" fallbackLabel="Opponent" isBot={opponentIsBot} />
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <RoundPips outcomes={myRoundOutcomes} />
        <span
          className={cn(
            "text-xs transition-colors",
            opponentSubmitted ? "font-semibold text-emerald-300" : "text-white/40"
          )}
        >
          {opponentSubmitted ? "Opponent submitted!" : "Opponent thinking..."}
        </span>
      </div>
    </div>
  )
}
