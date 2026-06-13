import type { Metadata } from "next"
import Link from "next/link"
import { getGame } from "@/lib/game"
import { getUser } from "@/lib/users"
import { buttonVariants } from "@/components/ui/button"

interface Props {
  params: Promise<{ gameId: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { gameId } = await params
  const game = await getGame(gameId)
  if (!game || game.status !== "completed") return { title: "BugHunt match" }
  const winner = game.winnerId ? await getUser(game.winnerId) : null
  const title = winner
    ? `${winner.displayName} won a BugHunt duel`
    : "A BugHunt duel ended in a draw"
  const og = `/api/og/result?outcome=${game.winnerId ? "win" : "draw"}&name=${encodeURIComponent(winner?.displayName ?? "Bug hunters")}&elo=${winner?.elo ?? 1200}`
  return {
    title,
    openGraph: { title, images: [og] },
    twitter: { card: "summary_large_image", title, images: [og] },
  }
}

export default async function ShareResultPage({ params }: Props) {
  const { gameId } = await params
  const game = await getGame(gameId)
  const winner = game?.winnerId ? await getUser(game.winnerId) : null

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-4 text-center">
      <p className="text-sm uppercase tracking-widest text-emerald-400">BugHunt duel</p>
      <h1 className="text-3xl font-bold text-white sm:text-4xl">
        {game?.status !== "completed"
          ? "This match isn't finished yet"
          : winner
            ? `${winner.displayName} found the bugs first 🏆`
            : "Dead even — a draw"}
      </h1>
      <p className="max-w-md text-white/60">
        Two developers, three buggy snippets, 120 seconds each. Think you&apos;d have been faster?
      </p>
      <Link href="/play" className={buttonVariants({ size: "lg" })}>
        Challenge someone →
      </Link>
    </main>
  )
}
