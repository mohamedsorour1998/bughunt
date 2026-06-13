"use client"

import { Tabs } from "@base-ui/react/tabs"
import { LeaderboardTable } from "@/components/leaderboard/LeaderboardTable"
import type { LeaderboardPlayer } from "@/lib/leaderboard"

type LeaderboardTabsProps = {
  globalPlayers: LeaderboardPlayer[]
  seasonPlayers: LeaderboardPlayer[]
  currentUserId?: string
  seasonName: string
}

export function LeaderboardTabs({
  globalPlayers,
  seasonPlayers,
  currentUserId,
  seasonName,
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
    </Tabs.Root>
  )
}
