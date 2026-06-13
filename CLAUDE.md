@AGENTS.md

# BugHunt — Codebase Guide

Competitive debugging game built for the H0 Hackathon. Two players race to identify bugs in code snippets. Built on Next.js 16 App Router, DynamoDB single-table, Upstash Redis, NextAuth v5, and Amazon Bedrock Nova.

## Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16.2 (App Router, Turbopack) |
| Auth | NextAuth v5 beta (Google + GitHub OAuth) |
| Database | DynamoDB single-table (`bughunt-main`) |
| Cache / Queue | Upstash Redis (matchmaking queue, rate limiting, pub/sub) |
| AI | Amazon Bedrock Nova (bug quality filter for community submissions) |
| Hosting | Vercel |
| OG Images | `@vercel/og` |

## Environment Variables

```
AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
NEXTAUTH_URL, NEXTAUTH_SECRET
GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET
ADMIN_EMAILS                          # comma-separated, gates /admin routes
DYNAMODB_TABLE_NAME                   # default: bughunt-main
REDIS_URL                             # rediss://... (Upstash TLS URL)
UPSTASH_REDIS_REST_URL                # https://...upstash.io
UPSTASH_REDIS_REST_TOKEN
CRON_SECRET                           # Bearer token for cron route auth
BEDROCK_REGION                        # default: us-east-1
```

## Key Directories

```
src/
  app/
    (game)/          # play, practice, daily, submit-bug pages
    admin/           # bug management UI
    api/             # all route handlers (see API Routes below)
    game/result/     # post-game result page
    leaderboard/     # leaderboard + season view
    org/             # org/team pages
    tournaments/     # tournament bracket pages
    profile/         # user profile pages
  components/
    game/            # GameResult, CodeViewer, AnswerButtons
    layout/          # Navbar
    ui/              # Button, shared primitives
  lib/
    dynamodb.ts      # DynamoDB helpers (putItem, getItem, queryItems…)
    game.ts          # createGame, getGame, resolveGame, getActiveGameForUser
    users.ts         # getUser, updateUser, getMatchHistory
    bugs.ts          # selectBugForGame, createBug, getPendingBugs
    redis.ts         # enqueuePlayer, findAndClaimMatch, dequeuePlayer, rateLimitCheck, publishGameEvent
    daily.ts         # getDailyChallenge, submitDailyAnswer
    tournaments.ts   # createTournament, registerForTournament
    orgs.ts          # createOrg, getUserOrgs
    notifications.ts # sendNotification
    seasons.ts       # season logic
    test-auth.ts     # getTestSession (x-test-user-id header), getTestSessionFromCookies
tests/
  api/               # API integration tests (TEST_MODE=true)
  e2e/               # Playwright end-to-end tests
  helpers/           # db.ts (seed/cleanup), fixtures.ts, auth.ts
```

## API Routes

```
/api/game/matchmake         POST  — Redis-backed ELO queue matchmaking
/api/game/stream            GET   — SSE game events (DynamoDB polling fallback)
/api/game/status            GET   — game + bug for active game
/api/game/submit            POST  — submit answer, resolve game
/api/game/[gameId]          GET   — full game detail (result page)
/api/game/cancel            POST  — cancel matchmaking
/api/game/rematch           POST  — send rematch intent (60s TTL)
/api/game/rematch/status    GET   — check mutual rematch, create game if matched
/api/game/private           POST  — create private game with join link
/api/game/join/[gameId]     POST  — join private game as player 2
/api/game/[gameId]/chat     GET/POST — post-game chat (5 msg limit per player)

/api/daily                  GET   — today's daily challenge
/api/daily/[date]           GET   — historical daily challenge
/api/daily/submit           POST  — submit daily answer
/api/cron/daily-challenge   POST  — seed today's daily (CRON_SECRET required)
/api/cron/tournament-tick   POST  — advance tournament rounds

/api/social/follow          POST  — follow/unfollow a user
/api/social/following       GET   — users I follow
/api/social/followers       GET   — users following me
/api/social/feed            GET   — recent games from followed users
/api/social/challenge       POST  — send direct challenge (5 min TTL)
/api/social/challenge/respond POST — accept or decline challenge
/api/social/challenges/pending GET — my sent and received challenges

/api/notifications          GET/POST — list notifications / mark read
/api/notifications/stream   GET   — SSE notification stream

/api/tournaments            GET/POST — list / create tournament (admin)
/api/tournaments/[id]       GET   — tournament detail + bracket
/api/tournaments/[id]/register POST — register for tournament

/api/org                    GET/POST — list my orgs / create org
/api/org/[id]               GET   — org detail
/api/org/[id]/invite        POST  — invite member
/api/org/[id]/leaderboard   GET   — org leaderboard
/api/org/join               POST  — join org by invite code

/api/bugs/random            GET   — random bug for practice
/api/bugs/submit            POST  — community bug submission (Bedrock quality filter)
/api/bugs/my-submissions    GET   — my pending submissions
/api/bugs/[id]/rate         POST  — rate bug difficulty (1-3, once per user)

/api/user/profile           GET/PATCH — own profile
/api/user/profile/[userId]  GET   — public profile
/api/user/history           GET   — match history
/api/user/token             GET/POST/DELETE — VS Code extension API token

/api/admin/bugs             GET/POST — list/approve community bugs (admin)
/api/admin/bugs/[id]        PATCH/DELETE — edit/reject bug (admin)
/api/admin/bugs/generate    POST  — generate bug with Bedrock (admin)
/api/admin/bugs/health      GET   — system health (admin)
/api/admin/check            GET   — is current user admin?

/api/og/result              GET   — OG image for result share card
```

## Test Setup

Auth in tests uses `x-test-user-id` header (API tests) or `test-user-id` cookie (E2E).  
Routes must call `getTestSession(req)` as a fallback to support this — new routes MUST include it.

```bash
npm run test:unit   # 42 unit tests (elo, rank, bugs, seasons, game, redis-helpers)
npm run test:api    # 98 API integration tests (TEST_MODE=true, real DynamoDB)
npm run test        # unit + API
TEST_MODE=true npx playwright test  # 37 E2E tests (dev server must be running with TEST_MODE=true)
```

## DynamoDB Key Patterns

```
USER#<userId>  / PROFILE               — user profile
USER#<userId>  / FOLLOWS#<followeeId>  — follow edge
USER#<userId>  / FOLLOWER#<followerId> — reverse follow index
USER#<userId>  / NOTIF#<ts>#<id>       — notification
USER#<userId>  / HISTORY#<ts>#<gameId> — match history entry
USER#<userId>  / CHALLENGE_SENT#<id>   — challenge sent index
USER#<userId>  / CHALLENGE_RECV#<id>   — challenge received index
GAME#<gameId>  / META                  — game record (gsi1pk = ACTIVE_GAME#player1Id)
GAME#<gameId>  / ACTIVE_PLAYER#<p2Id>  — tracks player2's active game (gsi1pk = ACTIVE_GAME#player2Id)
GAME#<gameId>  / CHAT#<ts>#<userId>    — post-game chat message
GAME#<gameId>  / ANSWER#<userId>       — player's submitted answer
BUG#<bugId>    / META                  — bug record
BUG#INDEX      / META                  — list of active bug IDs (bugIds[])
DAILY#<date>   / META                  — daily challenge record
DAILY#<date>   / ENTRY#<userId>        — user's daily submission
CHALLENGE#<id> / META                  — direct challenge
TOURNAMENT#<id>/ META                  — tournament
ORG#<id>       / META                  — org
REMATCH#<uid>  / <opponentId>          — rematch intent (60s TTL)
```

## Matchmaking Flow

1. Player calls `POST /api/game/matchmake` → enqueued in Upstash Redis sorted set by ELO bucket
2. Next caller with compatible ELO → `findAndClaimMatch(userId, elo)` selects AND `zrem`s the candidate atomically (only "wins" the claim if `zrem` returns `> 0`, preventing two concurrent callers from both grabbing the same opponent) → `createGame` → returns `{status:"active", gameId}`. If the match attempt subsequently aborts (no bugs available, `createGame` conditional failure), the claimed opponent is re-enqueued.
3. Waiting player polls matchmake every 3s → `getActiveGameForUser` finds the ACTIVE_PLAYER tracking item → returns active game
4. Both clients open `GET /api/game/stream?gameId=...` SSE — pushed via TCP pub/sub (`src/lib/redis-sub.ts`, gated behind `REDIS_URL`) with a 10s safety poll, falling back to 2s DynamoDB polling if `REDIS_URL`/pub/sub is unavailable
5. On game resolve → `publishGameEvent` → SSE pushes `game_resolved` → clients redirect to `/game/result/[gameId]`

## Conditional-Write Patterns (read this before writing any new mutation logic)

Plain `updateItem`/`putItem` (SET-based, no `ConditionExpression` support) is a TOCTOU race against any shared/contended state — a read-check-then-write can be interleaved by a concurrent request. The standard fix used throughout the codebase:

- Drop to `ddb.send(new UpdateCommand/PutCommand/DeleteCommand({ ConditionExpression: ... }))` directly and catch `ConditionalCheckFailedException` (check `err.name === "ConditionalCheckFailedException"`). Treat the caught exception as "someone else won the race" and branch accordingly (no-op, retry, or return a conflict response) — do not let it bubble as a 500.
- Examples to imitate: `resolveGame` (atomic claim before side-effects, prevents double-resolution), `join/[gameId]/route.ts` (conditional join), `[gameId]/chat/route.ts` (conditional per-user message counter via `ADD` + `ConditionExpression: "attribute_not_exists(#cnt) OR #cnt < :max"`), `social/follow/route.ts` (conditional create/delete of follow edges gating counter updates), `social/challenge/respond/route.ts` (conditional status transition), `tournaments.ts registerForTournament` / `orgs.ts joinOrg` (atomic `putItemIfNotExists` + conditional capacity check with compensating rollback on failure).
- **Versioned/optimistic-concurrency fields**: when a shared item (e.g. `BUG#INDEX` / META, which carries `version: number`) is mutated via read-modify-write, condition on `attribute_not_exists(version) OR version = :expectedVersion` — the `attribute_not_exists` clause is REQUIRED, not optional, because DynamoDB evaluates `version = :v` as `false` (not an error) when the attribute is absent on legacy items, so a bare `version = :expectedVersion` condition would permanently fail every write against any item written before the field existed. `bugs.ts`'s `mutateBugIndex(mutate)` wraps this read-modify-write with up to 3 retries, re-fetching via `getBugIndex({ bypassCache: true })` each retry — the 5-minute index cache MUST be bypassed on retry or you'll keep re-applying the mutation against a stale version forever. `createBug`/`approveBug`/`rejectBug` all go through `mutateBugIndex`.

If you're adding new mutation logic against any shared counter, index, queue slot, or status-transition field, follow this pattern — plain `updateItem` is not an acceptable shortcut for anything that can race.

## Gotchas

- `@upstash/redis` HTTP client has no `subscribe` method — the game SSE stream (`/api/game/stream`) instead uses `src/lib/redis-sub.ts`'s `ioredis` TCP subscriber (`REDIS_URL`) for push with a 10s safety poll; the notifications SSE stream still uses `@upstash/redis`'s subscribe and falls back to DynamoDB polling every 2s when pub/sub is unavailable
- `getActiveGameForUser` prefers ACTIVE_PLAYER items (user is opponent) over META items (stale waiting game)
- Matchmake re-enqueues in Redis when returning an existing waiting game (prevents being invisible to opponents)
- `safeAuth()` alone blocks TEST_MODE — new routes must add `?? getTestSession(req) ?? getTestSessionFromCookies()`
- VS Code extension is excluded from root `tsconfig.json` (lives in `vscode-extension/` with its own tsconfig)
- Tournaments and Org routes use `safeAuth()` only — cannot be tested with `x-test-user-id` in TEST_MODE
- `dynamodb.ts queryItems` supports an optional `consistentRead?: boolean` → threaded to `QueryCommand`'s `ConsistentRead`. Use it for any read-immediately-after-write (e.g. counting siblings right after the user's own write) — eventually-consistent reads can miss recently-written items in the same partition.
- `cancel/route.ts` cancels matchmaking via `dequeuePlayer(userId, elo)` against the real Redis queue — do not reintroduce a DynamoDB-key-based cancel path (an old `MATCH#QUEUE#<range>` pattern existed that nothing ever wrote to, making cancel a silent no-op).
- `itemToBug` preserves `ratingCount`/`ratingSum` as `(item.X as number) ?? undefined` — keep "never rated" as `undefined`, not `0`, or you'll silently break the admin health view's misrating detection.
- Admin auth guards must `.filter(Boolean)` on `adminEmails` AND explicitly reject `!email` — otherwise an unset `ADMIN_EMAILS` plus a user with no email can both normalize to `""`, and `[""].includes("")` grants admin access.
- `/api/bugs/submit` runs the 3-per-day rate-limit check AFTER request validation (not before), so malformed requests don't burn a user's daily quota; the Bedrock quality-score parse validates `typeof parsed.score === "number"` before comparing (`NaN < 0.7` is `false`, so an unvalidated stringified score would silently pass low-quality submissions).
