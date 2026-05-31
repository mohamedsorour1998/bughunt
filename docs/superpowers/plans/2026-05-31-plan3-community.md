# Community Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add friend follows, direct challenges, private games, post-game chat, and streak shields.

**Architecture:** Follow relationships in DynamoDB with reverse index. Challenges use Redis pub/sub + SSE notification stream. Private games skip Elo via affectsElo flag. Post-game chat is DynamoDB with 5-message limit per user.

**Tech Stack:** Existing DynamoDB patterns, Redis pub/sub (src/lib/redis.ts), Next.js SSE nodejs runtime

---

## Task 1 — Follow System (DynamoDB + API Routes)

### Files
- `src/app/api/social/follow/route.ts` — POST follow, DELETE unfollow (by followeeId query param)
- `src/app/api/social/following/route.ts` — GET list of users the caller follows
- `src/app/api/social/followers/route.ts` — GET list of users following the caller

### Steps

- [ ] Create `src/app/api/social/follow/route.ts`

```typescript
// src/app/api/social/follow/route.ts
import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { putItem, deleteItem } from "@/lib/dynamodb"
import { getUser } from "@/lib/users"
import { ddb, TABLE_NAME } from "@/lib/dynamodb"
import { UpdateCommand } from "@aws-sdk/lib-dynamodb"

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const followerId = session.user.id
  const { followeeId } = await req.json() as { followeeId: string }

  if (!followeeId || followeeId === followerId) {
    return NextResponse.json({ error: "Invalid followeeId" }, { status: 400 })
  }

  const [followee, follower] = await Promise.all([
    getUser(followeeId),
    getUser(followerId),
  ])

  if (!followee) {
    return NextResponse.json({ error: "User not found" }, { status: 404 })
  }

  const now = Date.now()

  // Forward relationship: USER#followerId / FOLLOWS#followeeId
  await putItem({
    pk: `USER#${followerId}`,
    sk: `FOLLOWS#${followeeId}`,
    followedAt: now,
    followeeDisplayName: followee.displayName,
    followeeElo: followee.elo,
  })

  // Reverse index: USER#followeeId / FOLLOWER#followerId
  await putItem({
    pk: `USER#${followeeId}`,
    sk: `FOLLOWER#${followerId}`,
    followedAt: now,
    followerDisplayName: follower?.displayName ?? "Unknown",
  })

  // Increment followerCount on followee profile
  await ddb.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: { pk: `USER#${followeeId}`, sk: "PROFILE" },
    UpdateExpression: "ADD #fc :inc",
    ExpressionAttributeNames: { "#fc": "followerCount" },
    ExpressionAttributeValues: { ":inc": 1 },
  }))

  // Increment followingCount on follower profile
  await ddb.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: { pk: `USER#${followerId}`, sk: "PROFILE" },
    UpdateExpression: "ADD #fc :inc",
    ExpressionAttributeNames: { "#fc": "followingCount" },
    ExpressionAttributeValues: { ":inc": 1 },
  }))

  return NextResponse.json({ success: true })
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const followerId = session.user.id
  const { searchParams } = new URL(req.url)
  const followeeId = searchParams.get("followeeId")

  if (!followeeId) {
    return NextResponse.json({ error: "Missing followeeId" }, { status: 400 })
  }

  await Promise.all([
    deleteItem(`USER#${followerId}`, `FOLLOWS#${followeeId}`),
    deleteItem(`USER#${followeeId}`, `FOLLOWER#${followerId}`),
  ])

  // Decrement followerCount on followee profile
  await ddb.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: { pk: `USER#${followeeId}`, sk: "PROFILE" },
    UpdateExpression: "ADD #fc :dec",
    ExpressionAttributeNames: { "#fc": "followerCount" },
    ExpressionAttributeValues: { ":dec": -1 },
  }))

  // Decrement followingCount on follower profile
  await ddb.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: { pk: `USER#${followerId}`, sk: "PROFILE" },
    UpdateExpression: "ADD #fc :dec",
    ExpressionAttributeNames: { "#fc": "followingCount" },
    ExpressionAttributeValues: { ":dec": -1 },
  }))

  return NextResponse.json({ success: true })
}
```

- [ ] Create `src/app/api/social/following/route.ts`

```typescript
// src/app/api/social/following/route.ts
import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { queryItems } from "@/lib/dynamodb"

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const userId = session.user.id

  const { items } = await queryItems(
    "pk = :pk AND begins_with(sk, :skPrefix)",
    { ":pk": `USER#${userId}`, ":skPrefix": "FOLLOWS#" }
  )

  const following = items.map((item) => ({
    userId: (item.sk as string).replace("FOLLOWS#", ""),
    displayName: item.followeeDisplayName as string,
    elo: item.followeeElo as number,
    followedAt: item.followedAt as number,
  }))

  return NextResponse.json({ following })
}
```

- [ ] Create `src/app/api/social/followers/route.ts`

```typescript
// src/app/api/social/followers/route.ts
import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { queryItems } from "@/lib/dynamodb"

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const userId = session.user.id

  const { items } = await queryItems(
    "pk = :pk AND begins_with(sk, :skPrefix)",
    { ":pk": `USER#${userId}`, ":skPrefix": "FOLLOWER#" }
  )

  const followers = items.map((item) => ({
    userId: (item.sk as string).replace("FOLLOWER#", ""),
    displayName: item.followerDisplayName as string,
    followedAt: item.followedAt as number,
  }))

  return NextResponse.json({ followers })
}
```

- [ ] Also update `src/lib/users.ts`: add `followerCount: number` and `followingCount: number` to `UserProfile` type, read them in `getUser` (default 0), and map them in `updateUser`.

- [ ] Run `npx tsc --noEmit` to verify types compile.
- [ ] `git add src/app/api/social/ src/lib/users.ts` && `git commit -m "feat: follow/unfollow API with DynamoDB forward+reverse index and profile counters"`

---

## Task 2 — Follow UI on Public Profile

### File
- `src/app/(social)/profile/[userId]/page.tsx` — add isFollowing state, Follow/Unfollow button, Challenge button, follower/following counts

### Steps

- [ ] Modify `src/app/(social)/profile/[userId]/page.tsx`

**1. Add new fields to the `PublicProfile` type:**

```typescript
type PublicProfile = {
  userId: string
  displayName: string
  avatar: string | null
  elo: number
  rank: string
  gamesPlayed: number
  gamesWon: number
  currentStreak: number
  bestStreak: number
  // NEW:
  followerCount: number
  followingCount: number
}
```

**2. Add state variables inside the page component:**

```typescript
const [isFollowing, setIsFollowing] = useState(false)
const [followLoading, setFollowLoading] = useState(false)
const [followerCount, setFollowerCount] = useState(0)
const [followingCount, setFollowingCount] = useState(0)
```

**3. Inside the existing profile fetch useEffect, after `setProfile(data)`, add:**

```typescript
setFollowerCount(data.followerCount ?? 0)
setFollowingCount(data.followingCount ?? 0)

// Check follow status only when viewing someone else's profile
if (session?.user?.id && session.user.id !== userId) {
  const followRes = await fetch("/api/social/following")
  if (followRes.ok) {
    const { following } = await followRes.json() as { following: { userId: string }[] }
    setIsFollowing(following.some((f) => f.userId === userId))
  }
}
```

**4. Add the follow/unfollow handler function:**

```typescript
async function handleFollowToggle() {
  if (!session?.user?.id) return
  setFollowLoading(true)
  try {
    if (isFollowing) {
      const res = await fetch(`/api/social/follow?followeeId=${userId}`, { method: "DELETE" })
      if (res.ok) {
        setIsFollowing(false)
        setFollowerCount((c) => Math.max(0, c - 1))
      }
    } else {
      const res = await fetch("/api/social/follow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ followeeId: userId }),
      })
      if (res.ok) {
        setIsFollowing(true)
        setFollowerCount((c) => c + 1)
      }
    }
  } finally {
    setFollowLoading(false)
  }
}
```

**5. Replace the action button block with:**

```tsx
{isOwnProfile ? (
  <Button onClick={() => router.push("/play")} size="lg">
    Play Now
  </Button>
) : session?.user?.id ? (
  <div className="flex items-center gap-2">
    <Button
      onClick={handleFollowToggle}
      disabled={followLoading}
      variant={isFollowing ? "secondary" : "default"}
      size="lg"
    >
      {followLoading ? "..." : isFollowing ? "Unfollow" : "Follow"}
    </Button>
    <Button
      onClick={handleChallenge}
      variant="outline"
      size="lg"
    >
      Challenge
    </Button>
  </div>
) : null}
```

**6. Add the challenge handler (fires `POST /api/social/challenge`):**

```typescript
async function handleChallenge() {
  if (!session?.user?.id) return
  const res = await fetch("/api/social/challenge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ challengedId: userId }),
  })
  if (res.ok) {
    alert("Challenge sent!")
  }
}
```

**7. Add follower/following count row in JSX below the stats grid:**

```tsx
<div className="flex gap-6 text-sm text-white/60">
  <span>
    <span className="font-semibold text-white">{followerCount}</span> Followers
  </span>
  <span>
    <span className="font-semibold text-white">{followingCount}</span> Following
  </span>
</div>
```

- [ ] `git add src/app/(social)/profile/` && `git commit -m "feat: Follow/Unfollow and Challenge buttons + follower/following counts on profile page"`

---

## Task 3 — Social Feed

### Files
- `src/app/api/social/feed/route.ts` — GET: query FOLLOWS# items, batch-fetch match histories
- `src/app/(social)/feed/page.tsx` — new page rendering friends' recent games with W/L badges

### Steps

- [ ] Create `src/app/api/social/feed/route.ts`

```typescript
// src/app/api/social/feed/route.ts
import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { queryItems } from "@/lib/dynamodb"
import { getMatchHistory } from "@/lib/users"

export const runtime = "nodejs"

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const userId = session.user.id

  // Step 1: get all users this person follows
  const { items: followItems } = await queryItems(
    "pk = :pk AND begins_with(sk, :skPrefix)",
    { ":pk": `USER#${userId}`, ":skPrefix": "FOLLOWS#" }
  )

  if (followItems.length === 0) {
    return NextResponse.json({ feed: [] })
  }

  // Step 2: batch-fetch recent match history for each followed user (last 5 games each)
  const followedIds = followItems.map((item) =>
    (item.sk as string).replace("FOLLOWS#", "")
  )

  const historyResults = await Promise.all(
    followedIds.map((fId) => getMatchHistory(fId, 5))
  )

  // Step 3: flatten, annotate with whose game it is, sort by createdAt desc
  const feedEntries = historyResults
    .flatMap((result, idx) =>
      result.entries.map((entry) => ({
        ...entry,
        playerId: followedIds[idx],
        playerName: (followItems[idx].followeeDisplayName as string) ?? followedIds[idx],
      }))
    )
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 50)

  return NextResponse.json({ feed: feedEntries })
}
```

- [ ] Create `src/app/(social)/feed/page.tsx`

```tsx
// src/app/(social)/feed/page.tsx
"use client"

import { useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"

type FeedEntry = {
  gameId: string
  playerId: string
  playerName: string
  opponentId: string
  opponentName: string
  result: "win" | "loss" | "draw"
  eloBefore: number
  eloAfter: number
  eloChange: number
  createdAt: number
}

const RESULT_COLORS: Record<string, string> = {
  win: "text-green-400",
  loss: "text-red-400",
  draw: "text-yellow-400",
}

function timeAgo(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000)
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

export default function FeedPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [feed, setFeed] = useState<FeedEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/")
      return
    }
    if (status !== "authenticated") return

    fetch("/api/social/feed")
      .then((r) => r.json())
      .then((data: { feed: FeedEntry[] }) => {
        setFeed(data.feed ?? [])
      })
      .finally(() => setLoading(false))
  }, [status, router])

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-white/50">Loading feed...</p>
      </main>
    )
  }

  if (feed.length === 0) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
        <p className="text-lg text-white/70">Your feed is empty.</p>
        <p className="text-sm text-white/40">Follow other players to see their recent games here.</p>
        <Button onClick={() => router.push("/leaderboard")}>Browse Players</Button>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-2xl space-y-4 px-4 py-8">
      <h1 className="text-xl font-bold text-white">Following Feed</h1>
      <ul className="space-y-3">
        {feed.map((entry) => (
          <li
            key={`${entry.gameId}-${entry.playerId}`}
            className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-3"
          >
            <div className="space-y-0.5">
              <div className="flex items-center gap-2 text-sm font-medium text-white">
                <Link href={`/profile/${entry.playerId}`} className="hover:underline">
                  {entry.playerName}
                </Link>
                <span className={`text-xs font-bold uppercase ${RESULT_COLORS[entry.result]}`}>
                  {entry.result}
                </span>
                <span className="text-white/40">vs</span>
                <Link href={`/profile/${entry.opponentId}`} className="text-white/70 hover:underline">
                  {entry.opponentName}
                </Link>
              </div>
              <div className="text-xs text-white/40">{timeAgo(entry.createdAt)}</div>
            </div>
            <div className="text-right text-sm">
              <span className={entry.eloChange >= 0 ? "text-green-400" : "text-red-400"}>
                {entry.eloChange >= 0 ? "+" : ""}{entry.eloChange} Elo
              </span>
              <div className="text-xs text-white/40">{entry.eloAfter} rated</div>
            </div>
          </li>
        ))}
      </ul>
    </main>
  )
}
```

- [ ] `git add src/app/api/social/feed/ src/app/(social)/feed/` && `git commit -m "feat: social feed page showing recent games from followed players with W/L badges"`

---

## Task 4 — Notification Stream

### Files
- `src/app/api/notifications/stream/route.ts` — SSE endpoint subscribing to Redis `notifications:{userId}`
- `src/app/api/notifications/route.ts` — GET last 20 notifications + POST mark read
- `src/lib/notifications.ts` — shared helper to write notification to DynamoDB and publish to Redis
- `src/components/layout/Navbar.tsx` — notification bell with unread count, polls every 30s + SSE

### Steps

- [ ] Create `src/lib/notifications.ts`

```typescript
// src/lib/notifications.ts
import { v4 as uuidv4 } from "uuid"
import { putItem } from "@/lib/dynamodb"
import { getRedis } from "@/lib/redis"

export type NotificationType =
  | "challenge_received"
  | "challenge_accepted"
  | "challenge_declined"
  | "friend_game_completed"

export interface NotificationPayload {
  type: NotificationType
  fromUserId?: string
  fromDisplayName?: string
  gameId?: string
  challengeId?: string
}

export async function sendNotification(
  toUserId: string,
  payload: NotificationPayload
): Promise<void> {
  const now = Date.now()
  const notifId = uuidv4()
  const sk = `NOTIF#${now}#${notifId}`
  const expiresAt = Math.floor((now + 30 * 24 * 60 * 60 * 1000) / 1000) // 30 days TTL

  await putItem({
    pk: `USER#${toUserId}`,
    sk,
    notifId,
    ...payload,
    read: false,
    createdAt: now,
    expiresAt,
  })

  // Publish to Redis for real-time SSE delivery
  const redis = getRedis()
  await redis.publish(
    `notifications:${toUserId}`,
    JSON.stringify({ ...payload, notifId, sk, createdAt: now })
  )
}
```

- [ ] Create `src/app/api/notifications/stream/route.ts`

```typescript
// src/app/api/notifications/stream/route.ts
// Must use nodejs runtime — SSE requires persistent TCP connection not supported in Edge runtime
export const runtime = "nodejs"

import { NextRequest } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { getRedis } from "@/lib/redis"

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return new Response("Unauthorized", { status: 401 })
  }

  const userId = session.user.id
  const encoder = new TextEncoder()
  let closed = false

  const stream = new ReadableStream({
    async start(controller) {
      // Heartbeat comment every 25 s to keep connection alive through proxies
      const heartbeat = setInterval(() => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"))
        } catch {
          clearInterval(heartbeat)
        }
      }, 25_000)

      // Subscribe to user's Redis notification channel
      const subscriber = getRedis().duplicate()
      await subscriber.subscribe(`notifications:${userId}`)

      subscriber.on("message", (_channel: string, message: string) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`data: ${message}\n\n`))
        } catch {
          // stream closed
        }
      })

      req.signal.addEventListener("abort", () => {
        closed = true
        clearInterval(heartbeat)
        subscriber.unsubscribe()
        subscriber.quit()
        controller.close()
      })
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  })
}
```

- [ ] Create `src/app/api/notifications/route.ts`

```typescript
// src/app/api/notifications/route.ts
import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { queryItems, updateItem } from "@/lib/dynamodb"

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const userId = session.user.id
  const { items } = await queryItems(
    "pk = :pk AND begins_with(sk, :skPrefix)",
    { ":pk": `USER#${userId}`, ":skPrefix": "NOTIF#" },
    { scanIndexForward: false, limit: 20 }
  )

  const notifications = items.map((item) => ({
    notifId: item.notifId as string,
    sk: item.sk as string,
    type: item.type as string,
    fromUserId: item.fromUserId as string | undefined,
    fromDisplayName: item.fromDisplayName as string | undefined,
    gameId: item.gameId as string | undefined,
    challengeId: item.challengeId as string | undefined,
    read: (item.read as boolean) ?? false,
    createdAt: item.createdAt as number,
  }))

  const unreadCount = notifications.filter((n) => !n.read).length

  return NextResponse.json({ notifications, unreadCount })
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const userId = session.user.id
  const { sk } = await req.json() as { sk: string }

  if (!sk) {
    return NextResponse.json({ error: "Missing sk" }, { status: 400 })
  }

  await updateItem(`USER#${userId}`, sk, { read: true })
  return NextResponse.json({ success: true })
}
```

- [ ] Add notification bell to `src/components/layout/Navbar.tsx`

Add state and SSE logic inside the Navbar component (client component):

```tsx
// Add to Navbar.tsx imports:
import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"

// Add inside Navbar component:
const router = useRouter()
const [unreadCount, setUnreadCount] = useState(0)
const [notifications, setNotifications] = useState<Array<{
  notifId: string
  sk: string
  type: string
  fromDisplayName?: string
  challengeId?: string
  gameId?: string
  read: boolean
  createdAt: number
}>>([])
const [bellOpen, setBellOpen] = useState(false)
const sseRef = useRef<EventSource | null>(null)

useEffect(() => {
  if (!session?.user?.id) return

  fetchNotifications()

  // SSE subscription for real-time delivery
  const sse = new EventSource("/api/notifications/stream")
  sseRef.current = sse
  sse.onmessage = () => {
    fetchNotifications()
  }

  // Fallback poll every 30 s
  const poll = setInterval(fetchNotifications, 30_000)

  return () => {
    sse.close()
    clearInterval(poll)
  }
}, [session?.user?.id])

async function fetchNotifications() {
  const res = await fetch("/api/notifications")
  if (res.ok) {
    const data = await res.json() as {
      notifications: typeof notifications
      unreadCount: number
    }
    setNotifications(data.notifications)
    setUnreadCount(data.unreadCount)
  }
}

async function markRead(sk: string) {
  await fetch("/api/notifications", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sk }),
  })
  setNotifications((prev) =>
    prev.map((n) => (n.sk === sk ? { ...n, read: true } : n))
  )
  setUnreadCount((c) => Math.max(0, c - 1))
}
```

Add bell button JSX in the Navbar action group:

```tsx
{session?.user && (
  <div className="relative">
    <button
      onClick={() => setBellOpen((o) => !o)}
      className="relative rounded-full p-1 text-white/70 hover:text-white"
      aria-label="Notifications"
    >
      🔔
      {unreadCount > 0 && (
        <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
          {unreadCount > 9 ? "9+" : unreadCount}
        </span>
      )}
    </button>

    {bellOpen && (
      <div className="absolute right-0 top-full z-50 mt-2 w-80 rounded-xl border border-white/10 bg-zinc-900 p-2 shadow-2xl">
        {notifications.length === 0 ? (
          <p className="px-3 py-4 text-center text-sm text-white/50">No notifications</p>
        ) : (
          <ul className="max-h-80 space-y-1 overflow-y-auto">
            {notifications.slice(0, 15).map((n) => (
              <li
                key={n.notifId}
                className={`flex cursor-pointer items-start gap-2 rounded-lg px-3 py-2 text-sm hover:bg-white/5 ${
                  n.read ? "text-white/50" : "text-white"
                }`}
                onClick={() => {
                  markRead(n.sk)
                  if (n.gameId) router.push(`/game/result/${n.gameId}`)
                  setBellOpen(false)
                }}
              >
                <span className="mt-0.5 shrink-0">
                  {n.type === "challenge_received" ? "⚔️" :
                   n.type === "challenge_accepted" ? "✅" :
                   n.type === "challenge_declined" ? "❌" : "🎮"}
                </span>
                <div>
                  <p>
                    {n.type === "challenge_received"
                      ? `${n.fromDisplayName} challenged you!`
                      : n.type === "challenge_accepted"
                      ? `${n.fromDisplayName} accepted your challenge`
                      : n.type === "challenge_declined"
                      ? `${n.fromDisplayName} declined your challenge`
                      : "New activity"}
                  </p>
                  <p className="text-xs text-white/30">
                    {new Date(n.createdAt).toLocaleTimeString()}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    )}
  </div>
)}
```

- [ ] `git add src/lib/notifications.ts src/app/api/notifications/ src/components/layout/Navbar.tsx` && `git commit -m "feat: notification SSE stream, DynamoDB storage, bell badge with 30s poll fallback"`

---

## Task 5 — Direct Challenge

### Files
- `src/app/api/social/challenge/route.ts` — POST send challenge
- `src/app/api/social/challenge/respond/route.ts` — POST accept/decline
- `src/app/api/social/challenges/pending/route.ts` — GET list pending challenges

### Steps

- [ ] Create `src/app/api/social/challenge/route.ts`

```typescript
// src/app/api/social/challenge/route.ts
import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { putItem } from "@/lib/dynamodb"
import { getUser } from "@/lib/users"
import { sendNotification } from "@/lib/notifications"
import { v4 as uuidv4 } from "uuid"

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const challengerId = session.user.id
  const { challengedId } = await req.json() as { challengedId: string }

  if (!challengedId || challengedId === challengerId) {
    return NextResponse.json({ error: "Invalid challengedId" }, { status: 400 })
  }

  const [challenger, challenged] = await Promise.all([
    getUser(challengerId),
    getUser(challengedId),
  ])

  if (!challenger || !challenged) {
    return NextResponse.json({ error: "User not found" }, { status: 404 })
  }

  const challengeId = uuidv4()
  const now = Date.now()
  // 5-minute TTL (epoch seconds for DynamoDB TTL attribute)
  const expiresAt = Math.floor((now + 5 * 60 * 1000) / 1000)

  await putItem({
    pk: `CHALLENGE#${challengeId}`,
    sk: "META",
    challengeId,
    challengerId,
    challengerDisplayName: challenger.displayName,
    challengedId,
    challengedDisplayName: challenged.displayName,
    status: "pending",
    createdAt: now,
    expiresAt,
  })

  // Write user-side index items so the pending list route can query efficiently
  await Promise.all([
    putItem({
      pk: `USER#${challengerId}`,
      sk: `CHALLENGE_SENT#${challengeId}`,
      challengeId,
      expiresAt, // same 5-min TTL
    }),
    putItem({
      pk: `USER#${challengedId}`,
      sk: `CHALLENGE_RECV#${challengeId}`,
      challengeId,
      expiresAt,
    }),
  ])

  await sendNotification(challengedId, {
    type: "challenge_received",
    fromUserId: challengerId,
    fromDisplayName: challenger.displayName,
    challengeId,
  })

  return NextResponse.json({ challengeId })
}
```

- [ ] Create `src/app/api/social/challenge/respond/route.ts`

```typescript
// src/app/api/social/challenge/respond/route.ts
import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { getItem, updateItem } from "@/lib/dynamodb"
import { sendNotification } from "@/lib/notifications"
import { createGame } from "@/lib/game"
import { selectBugForGame } from "@/lib/bugs"
import { getUser } from "@/lib/users"

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const userId = session.user.id
  const { challengeId, action } = await req.json() as {
    challengeId: string
    action: "accept" | "decline"
  }

  if (!challengeId || !["accept", "decline"].includes(action)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  const item = await getItem(`CHALLENGE#${challengeId}`, "META")
  if (!item) {
    return NextResponse.json({ error: "Challenge not found or expired" }, { status: 404 })
  }

  if (item.challengedId !== userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  if (item.status !== "pending") {
    return NextResponse.json({ error: "Challenge already resolved" }, { status: 409 })
  }

  if (action === "decline") {
    await updateItem(`CHALLENGE#${challengeId}`, "META", { status: "declined" })
    await sendNotification(item.challengerId as string, {
      type: "challenge_declined",
      fromUserId: userId,
      fromDisplayName: item.challengedDisplayName as string,
      challengeId,
    })
    return NextResponse.json({ status: "declined" })
  }

  // Accept: create a game between the two players
  await updateItem(`CHALLENGE#${challengeId}`, "META", { status: "accepted" })

  const [challengerProfile, challengedProfile] = await Promise.all([
    getUser(item.challengerId as string),
    getUser(userId),
  ])

  const bug = await selectBugForGame(
    Math.round(((challengerProfile?.elo ?? 1200) + (challengedProfile?.elo ?? 1200)) / 2),
    challengerProfile?.bugsSeen ?? [],
    challengedProfile?.bugsSeen ?? []
  )

  if (!bug) {
    return NextResponse.json({ error: "No bug available" }, { status: 503 })
  }

  const game = await createGame(
    item.challengerId as string,
    userId,
    bug.bugId
  )

  await sendNotification(item.challengerId as string, {
    type: "challenge_accepted",
    fromUserId: userId,
    fromDisplayName: item.challengedDisplayName as string,
    gameId: game.gameId,
    challengeId,
  })

  return NextResponse.json({ status: "accepted", gameId: game.gameId })
}
```

- [ ] Create `src/app/api/social/challenges/pending/route.ts`

```typescript
// src/app/api/social/challenges/pending/route.ts
// Queries user-side index items (CHALLENGE_SENT# / CHALLENGE_RECV#) written at challenge creation,
// then fetches each challenge's META for status filtering.
import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { queryItems, getItem } from "@/lib/dynamodb"

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const userId = session.user.id

  const [{ items: sentItems }, { items: recvItems }] = await Promise.all([
    queryItems(
      "pk = :pk AND begins_with(sk, :skPrefix)",
      { ":pk": `USER#${userId}`, ":skPrefix": "CHALLENGE_SENT#" }
    ),
    queryItems(
      "pk = :pk AND begins_with(sk, :skPrefix)",
      { ":pk": `USER#${userId}`, ":skPrefix": "CHALLENGE_RECV#" }
    ),
  ])

  const challengeIds = [
    ...sentItems.map((i) => (i.sk as string).replace("CHALLENGE_SENT#", "")),
    ...recvItems.map((i) => (i.sk as string).replace("CHALLENGE_RECV#", "")),
  ]

  const challengeItems = await Promise.all(
    challengeIds.map((id) => getItem(`CHALLENGE#${id}`, "META"))
  )

  const pending = challengeItems
    .filter((item) => item !== null && item.status === "pending")
    .map((item) => ({
      challengeId: item!.challengeId as string,
      challengerId: item!.challengerId as string,
      challengerDisplayName: item!.challengerDisplayName as string,
      challengedId: item!.challengedId as string,
      challengedDisplayName: item!.challengedDisplayName as string,
      createdAt: item!.createdAt as number,
      expiresAt: item!.expiresAt as number,
      direction: item!.challengerId === userId ? "outgoing" : "incoming",
    }))

  return NextResponse.json({ challenges: pending })
}
```

- [ ] `git add src/app/api/social/challenge/ src/app/api/social/challenges/` && `git commit -m "feat: direct challenge API — send, respond (accept/decline), pending list with Redis notifications"`

---

## Task 6 — Private Games

### Files
- `src/lib/game.ts` — extend `Game` type with `isPrivate`/`affectsElo`, update `createGame` signature, guard Elo in `resolveGame`
- `src/app/api/game/private/route.ts` — POST create private game
- `src/app/api/game/join/[gameId]/route.ts` — GET join as player2
- `src/app/(game)/play/page.tsx` — handle `?join=gameId` query param
- `src/app/(social)/profile/[userId]/page.tsx` — "Create Private Game" button + copy-link modal

### Steps

- [ ] Extend `src/lib/game.ts` — update types, `createGame`, `itemToGame`, and guard Elo in `resolveGame`

**1. Extend the `Game` type:**

```typescript
export type Game = {
  gameId: string
  player1Id: string
  player2Id: string | null
  bugId: string
  status: GameStatus
  winnerId: string | null
  createdAt: number
  expiresAt: number
  // NEW fields:
  isPrivate: boolean
  affectsElo: boolean
}
```

**2. Add `CreateGameOptions` interface and update `createGame` signature:**

```typescript
export interface CreateGameOptions {
  isPrivate?: boolean
  affectsElo?: boolean
  /** When isPrivate=true and no player2 yet, game starts as "waiting" */
  waitForPlayer2?: boolean
}

export async function createGame(
  player1Id: string,
  player2Id: string | null,
  bugId: string,
  options: CreateGameOptions = {}
): Promise<Game> {
  const { isPrivate = false, affectsElo = true, waitForPlayer2 = false } = options

  const gameId = uuidv4()
  const now = Date.now()
  const expiresAt = Math.floor((now + 90 * 24 * 60 * 60 * 1000) / 1000)
  const status: GameStatus = waitForPlayer2 ? "waiting" : "active"

  const game: Game = {
    gameId,
    player1Id,
    player2Id,
    bugId,
    status,
    winnerId: null,
    createdAt: now,
    expiresAt,
    isPrivate,
    affectsElo,
  }

  await putItem({
    pk: `GAME#${gameId}`,
    sk: "META",
    gameId,
    player1Id,
    player2Id,
    bugId,
    status,
    winnerId: null,
    createdAt: now,
    expiresAt,
    isPrivate,
    affectsElo,
    gsi1pk: `ACTIVE_GAME#${player1Id}`,
    gsi1sk: gameId,
  })

  if (player2Id) {
    await putItem({
      pk: `GAME#${gameId}`,
      sk: `ACTIVE_PLAYER#${player2Id}`,
      gameId,
      userId: player2Id,
      expiresAt,
      gsi1pk: `ACTIVE_GAME#${player2Id}`,
      gsi1sk: gameId,
    })
  }

  return game
}
```

**3. Update `itemToGame` to include new fields:**

```typescript
function itemToGame(item: Record<string, unknown>): Game {
  return {
    gameId: item.gameId as string,
    player1Id: item.player1Id as string,
    player2Id: (item.player2Id as string | null) ?? null,
    bugId: item.bugId as string,
    status: item.status as GameStatus,
    winnerId: (item.winnerId as string | null) ?? null,
    createdAt: item.createdAt as number,
    expiresAt: item.expiresAt as number,
    isPrivate: (item.isPrivate as boolean) ?? false,
    affectsElo: (item.affectsElo as boolean) ?? true,
  }
}
```

**4. Guard Elo updates inside `resolveGame` with `shouldAffectElo` flag:**

```typescript
// Add near the top of resolveGame, after loading game:
const shouldAffectElo = game.affectsElo !== false

// Guard computeElo calls:
const p1EloAfter = shouldAffectElo
  ? computeElo(p1EloBefore, p2EloBefore, p1Score, p1Profile.gamesPlayed)
  : p1EloBefore

const p2EloAfter = shouldAffectElo && p2Profile
  ? computeElo(p2EloBefore, p1EloBefore, p2Score, p2Profile.gamesPlayed)
  : p2EloBefore

// Guard rank computation:
const p1NewRank = shouldAffectElo ? getRankFromElo(p1EloAfter) : p1Profile.rank

// Guard updateUser calls — only write elo/rank when shouldAffectElo:
await updateUser(game.player1Id, {
  ...(shouldAffectElo ? { elo: p1EloAfter, rank: p1NewRank } : {}),
  gamesPlayed: p1NewGamesPlayed,
  gamesWon: p1NewGamesWon,
  currentStreak: p1NewStreak,
  bestStreak: p1NewBestStreak,
  achievementsUnlocked: [
    ...(p1Profile.achievementsUnlocked ?? []),
    ...p1NewAchievements,
  ],
})

// Guard leaderboard updates:
if (shouldAffectElo) {
  await updateLeaderboardEntry(
    game.player1Id, p1EloBefore, p1EloAfter,
    p1Profile.displayName, p1Profile.avatar,
    p1NewGamesPlayed, p1NewGamesWon
  )
  // ... same for player2
}
```

- [ ] Create `src/app/api/game/private/route.ts`

```typescript
// src/app/api/game/private/route.ts
import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { createGame } from "@/lib/game"
import { selectBugForGame } from "@/lib/bugs"
import { getUser } from "@/lib/users"

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const player1Id = session.user.id
  const { bugId: requestedBugId } = (await req.json().catch(() => ({}))) as {
    bugId?: string
  }

  const player1Profile = await getUser(player1Id)

  const bug = await selectBugForGame(
    player1Profile?.elo ?? 1200,
    player1Profile?.bugsSeen ?? [],
    [],
    requestedBugId ? { forceBugId: requestedBugId } : undefined
  )

  if (!bug) {
    return NextResponse.json({ error: "Bug not found" }, { status: 404 })
  }

  const game = await createGame(player1Id, null, bug.bugId, {
    isPrivate: true,
    affectsElo: false,
    waitForPlayer2: true,
  })

  const baseUrl = process.env.NEXTAUTH_URL ?? "https://bughunt.vercel.app"
  const joinUrl = `${baseUrl}/play?join=${game.gameId}`

  return NextResponse.json({ gameId: game.gameId, joinUrl })
}
```

- [ ] Create `src/app/api/game/join/[gameId]/route.ts`

```typescript
// src/app/api/game/join/[gameId]/route.ts
import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { getItem, updateItem, putItem } from "@/lib/dynamodb"

export async function GET(
  req: NextRequest,
  { params }: { params: { gameId: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const userId = session.user.id
  const { gameId } = params

  const item = await getItem(`GAME#${gameId}`, "META")
  if (!item) {
    return NextResponse.json({ error: "Game not found" }, { status: 404 })
  }

  if (!item.isPrivate) {
    return NextResponse.json({ error: "Not a private game" }, { status: 400 })
  }

  if (item.status !== "waiting") {
    // Creator polling or game already active — return current status
    return NextResponse.json({ status: item.status as string, gameId })
  }

  if (item.player1Id === userId) {
    // Creator polling — game not yet joined
    return NextResponse.json({ status: "waiting", gameId })
  }

  // Join as player2: set player2Id and change status to active
  await updateItem(`GAME#${gameId}`, "META", {
    player2Id: userId,
    status: "active",
  })

  // Write GSI tracking item for player2
  await putItem({
    pk: `GAME#${gameId}`,
    sk: `ACTIVE_PLAYER#${userId}`,
    gameId,
    userId,
    expiresAt: item.expiresAt as number,
    gsi1pk: `ACTIVE_GAME#${userId}`,
    gsi1sk: gameId,
  })

  return NextResponse.json({ status: "joined", gameId })
}
```

- [ ] Update `src/app/(game)/play/page.tsx` to handle `?join=gameId` query param

```typescript
// Add inside the play page component:
const searchParams = useSearchParams()
const joinGameId = searchParams.get("join")

useEffect(() => {
  if (!session?.user?.id) return

  if (joinGameId) {
    // Skip matchmaking; join a specific private game
    handleJoinPrivateGame(joinGameId)
    return
  }

  // ... existing matchmaking logic
}, [session?.user?.id, joinGameId])

async function handleJoinPrivateGame(gameId: string) {
  const res = await fetch(`/api/game/join/${gameId}`)
  if (res.ok) {
    const data = await res.json() as { status: string; gameId: string }
    if (data.status === "joined" || data.status === "active") {
      router.push(`/game/${gameId}`)
    } else if (data.status === "waiting") {
      // Creator view: poll until opponent joins
      router.push(`/game/${gameId}`)
    }
  } else {
    const err = await res.json() as { error: string }
    setError(err.error ?? "Could not join game")
  }
}
```

- [ ] Add "Create Private Game" button and copy-link modal to own profile in `src/app/(social)/profile/[userId]/page.tsx`

```tsx
// New state:
const [privateGameUrl, setPrivateGameUrl] = useState<string | null>(null)
const [creatingPrivate, setCreatingPrivate] = useState(false)

// Handler:
async function createPrivateGame() {
  setCreatingPrivate(true)
  try {
    const res = await fetch("/api/game/private", { method: "POST" })
    if (res.ok) {
      const data = await res.json() as { joinUrl: string }
      setPrivateGameUrl(data.joinUrl)
    }
  } finally {
    setCreatingPrivate(false)
  }
}

// Button (add next to "Play Now" on own profile):
{isOwnProfile && (
  <div className="flex items-center gap-2">
    <Button onClick={() => router.push("/play")} size="lg">
      Play Now
    </Button>
    <Button
      onClick={createPrivateGame}
      disabled={creatingPrivate}
      variant="outline"
      size="sm"
    >
      {creatingPrivate ? "Creating..." : "Private Game"}
    </Button>
  </div>
)}

// Copy-link modal (render at bottom of component, conditionally):
{privateGameUrl && (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
    <div className="w-full max-w-sm space-y-4 rounded-2xl border border-white/10 bg-zinc-900 p-6">
      <h2 className="text-lg font-bold text-white">Private Game Link</h2>
      <p className="text-sm text-white/60">
        Share this link with your opponent. The game is not rated.
      </p>
      <div className="flex gap-2">
        <input
          readOnly
          value={privateGameUrl}
          className="flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white"
        />
        <Button
          size="sm"
          onClick={() => navigator.clipboard.writeText(privateGameUrl)}
        >
          Copy
        </Button>
      </div>
      <Button
        variant="secondary"
        className="w-full"
        onClick={() => setPrivateGameUrl(null)}
      >
        Close
      </Button>
    </div>
  </div>
)}
```

- [ ] `git add src/lib/game.ts src/app/api/game/private/ src/app/api/game/join/ src/app/(social)/profile/ src/app/(game)/play/` && `git commit -m "feat: private games with join link, affectsElo=false skips Elo + leaderboard updates"`

---

## Task 7 — Post-Game Chat

### Files
- `src/app/api/game/[gameId]/chat/route.ts` — GET list messages, POST send message
- `src/components/game/GameChat.tsx` — chat thread + input with 5s polling
- `src/app/game/result/[gameId]/page.tsx` — render GameChat + private badge

### Steps

- [ ] Create `src/app/api/game/[gameId]/chat/route.ts`

```typescript
// src/app/api/game/[gameId]/chat/route.ts
import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { getItem, putItem, queryItems } from "@/lib/dynamodb"
import { getUser } from "@/lib/users"
import { v4 as uuidv4 } from "uuid"

const MAX_MESSAGES_PER_USER = 5
const MAX_MESSAGE_LENGTH = 200

type RouteContext = { params: { gameId: string } }

export async function GET(_req: NextRequest, { params }: RouteContext) {
  const { gameId } = params

  const { items } = await queryItems(
    "pk = :pk AND begins_with(sk, :skPrefix)",
    { ":pk": `GAME#${gameId}`, ":skPrefix": "CHAT#" },
    { scanIndexForward: false, limit: 10 }
  )

  const messages = items.map((item) => ({
    userId: item.userId as string,
    displayName: item.displayName as string,
    message: item.message as string,
    createdAt: item.createdAt as number,
  }))

  return NextResponse.json({ messages })
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const userId = session.user.id
  const { gameId } = params
  const { message } = await req.json() as { message: string }

  if (!message || typeof message !== "string") {
    return NextResponse.json({ error: "Missing message" }, { status: 400 })
  }

  const trimmed = message.trim().slice(0, MAX_MESSAGE_LENGTH)
  if (trimmed.length === 0) {
    return NextResponse.json({ error: "Empty message" }, { status: 400 })
  }

  // Verify game exists and user is a participant
  const gameItem = await getItem(`GAME#${gameId}`, "META")
  if (!gameItem) {
    return NextResponse.json({ error: "Game not found" }, { status: 404 })
  }

  const participantIds = [
    gameItem.player1Id as string,
    gameItem.player2Id as string,
  ].filter(Boolean)

  if (!participantIds.includes(userId)) {
    return NextResponse.json({ error: "Forbidden — not a participant" }, { status: 403 })
  }

  if (gameItem.status !== "completed") {
    return NextResponse.json({ error: "Chat only available after game completion" }, { status: 400 })
  }

  // Count existing messages from this user in this game
  const { items: existingMessages } = await queryItems(
    "pk = :pk AND begins_with(sk, :skPrefix)",
    { ":pk": `GAME#${gameId}`, ":skPrefix": "CHAT#" }
  )

  const userMessageCount = existingMessages.filter(
    (item) => item.userId === userId
  ).length

  if (userMessageCount >= MAX_MESSAGES_PER_USER) {
    return NextResponse.json(
      { error: `Maximum ${MAX_MESSAGES_PER_USER} messages per player` },
      { status: 429 }
    )
  }

  const user = await getUser(userId)
  const now = Date.now()
  const msgId = uuidv4()

  await putItem({
    pk: `GAME#${gameId}`,
    sk: `CHAT#${now}#${userId}`,
    msgId,
    userId,
    displayName: user?.displayName ?? "Unknown",
    message: trimmed,
    createdAt: now,
    expiresAt: gameItem.expiresAt as number, // inherit game TTL (90 days)
  })

  return NextResponse.json({ success: true, msgId })
}
```

- [ ] Create `src/components/game/GameChat.tsx`

```tsx
// src/components/game/GameChat.tsx
"use client"

import { useEffect, useRef, useState } from "react"
import { useSession } from "next-auth/react"
import { Button } from "@/components/ui/button"

type ChatMessage = {
  userId: string
  displayName: string
  message: string
  createdAt: number
}

interface GameChatProps {
  gameId: string
}

const MAX_MESSAGE_LENGTH = 200
const MAX_MESSAGES_PER_USER = 5

export function GameChat({ gameId }: GameChatProps) {
  const { data: session } = useSession()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState("")
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const myMessageCount = messages.filter(
    (m) => m.userId === session?.user?.id
  ).length
  const canSend = myMessageCount < MAX_MESSAGES_PER_USER

  async function fetchMessages() {
    try {
      const res = await fetch(`/api/game/${gameId}/chat`)
      if (res.ok) {
        const data = await res.json() as { messages: ChatMessage[] }
        // API returns newest-first; reverse for chronological display
        setMessages(data.messages.slice().reverse())
      }
    } catch {
      // silently ignore poll errors
    }
  }

  useEffect(() => {
    fetchMessages()
    intervalRef.current = setInterval(fetchMessages, 5_000)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId])

  async function handleSend() {
    if (!input.trim() || sending || !canSend) return
    setSending(true)
    setError(null)
    try {
      const res = await fetch(`/api/game/${gameId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: input.trim() }),
      })
      if (res.ok) {
        setInput("")
        await fetchMessages()
      } else {
        const data = await res.json() as { error: string }
        setError(data.error ?? "Failed to send")
      }
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-white/10 bg-white/5 p-4">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-white/50">
        Post-Game Chat
      </h3>

      {messages.length === 0 ? (
        <p className="text-sm text-white/30">No messages yet. Say gg!</p>
      ) : (
        <ul className="space-y-2">
          {messages.map((msg, idx) => (
            <li key={idx} className="flex gap-2 text-sm">
              <span className="shrink-0 font-semibold text-white/70">
                {msg.displayName}:
              </span>
              <span className="text-white/90">{msg.message}</span>
            </li>
          ))}
        </ul>
      )}

      {session?.user?.id && (
        <div className="space-y-1">
          {canSend ? (
            <div className="flex gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value.slice(0, MAX_MESSAGE_LENGTH))}
                onKeyDown={(e) => e.key === "Enter" && handleSend()}
                placeholder="Say something..."
                className="flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-1 focus:ring-white/20"
              />
              <Button
                size="sm"
                onClick={handleSend}
                disabled={sending || !input.trim()}
              >
                Send
              </Button>
            </div>
          ) : (
            <p className="text-xs text-white/30">
              You&apos;ve sent {MAX_MESSAGES_PER_USER} messages (limit reached).
            </p>
          )}
          {error && <p className="text-xs text-red-400">{error}</p>}
          <p className="text-right text-xs text-white/20">
            {myMessageCount}/{MAX_MESSAGES_PER_USER} messages
          </p>
        </div>
      )}
    </div>
  )
}
```

- [ ] Add `GameChat` and private badge to `src/app/game/result/[gameId]/page.tsx`

```tsx
import { GameChat } from "@/components/game/GameChat"

// In the JSX, after the Play Again button:
<GameChat gameId={gameId} />

// Private game badge — render when affectsElo is false:
{game && !game.affectsElo && (
  <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-0.5 text-xs font-medium text-white/60">
    Private · No Elo change
  </span>
)}
```

- [ ] `git add src/app/api/game/ src/components/game/GameChat.tsx src/app/game/result/` && `git commit -m "feat: post-game chat (5 messages/player cap, 200-char limit, 5s polling on result page)"`

---

## Task 8 — Streak Shields

### Files
- `src/lib/users.ts` — add `streakShields: number` to `UserProfile`
- `src/lib/game.ts` — shield consumption logic in `resolveGame`, shield grants in `checkAchievements`
- `src/components/layout/Navbar.tsx` — show `🛡️×N` next to streak
- `src/app/game/result/[gameId]/page.tsx` — "Shield used — streak preserved!" toast
- `src/app/(social)/profile/[userId]/page.tsx` — show shield count on profile

### Steps

- [ ] Update `src/lib/users.ts` — add `streakShields` field

In the `UserProfile` type, add:
```typescript
streakShields: number
```

In `getUser`, add to the profile mapping:
```typescript
streakShields: (item.streakShields as number) ?? 0,
```

In `updateUser`, add to the returned profile mapping:
```typescript
streakShields: (item.streakShields as number) ?? 0,
```

- [ ] Update `src/lib/game.ts` — shield grants in `checkAchievements` and shield consumption in `resolveGame`

**1. Change `checkAchievements` to return both new achievements and a shield grant count:**

```typescript
function checkAchievements(
  profile: UserProfile,
  newProfile: {
    gamesPlayed: number
    gamesWon: number
    currentStreak: number
    elo: number
  }
): { achievements: string[]; shieldGrant: number } {
  const already = new Set(profile.achievementsUnlocked ?? [])
  const newOnes: string[] = []
  let shieldGrant = 0

  if (!already.has("first_win") && newProfile.gamesWon >= 1) newOnes.push("first_win")
  if (!already.has("games_10") && newProfile.gamesPlayed >= 10) {
    newOnes.push("games_10")
    shieldGrant += 1 // every 10 games: +1 shield
  }
  if (!already.has("games_100") && newProfile.gamesPlayed >= 100) newOnes.push("games_100")
  if (!already.has("streak_5") && newProfile.currentStreak >= 5) newOnes.push("streak_5")
  if (!already.has("streak_10") && newProfile.currentStreak >= 10) newOnes.push("streak_10")

  // Rank tier unlocks grant +2 shields each
  const RANK_THRESHOLDS: Record<string, number> = {
    elo_1400: 1400,
    elo_1600: 1600,
    elo_2000: 2000,
  }
  for (const [key, threshold] of Object.entries(RANK_THRESHOLDS)) {
    if (!already.has(key) && newProfile.elo >= threshold) {
      newOnes.push(key)
      shieldGrant += 2 // new rank tier: +2 shields
    }
  }

  return { achievements: newOnes, shieldGrant }
}
```

**2. Update `checkAchievements` call site for player1 in `resolveGame`:**

```typescript
// Replace:
const p1NewAchievements = checkAchievements(p1Profile, { ... })

// With:
const { achievements: p1NewAchievements, shieldGrant: p1ShieldGrant } = checkAchievements(
  p1Profile,
  {
    gamesPlayed: p1NewGamesPlayed,
    gamesWon: p1NewGamesWon,
    currentStreak: p1NewStreak,  // NOTE: computed below — see step 3
    elo: p1EloAfter,
  }
)
```

**3. Replace the player1 streak calculation with shield-consuming loss logic:**

```typescript
// Replace:
const p1NewStreak = p1Won
  ? p1Profile.currentStreak + 1
  : p1Drew
  ? p1Profile.currentStreak
  : 0

// With:
let p1NewStreak: number
let p1ShieldUsed = false
let p1NewShieldsBase = p1Profile.streakShields ?? 0

if (p1Won) {
  p1NewStreak = p1Profile.currentStreak + 1
} else if (p1Drew) {
  p1NewStreak = p1Profile.currentStreak
} else {
  // Loss: consume a shield if available and streak is worth protecting
  if (p1Profile.streakShields > 0 && p1Profile.currentStreak > 0) {
    p1NewStreak = p1Profile.currentStreak  // shield absorbs the loss
    p1NewShieldsBase = p1Profile.streakShields - 1
    p1ShieldUsed = true
  } else {
    p1NewStreak = 0
    p1NewShieldsBase = p1Profile.streakShields ?? 0
  }
}

// Cap at 3 after applying any achievement grants
const p1NewShields = Math.min(3, p1NewShieldsBase + p1ShieldGrant)
```

**4. Include `streakShields` and `shieldUsed` in player1's `updateUser` and history write:**

```typescript
await updateUser(game.player1Id, {
  ...(shouldAffectElo ? { elo: p1EloAfter, rank: p1NewRank } : {}),
  gamesPlayed: p1NewGamesPlayed,
  gamesWon: p1NewGamesWon,
  currentStreak: p1NewStreak,
  bestStreak: p1NewBestStreak,
  streakShields: p1NewShields,
  achievementsUnlocked: [
    ...(p1Profile.achievementsUnlocked ?? []),
    ...p1NewAchievements,
  ],
})

// Add shieldUsed to p1HistoryFields so result page can read it:
const p1HistoryFields = {
  // ... all existing fields ...
  shieldUsed: p1ShieldUsed,
}
```

**5. Mirror the identical shield-consumption pattern for player2 in the p2 branch of `resolveGame`.**

- [ ] Update `src/components/layout/Navbar.tsx` — show shield count next to streak

```tsx
// In the Navbar streak display area:
{profile?.currentStreak > 0 && (
  <span className="flex items-center gap-1 text-sm font-semibold text-orange-400">
    🔥 {profile.currentStreak}
    {(profile.streakShields ?? 0) > 0 && (
      <span className="ml-1 text-blue-400">
        🛡️×{profile.streakShields}
      </span>
    )}
  </span>
)}
```

- [ ] Update `src/app/game/result/[gameId]/page.tsx` — shield used toast/banner

```tsx
// After loading match history entry:
const shieldUsed = matchEntry?.shieldUsed ?? false

// In JSX, near the result header:
{shieldUsed && (
  <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 px-4 py-2 text-center text-sm font-medium text-blue-300">
    🛡️ Shield used — streak preserved!
  </div>
)}
```

- [ ] Update `src/app/(social)/profile/[userId]/page.tsx` — display shield count

In `PublicProfile` type:
```typescript
streakShields?: number
```

In JSX, alongside the streak:
```tsx
{profile.currentStreak > 0 && (
  <span className="text-sm font-semibold text-orange-400">
    🔥 {profile.currentStreak}
  </span>
)}
{(profile.streakShields ?? 0) > 0 && (
  <span className="text-sm font-semibold text-blue-400">
    🛡️×{profile.streakShields}
  </span>
)}
```

Also update `src/app/api/user/profile/[userId]/route.ts` to include `streakShields` in the public profile response.

- [ ] `git add src/lib/users.ts src/lib/game.ts src/components/layout/Navbar.tsx src/app/game/result/ src/app/(social)/profile/ src/app/api/user/profile/` && `git commit -m "feat: streak shields — achievement grants (+1 per 10 games, +2 per rank tier), loss absorption, UI in Navbar/result/profile"`

---

## Post-Implementation Verification

Run after all tasks are complete:

```bash
npx tsc --noEmit
npm test -- --run
npm run dev
```

Smoke-test checklist:
- [ ] `POST /api/social/follow` creates both DynamoDB items (FOLLOWS# forward + FOLLOWER# reverse) and increments counters
- [ ] `DELETE /api/social/follow?followeeId=X` removes both items and decrements counters
- [ ] Profile page shows Follow/Unfollow button and Challenge button for other users; counts update optimistically
- [ ] Feed page shows games from followed users in reverse-chronological order with W/L/D color badges
- [ ] SSE endpoint at `/api/notifications/stream` opens, sends heartbeat comments every 25s, closes cleanly on disconnect
- [ ] Sending a challenge writes `CHALLENGE#<id>/META`, two index items, and triggers Redis pub/sub to challenged user's SSE stream
- [ ] Accepting a challenge creates an active game and notifies challenger via SSE
- [ ] `POST /api/game/private` returns `{ gameId, joinUrl }`; created game has `isPrivate: true`, `affectsElo: false`, `status: "waiting"`
- [ ] Visiting `/play?join=<gameId>` as a second user sets `player2Id` and `status: "active"` on game META
- [ ] Elo and leaderboard entries are NOT updated for games where `affectsElo: false`
- [ ] `POST /api/game/<id>/chat` rejects more than 5 messages from the same user (HTTP 429)
- [ ] `POST /api/game/<id>/chat` rejects messages longer than 200 characters (silently truncated server-side)
- [ ] `GameChat` component polls every 5s and displays messages in chronological order
- [ ] Losing a game with `streakShields > 0` and `currentStreak > 0` preserves streak, decrements shields by 1, sets `shieldUsed: true` in history
- [ ] `checkAchievements` grants +1 shield at 10 games played; +2 shields per new rank tier unlock; total capped at 3
- [ ] Navbar displays `🔥 <streak> 🛡️×<shields>` when both streak and shields are positive
- [ ] Result page shows "🛡️ Shield used — streak preserved!" banner when `shieldUsed` is true on match history entry

---

## DynamoDB Entity Summary

| PK | SK | Description |
|---|---|---|
| `USER#<followerId>` | `FOLLOWS#<followeeId>` | Follow relationship (forward) |
| `USER#<followeeId>` | `FOLLOWER#<followerId>` | Follow relationship (reverse index) |
| `USER#<userId>` | `PROFILE` | User profile (extended with `streakShields`, `followerCount`, `followingCount`) |
| `USER#<challengerId>` | `CHALLENGE_SENT#<challengeId>` | Challenge sent index (5-min TTL) |
| `USER#<challengedId>` | `CHALLENGE_RECV#<challengeId>` | Challenge received index (5-min TTL) |
| `USER#<userId>` | `NOTIF#<ts>#<notifId>` | Notification record (30-day TTL) |
| `CHALLENGE#<challengeId>` | `META` | Challenge entity (5-min TTL) |
| `GAME#<gameId>` | `META` | Game entity (extended with `isPrivate`, `affectsElo`) |
| `GAME#<gameId>` | `CHAT#<ts>#<userId>` | Post-game chat message (inherits 90-day game TTL) |

---

## Dependency Order

- **Tasks 1–3** (follow system + feed) are independent and can be implemented in parallel.
- **Task 4** (notifications + `src/lib/notifications.ts`) must land before **Task 5** (challenges use `sendNotification`).
- **Task 5** (challenges) depends on Task 4.
- **Task 6** (private games) requires the `createGame` signature change in `src/lib/game.ts` — apply the game.ts edits before creating the API routes.
- **Task 7** (chat) is independent of Tasks 4–6.
- **Task 8** (streak shields) shares `src/lib/game.ts` edits with Task 6 — apply all changes to `resolveGame` and `checkAchievements` together in a single edit pass to avoid merge conflicts.
- `src/lib/redis.ts` must already exist (from Plan 1) before Tasks 4 and 5 can compile.
