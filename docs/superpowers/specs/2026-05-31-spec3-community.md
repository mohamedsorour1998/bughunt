# Spec 3 — Community Features

**Goal:** Add the social layer that keeps players coming back to each other — friends, direct challenges, private games, post-game chat, and streak protection.

**Depends on:** Spec 1 (Redis pub/sub for challenge notifications), Spec 2 (rematch button pattern).

---

## 1. Friend System

### What
Players can follow other players. A "Following" feed shows recent games from followed users. No mutual-follow required (Twitter model, not Facebook).

### DynamoDB entity
```
Follow relationship:
  PK: USER#<followerId>
  SK: FOLLOWS#<followeeId>
  Fields: followedAt, followeeDisplayName, followeeElo
  expiresAt: none (permanent)

Reverse index (for "followers" list):
  PK: USER#<followeeId>  
  SK: FOLLOWER#<followerId>
  Fields: followerDisplayName
```

### API routes
- `POST /api/social/follow` — `{ followeeId }` — create follow relationship
- `DELETE /api/social/follow/:followeeId` — unfollow
- `GET /api/social/following` — list users I follow (with their current Elo)
- `GET /api/social/followers` — list users following me
- `GET /api/social/feed` — recent games from users I follow (query FOLLOWS# items, batch-fetch histories)

### UI additions
- `src/app/(social)/profile/[userId]/page.tsx`: add Follow/Unfollow button
- `src/app/(social)/feed/page.tsx`: new — social feed showing friends' recent games
- Navbar: "Feed" link (shows unread count badge)

### Profile page additions
- Show follower/following counts
- "Challenge" button (see §2) next to Follow button

---

## 2. Direct Challenge

### What
Challenge a specific user to a game. They get a notification and can accept or decline. Game starts immediately when both are ready.

### Flow
1. Player A clicks "Challenge" on Player B's profile → `POST /api/social/challenge { challengedId }`
2. Server creates challenge in DynamoDB + publishes Redis event `notifications:{B}` → `{ type: "challenge_received", from: A, challengeId }`
3. Player B sees notification badge in Navbar (SSE-driven via `GET /api/notifications/stream`)
4. Player B clicks notification → sees challenge from A with "Accept" / "Decline"
5. `POST /api/social/challenge/respond { challengeId, action: "accept" | "decline" }`
6. If accepted: `createGame(A, B, bugId)` → both redirect to `/play?gameId=X`
7. If declined or no response within 5 minutes: challenge expires (TTL)

### DynamoDB entity
```
PK: CHALLENGE#<challengeId>
SK: META
Fields: challengerId, challengedId, status (pending/accepted/declined), createdAt
expiresAt: 5 minutes TTL
```

### Notification stream: `GET /api/notifications/stream`
- SSE endpoint (same pattern as game stream)
- Subscribes to Redis channel `notifications:{userId}`
- Delivers: challenge_received, challenge_accepted, friend_game_completed, daily_challenge_reminder
- Client: persistent EventSource opened on login, shows badge count in Navbar

### API routes
- `POST /api/social/challenge` — send challenge
- `POST /api/social/challenge/respond` — accept/decline
- `GET /api/social/challenges/pending` — list incoming + outgoing challenges
- `GET /api/notifications/stream` — SSE notification stream
- `GET /api/notifications` — list recent notifications (paginated)
- `POST /api/notifications/read` — mark as read

### DynamoDB entity — Notification
```
PK: USER#<userId>
SK: NOTIF#<timestamp>#<notifId>
Fields: type, fromUserId, fromDisplayName, gameId/challengeId, read, createdAt
expiresAt: 30 days TTL
```

---

## 3. Private Games

### What
Create a game with a specific bug (or random) and share a link. Anyone with the link can join as the opponent. Good for streamers, friends, and educational use.

### Flow
1. `POST /api/game/private { bugId?: string, difficulty?: number }` → creates game with `status: "waiting"`, `isPrivate: true`, returns `{ gameId, joinUrl }`
2. Join URL: `https://bughunt.vercel.app/play?join=<gameId>`
3. Visiting the URL: if game is waiting and visitor != creator, auto-joins as player2
4. Game proceeds normally

### DynamoDB addition
- `isPrivate: boolean` field on Game entity
- Private games don't affect Elo (add `affectsElo: boolean` field)

### API routes
- `POST /api/game/private` — create private game
- `GET /api/game/join/:gameId` — join as player2 (validates game is waiting + private)

### UI additions
- Result page: "Private" badge when `affectsElo: false`
- Play page: handle `?join=gameId` query param — skip matchmaking, join specific game
- Profile page: "Create Private Game" button → modal to select difficulty/bug

---

## 4. Post-Game Chat

### What
After a game resolves, both players can exchange up to 5 messages in a simple ephemeral chat. No real-time — async, fetch-based. Chat expires with the game (90 days TTL inherited).

### Why 5 messages only
Keeps it light, prevents abuse, no moderation infrastructure needed. Purpose: "gg", "nice find", "that was tricky" — social bonding, not debate.

### DynamoDB entity
```
PK: GAME#<gameId>
SK: CHAT#<timestamp>#<userId>
Fields: userId, displayName, message (max 200 chars), createdAt
expiresAt: inherited from game (90 days)
```

### API routes
- `GET /api/game/:gameId/chat` — list messages (max 10, newest first)
- `POST /api/game/:gameId/chat` — send message (auth, validate ≤5 messages from this user, validate ≤200 chars)

### UI addition
- `src/components/game/GameChat.tsx` — simple thread of messages + input
- Shown on `src/app/game/result/[gameId]/page.tsx` below Play Again button
- Auto-polls every 5s while on result page (simple interval, no SSE needed for 5 messages)

---

## 5. Streak Protection (Shields)

### What
Players earn "streak shields" from achievements. A shield protects a win streak from being broken by a single loss. Shields are consumed automatically before the streak resets.

### Logic change in `src/lib/game.ts resolveGame`
```typescript
// On loss:
if (user.streakShields > 0 && user.currentStreak > 0) {
  // consume shield, streak preserved
  newStreak = user.currentStreak
  newShields = user.streakShields - 1
  // achievement toast: "Streak Shield Used!"
} else {
  newStreak = 0
  newShields = user.streakShields
}
```

### DynamoDB addition
- `streakShields: number` field on User Profile (default: 0)

### Shield sources (new achievement triggers)
- Every 10 games played: +1 shield
- Reaching a new rank tier (Gold→Platinum, etc.): +2 shields
- Completing 7 consecutive daily challenges: +1 shield
- Maximum held: 3 shields

### UI additions
- Profile page: show shield count `🛡️ ×2`
- Result page: show "Streak Shield used — streak preserved!" toast when shield is consumed
- Navbar: show shield count next to streak `🔥 12 🛡️ ×1`

---

## Files created/modified
| File | Change |
|---|---|
| `src/app/api/social/follow/route.ts` | New — POST follow, DELETE unfollow |
| `src/app/api/social/following/route.ts` | New — GET following list |
| `src/app/api/social/followers/route.ts` | New — GET followers list |
| `src/app/api/social/feed/route.ts` | New — GET social feed |
| `src/app/api/social/challenge/route.ts` | New — POST send challenge |
| `src/app/api/social/challenge/respond/route.ts` | New — POST accept/decline |
| `src/app/api/social/challenges/pending/route.ts` | New — GET pending challenges |
| `src/app/api/notifications/stream/route.ts` | New — SSE notification stream |
| `src/app/api/notifications/route.ts` | New — GET/POST notifications |
| `src/app/api/game/private/route.ts` | New — POST create private game |
| `src/app/api/game/join/[gameId]/route.ts` | New — GET join private game |
| `src/app/api/game/[gameId]/chat/route.ts` | New — GET/POST game chat |
| `src/app/(social)/feed/page.tsx` | New — social feed page |
| `src/app/(social)/profile/[userId]/page.tsx` | Add follow + challenge buttons |
| `src/components/game/GameChat.tsx` | New — post-game chat component |
| `src/components/game/GameResult.tsx` | Add chat, private badge |
| `src/components/layout/Navbar.tsx` | Notification badge, shield display |
| `src/lib/game.ts` | Add streak shield logic |
| `src/lib/users.ts` | Add streakShields, dailyStreak fields |
