import type { Metadata } from "next"
import Link from "next/link"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export async function generateMetadata(
  {
    params,
    searchParams,
  }: {
    params: Promise<{ date: string }>
    searchParams: Promise<{ userId?: string; time?: string; rank?: string; correct?: string }>
  }
): Promise<Metadata> {
  const { date } = await params
  const sp = await searchParams
  const ogUrl = `/api/og/daily?date=${date}&time=${sp.time ?? "0"}&rank=${sp.rank ?? "?"}&correct=${sp.correct ?? "false"}`
  return {
    title: `BugHunt Daily Challenge — ${date}`,
    description: "Can you find the bug faster?",
    openGraph: {
      title: `BugHunt Daily Challenge — ${date}`,
      description: "I solved today's debugging challenge on BugHunt!",
      images: [{ url: ogUrl, width: 1200, height: 630 }],
    },
    twitter: { card: "summary_large_image", images: [ogUrl] },
  }
}

export default async function ShareDailyPage({
  params,
}: {
  params: Promise<{ date: string }>
}) {
  const { date } = await params
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 px-4">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-white mb-2">🐛 BugHunt Daily Challenge</h1>
        <p className="text-gray-400 text-xl">{date}</p>
      </div>
      <div className="flex gap-4">
        <Link href="/daily" className={cn(buttonVariants({ size: "lg" }))}>
          Play Today&apos;s Challenge
        </Link>
        <Link href="/" className={cn(buttonVariants({ variant: "outline", size: "lg" }))}>
          Learn More
        </Link>
      </div>
    </main>
  )
}
