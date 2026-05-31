"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { signOut, useSession } from "next-auth/react"
import { Bug, Menu, X } from "lucide-react"
import { buttonVariants } from "@/components/ui/button"
import { RankBadge } from "@/components/ui/RankBadge"
import { getRankFromElo } from "@/lib/users"
import { cn } from "@/lib/utils"

const NAV_LINKS = [
  { href: "/play", label: "Play" },
  { href: "/daily", label: "Daily" },
  { href: "/practice", label: "Practice" },
  { href: "/leaderboard", label: "Leaderboard" },
]

export function Navbar() {
  const pathname = usePathname()
  const { data: session, status } = useSession()
  const [mobileOpen, setMobileOpen] = useState(false)

  const user = session?.user as
    | { id?: string; name?: string | null; image?: string | null; elo?: number }
    | undefined

  const displayName = user?.name ?? "Player"
  const elo = user?.elo ?? 1200
  const rank = getRankFromElo(elo)

  return (
    <header className="fixed top-0 left-0 right-0 z-50 w-full bg-gray-900/95 backdrop-blur border-b border-white/10">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Left: Logo */}
        <Link
          href="/"
          className="flex items-center gap-2 font-bold text-white hover:text-white/80 transition-colors"
        >
          <Bug className="size-5 text-emerald-400" />
          <span className="text-lg">BugHunt</span>
        </Link>

        {/* Center: Desktop nav links */}
        <nav className="hidden md:flex items-center gap-1">
          {NAV_LINKS.map(({ href, label }) => {
            const isActive = pathname === href || pathname.startsWith(href + "/")
            const isDaily = href === "/daily"
            return (
              <Link
                key={href}
                href={href}
                className={`relative px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-white/10 text-white"
                    : "text-white/60 hover:text-white hover:bg-white/5"
                }`}
              >
                {label}
                {isDaily && <span className="ml-1 text-xs">🔥</span>}
              </Link>
            )
          })}
        </nav>

        {/* Right: Desktop user info or sign in */}
        <div className="hidden md:flex items-center gap-3">
          {status === "loading" ? (
            <div className="size-8 rounded-full bg-white/10 animate-pulse" />
          ) : session ? (
            <div className="flex items-center gap-3">
              {user?.image && (
                <img
                  src={user.image}
                  alt={displayName}
                  className="size-8 rounded-full border border-white/20"
                />
              )}
              <div className="flex flex-col items-end">
                <span className="text-sm font-medium text-white leading-none">
                  {displayName}
                </span>
                <span className="text-xs text-white/50 leading-none mt-0.5">
                  {elo} Elo
                </span>
              </div>
              <RankBadge rank={rank} size="sm" />
              <button
                onClick={() => signOut({ callbackUrl: "/" })}
                className="text-xs text-white/50 hover:text-white transition-colors px-2 py-1 rounded hover:bg-white/10"
              >
                Sign out
              </button>
            </div>
          ) : (
            <Link href="/login" className={cn(buttonVariants({ size: "sm" }))}>
              Sign In
            </Link>
          )}
        </div>

        {/* Mobile: hamburger */}
        <button
          className="md:hidden p-2 text-white/70 hover:text-white transition-colors"
          onClick={() => setMobileOpen((prev) => !prev)}
          aria-label="Toggle navigation menu"
        >
          {mobileOpen ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </div>

      {/* Mobile dropdown */}
      {mobileOpen && (
        <div className="md:hidden border-t border-white/10 bg-gray-900 px-4 pb-4 pt-2">
          <nav className="flex flex-col gap-1">
            {NAV_LINKS.map(({ href, label }) => {
              const isActive = pathname === href || pathname.startsWith(href + "/")
              const isDaily = href === "/daily"
              return (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setMobileOpen(false)}
                  className={`px-4 py-2.5 rounded-md text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-white/10 text-white"
                      : "text-white/60 hover:text-white hover:bg-white/5"
                  }`}
                >
                  {label}
                  {isDaily && <span className="ml-1 text-xs">🔥</span>}
                </Link>
              )
            })}

            <div className="mt-2 border-t border-white/10 pt-2">
              {session ? (
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-3 px-4 py-2">
                    {user?.image && (
                      <img
                        src={user.image}
                        alt={displayName}
                        className="size-8 rounded-full border border-white/20"
                      />
                    )}
                    <div>
                      <p className="text-sm font-medium text-white">{displayName}</p>
                      <p className="text-xs text-white/50">{elo} Elo · {rank}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => signOut({ callbackUrl: "/" })}
                    className="px-4 py-2 text-sm text-left text-white/60 hover:text-white hover:bg-white/5 rounded-md transition-colors"
                  >
                    Sign out
                  </button>
                </div>
              ) : (
                <Link
                  href="/login"
                  onClick={() => setMobileOpen(false)}
                  className={cn(buttonVariants({ size: "sm" }), "w-full justify-center")}
                >
                  Sign In
                </Link>
              )}
            </div>
          </nav>
        </div>
      )}
    </header>
  )
}
