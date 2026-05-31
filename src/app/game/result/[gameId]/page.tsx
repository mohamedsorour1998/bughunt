"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useParams } from "next/navigation"
import { useSession } from "next-auth/react"
import { toast } from "sonner"
import { GameResult } from "@/components/game/GameResult"
import { GameChat } from "@/components/game/GameChat"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"

const ACHIEVEMENT_NAMES: Record<string, string> = {
  first_win: "First Win!",
  games_10: "10 Games Played",
  games_100: "100 Games Played",
  streak_5: "5-Game Win Streak",
  streak_10: "10-Game Win Streak",
  elo_1400: "Reached Platinum",
  elo_1600: "Reached Diamond",
  elo_2000: "Reached Master",
}

// ---------------------------------------------------------------------------
// Types mirroring the API response
// ---------------------------------------------------------------------------

interface GameData {
  gameId: string
  player1Id: string
  player2Id: string
  bugId: string
  status: string
  winnerId: string | null
  createdAt: number
  expiresAt: number
  affectsElo?: boolean
}

interface BugData {
  language: string
  category: string
  difficulty: number
  buggyCode: string
  bugLine: number
  options: [string, string, string, string]
  correctAnswer: number
  explanation: string
  hint: string
}

interface PlayerRecord {
  userId: string
  answer: number | null
  correct: boolean | null
  submittedAt: number | null
  timeElapsedMs: number | null
}

interface MatchHistoryEntry {
  result: string
  eloBefore: number
  eloAfter: number
  eloChange: number
  newAchievements?: string[]
}

interface GameDetailResponse {
  game: GameData
  bug: BugData | null
  players: {
    player1: PlayerRecord | null
    player2: PlayerRecord | null
  }
  matchHistoryEntry: MatchHistoryEntry | null
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function ResultSkeleton() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <Skeleton className="h-20 w-full rounded-2xl" />
      <div className="space-y-2">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
      <Skeleton className="h-48 w-full rounded-xl" />
      <div className="grid grid-cols-3 gap-3">
        <Skeleton className="h-20 rounded-xl" />
        <Skeleton className="h-20 rounded-xl" />
        <Skeleton className="h-20 rounded-xl" />
      </div>
      <div className="flex justify-center">
        <Skeleton className="h-12 w-48 rounded-lg" />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main page component
// ---------------------------------------------------------------------------

export default function ResultPage() {
  const router = useRouter()
  const params = useParams()
  const gameId = params.gameId as string
  const { data: session } = useSession()

  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<GameDetailResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!gameId) return

    async function fetchResult() {
      try {
        const res = await fetch(`/api/game/${gameId}`)
        if (res.status === 404) {
          setError("not_found")
          return
        }
        if (!res.ok) {
          setError("error")
          return
        }
        const json: GameDetailResponse = await res.json()
        if (json.game?.status !== "completed") {
          setError("not_completed")
          return
        }
        setData(json)

        // Fire achievement toasts once per game (sessionStorage dedup)
        const achievements = json.matchHistoryEntry?.newAchievements ?? []
        const seenKey = `achievements-shown:${gameId}`
        if (achievements.length > 0 && !sessionStorage.getItem(seenKey)) {
          sessionStorage.setItem(seenKey, "1")
          achievements.forEach((achievement, index) => {
            setTimeout(() => {
              toast.success(
                `Achievement Unlocked: ${ACHIEVEMENT_NAMES[achievement] ?? achievement}`,
                { icon: "🏆" }
              )
            }, index * 500)
          })
        }
      } catch {
        setError("error")
      } finally {
        setLoading(false)
      }
    }

    fetchResult()
  }, [gameId])

  function handlePlayAgain() {
    router.push("/play")
  }

  // Loading state
  if (loading) {
    return (
      <main className="min-h-screen">
        <ResultSkeleton />
      </main>
    )
  }

  // Error / not found
  if (error || !data || !data.bug) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-4">
        <div className="text-center">
          <h1 className="mb-2 text-2xl font-bold text-white">Game not found</h1>
          <p className="text-white/60">
            This game may not exist or hasn&apos;t completed yet.
          </p>
        </div>
        <Button size="lg" onClick={handlePlayAgain}>
          Play Again
        </Button>
      </main>
    )
  }

  const { game, bug, players, matchHistoryEntry } = data
  const userId = session?.user?.id

  // Determine which player is me and which is the opponent
  const isPlayer1 = game.player1Id === userId
  const myRecord = isPlayer1 ? players.player1 : players.player2
  const opponentRecord = isPlayer1 ? players.player2 : players.player1

  // Elo data from match history entry
  const eloChange = matchHistoryEntry?.eloChange ?? 0
  const newElo = matchHistoryEntry?.eloAfter ?? 1200

  // Guard: my record must exist
  if (!myRecord) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-4">
        <div className="text-center">
          <h1 className="mb-2 text-2xl font-bold text-white">Game not found</h1>
          <p className="text-white/60">You were not a participant in this game.</p>
        </div>
        <Button size="lg" onClick={handlePlayAgain}>
          Play Again
        </Button>
      </main>
    )
  }

  const newAchievements = matchHistoryEntry?.newAchievements ?? []

  return (
    <main className="min-h-screen">
      <GameResult
        game={{
          gameId: game.gameId,
          status: game.status,
          winnerId: game.winnerId,
          createdAt: game.createdAt,
          player1Id: game.player1Id,
          player2Id: game.player2Id,
        }}
        bug={bug}
        myRecord={myRecord}
        opponentRecord={opponentRecord}
        eloChange={eloChange}
        newElo={newElo}
        newAchievements={newAchievements}
        onPlayAgain={handlePlayAgain}
        opponentId={opponentRecord?.userId}
        onRematch={() => {
          // Poll for mutual rematch every 2s
          const pollInterval = setInterval(async () => {
            if (!opponentRecord?.userId) return
            const res = await fetch(
              `/api/game/rematch/status?opponentId=${opponentRecord.userId}`
            )
            const data = await res.json()
            if (data.status === "matched" && data.gameId) {
              clearInterval(pollInterval)
              router.push(`/play?gameId=${data.gameId}`)
            }
          }, 2000)
          // Auto-stop polling after 65s
          setTimeout(() => clearInterval(pollInterval), 65_000)
        }}
      />

      {/* Private game badge */}
      {game.affectsElo === false && (
        <div className="mx-auto max-w-3xl px-4 pb-4 sm:px-6 lg:px-8">
          <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-0.5 text-xs font-medium text-white/60">
            Private · No Elo change
          </span>
        </div>
      )}

      {/* Post-game chat */}
      <div className="mx-auto max-w-3xl px-4 pb-8 sm:px-6 lg:px-8">
        <GameChat gameId={gameId} />
      </div>
    </main>
  )
}
