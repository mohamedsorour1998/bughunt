import { cn } from "@/lib/utils"
import { RankBadge } from "@/components/ui/RankBadge"
import { getRankFromElo } from "@/lib/users"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export type LeaderboardPlayer = {
  rank: number
  userId: string
  displayName: string
  elo: number
  gamesPlayed: number
  gamesWon: number
  winRate: number
}

type LeaderboardTableProps = {
  players: LeaderboardPlayer[]
  currentUserId?: string
}

const MEDAL_STYLES: Record<number, string> = {
  1: "text-yellow-400 font-black",
  2: "text-gray-300 font-black",
  3: "text-amber-600 font-black",
}

function RankNumber({ rank }: { rank: number }) {
  const style = MEDAL_STYLES[rank]
  if (style) {
    return <span className={cn("text-base", style)}>{rank}</span>
  }
  return <span className="text-white/60 text-sm">{rank}</span>
}

export function LeaderboardTable({ players, currentUserId }: LeaderboardTableProps) {
  const currentUserEntry = currentUserId
    ? players.find((p) => p.userId === currentUserId)
    : undefined

  if (players.length === 0) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 px-6 py-16 text-center">
        <p className="text-white/50">No players on the leaderboard yet.</p>
        <p className="mt-1 text-sm text-white/30">Play a game to appear here!</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {currentUserEntry && (
        <div className="rounded-lg border border-purple-500/30 bg-purple-500/10 px-4 py-2 text-sm text-purple-200">
          You are ranked{" "}
          <span className="font-bold text-purple-100">
            #{currentUserEntry.rank}
          </span>{" "}
          globally
        </div>
      )}

      <div className="rounded-xl border border-white/10 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-white/10 hover:bg-transparent">
              <TableHead className="w-12 text-white/50 text-xs uppercase tracking-wider">
                #
              </TableHead>
              <TableHead className="text-white/50 text-xs uppercase tracking-wider">
                Player
              </TableHead>
              <TableHead className="text-white/50 text-xs uppercase tracking-wider">
                Elo
              </TableHead>
              <TableHead className="text-white/50 text-xs uppercase tracking-wider hidden sm:table-cell">
                W / L
              </TableHead>
              <TableHead className="text-white/50 text-xs uppercase tracking-wider hidden sm:table-cell">
                Win%
              </TableHead>
              <TableHead className="text-white/50 text-xs uppercase tracking-wider">
                Rank
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {players.map((player) => {
              const isCurrentUser = currentUserId === player.userId
              const losses = player.gamesPlayed - player.gamesWon
              const rankName = getRankFromElo(player.elo)

              return (
                <TableRow
                  key={player.userId}
                  className={cn(
                    "border-white/10 transition-colors",
                    isCurrentUser
                      ? "bg-white/5 hover:bg-white/10"
                      : "hover:bg-white/5"
                  )}
                >
                  <TableCell className="font-mono w-12">
                    <RankNumber rank={player.rank} />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "font-medium truncate max-w-[140px] sm:max-w-xs",
                          isCurrentUser ? "text-white" : "text-white/80"
                        )}
                      >
                        {player.displayName}
                      </span>
                      {isCurrentUser && (
                        <span className="shrink-0 text-xs text-purple-400 font-semibold">
                          (you)
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="font-mono font-semibold text-white">
                    {player.elo}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell text-white/60 text-sm font-mono">
                    {player.gamesWon} / {losses}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell text-white/60 text-sm">
                    {player.winRate}%
                  </TableCell>
                  <TableCell>
                    <RankBadge rank={rankName} size="sm" />
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
