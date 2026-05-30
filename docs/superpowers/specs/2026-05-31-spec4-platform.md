# Spec 4 — Platform Features

**Goal:** Add tournament brackets, org/team mode, VS Code extension, and bug difficulty community ratings. These are the features that transform BugHunt from a game into a platform.

**Depends on:** Spec 1 (Redis, SSE), Spec 2 (daily challenge, OG images), Spec 3 (notifications).

---

## 1. Tournament Mode (Single Elimination)

### What
8-player bracket tournaments. Admin or auto-scheduled. Players register during a sign-up window, bracket auto-generates at start time, rounds play out asynchronously (like chess.com tournaments).

### Tournament lifecycle
```
created → registration_open → registration_closed → 
round_1 (active) → round_2 (active) → final (active) → completed
```

### DynamoDB entities

**Tournament:**
```
PK: TOURNAMENT#<id>
SK: META
Fields: tournamentId, name, status, format("single_elimination"),
        maxPlayers(8), registeredPlayers[], startTime, currentRound,
        winnerId, prizeDescription, createdAt
```

**Tournament Round:**
```
PK: TOURNAMENT#<id>
SK: ROUND#<roundNumber>#MATCH#<matchId>
Fields: player1Id, player2Id, gameId, winnerId, status
```

**Leaderboard entry (final standings):**
```
PK: LEADERBOARD#TOURNAMENT#<id>
SK: RANK#<position>#<userId>
Fields: userId, displayName, finalPosition, eloChange
```

**Registration:**
```
PK: TOURNAMENT#<id>
SK: PLAYER#<userId>
Fields: userId, displayName, elo, registeredAt, currentRound, eliminated
```

### Auto-scheduling (Vercel Cron)
- Weekly tournament: every Saturday 20:00 UTC
- `POST /api/cron/tournament-tick` — checks all active tournaments, advances rounds when all matches complete

### Tournament advancement logic
- When all matches in a round are completed: auto-generate next round pairings (higher seed vs lower seed)
- Round 1: 8 players → 4 matches, Round 2: 4 → 2, Final: 2 → 1
- Seeding: by Elo at registration time
- Byes: if odd registration count, highest seed gets bye

### API routes
- `GET /api/tournaments` — list upcoming + active + recent
- `GET /api/tournaments/:id` — bracket view (all rounds, all matches)
- `POST /api/tournaments/:id/register` — register for tournament
- `POST /api/tournaments/:id/unregister` — withdraw (only before start)
- `GET /api/tournaments/my` — my tournament history
- `POST /api/cron/tournament-tick` — advance tournament state (cron protected)

### Pages
- `src/app/(game)/tournaments/page.tsx` — list of tournaments with registration CTA
- `src/app/(game)/tournaments/[id]/page.tsx` — bracket visualization
  - SVG bracket: 3 columns (round 1, round 2, final), each match shows both players, winner highlighted
  - Live updates via SSE on match completions
  - "Watch Live" button on active matches (links to spectator mode — spec 4 bonus)

### Elo implications
- Tournament games affect regular Elo (normal K-factor)
- Tournament final placement earns bonus Elo: +50 for 1st, +25 for 2nd, +10 for 3rd-4th

### Notifications
- "Tournament starting in 1 hour" — 1h before start time
- "Your match is ready" — when paired with opponent in current round
- "You're through to Round 2!" — when opponent forfeits or loses

---

## 2. Org / Team Mode

### What
Companies and communities create private organizations with their own leaderboard and team challenges. Free for up to 5 members, unlimited at no charge (hackathon — no monetization).

### DynamoDB entities

**Organization:**
```
PK: ORG#<id>
SK: META
Fields: orgId, name, slug (URL-safe), adminId, memberCount,
        createdAt, inviteCode (random 8-char)
```

**Member:**
```
PK: ORG#<id>
SK: MEMBER#<userId>
Fields: userId, displayName, elo, joinedAt, role("admin"|"member")
```

**Org Leaderboard:**
```
PK: LEADERBOARD#ORG#<orgId>
SK: RANK#<paddedElo>#<userId>
```
Updated by Lambda (same Streams pipeline from Spec 1 — checks if player is in any org, updates org leaderboard).

**User → Org index:**
```
PK: USER#<userId>
SK: ORG#<orgId>
Fields: orgId, orgName, joinedAt
```

### API routes
- `POST /api/org` — create org (admin)
- `POST /api/org/join` — join via invite code `{ inviteCode }`
- `DELETE /api/org/:id/leave` — leave org
- `GET /api/org/:id` — org info + member list
- `GET /api/org/:id/leaderboard` — org leaderboard
- `POST /api/org/:id/invite` — regenerate invite code (admin only)
- `GET /api/org/my` — my org memberships

### Pages
- `src/app/(social)/org/page.tsx` — my orgs + create org form
- `src/app/(social)/org/[id]/page.tsx` — org leaderboard + member list + invite code (if admin)
- Join flow: visiting `/org/join?code=ABCD1234` auto-joins and redirects to org page

### Leaderboard page addition
- New tab "My Org" in LeaderboardTabs if user belongs to an org

---

## 3. VS Code Extension

### What
A VS Code extension that lets developers play BugHunt practice mode directly in the editor. No matchmaking — practice bugs only, with difficulty matching the current file's language.

### Architecture
- Extension ID: `bughunt.vscode-bughunt`
- Published to VS Code Marketplace
- Communicates with BugHunt API via HTTPS (no special backend)
- Auth: user pastes an API token from their BugHunt profile settings page

### Extension structure
```
vscode-extension/
  src/
    extension.ts        — activate(), register commands
    BugPanel.ts         — WebviewPanel with the bug UI
    api.ts              — fetch wrapper for BugHunt API
  package.json          — extension manifest
  README.md
```

### Commands registered
- `BugHunt: Start Practice` — opens BugPanel with a random bug (language = current file language)
- `BugHunt: Daily Challenge` — opens today's daily challenge in BugPanel
- `BugHunt: My Stats` — shows user Elo, rank, streak in status bar notification

### BugPanel (WebviewPanel)
- Embeds the existing practice UI as a webview (HTML/CSS/JS served from extension resources)
- Calls `GET https://bughunt.vercel.app/api/bugs/random?language={currentLanguage}` with `Authorization: Bearer {apiToken}`
- Shows code (syntax highlighted with VS Code's built-in highlighter via Shiki), 4 answer buttons
- After answering: shows explanation, "Next Bug" button
- No Elo change (practice mode only)

### BugHunt API additions for extension
- `GET /api/user/token` — authenticated, returns/creates a personal API token for extension use
- `POST /api/user/token/revoke` — revoke token
- API token stored in DynamoDB: `PK: USER#<id>, SK: API_TOKEN, Fields: token (hashed), createdAt`
- All existing practice endpoints accept `Authorization: Bearer <token>` in addition to session cookie

### Profile page addition
- "API Token" section in profile settings: show token (masked), copy button, revoke button

### Distribution
- `scripts/build-extension.sh` — runs `vsce package` to build `.vsix`
- Published to Marketplace with `vsce publish` (requires Marketplace account)
- Hackathon demo: install locally with `code --install-extension bughunt-0.1.0.vsix`

---

## 4. Bug Difficulty Community Ratings

### What
After each game or practice session, players rate whether the bug's difficulty felt right. Aggregate ratings surface over/under-rated bugs for rebalancing.

### When shown
- Result page: "Was this bug's difficulty fair?" 👍 / 👎
- Practice page: same question after reveal
- One rating per bug per user (idempotent)

### DynamoDB entity
```
PK: BUG#<id>
SK: RATING#<userId>
Fields: rating(1=too_easy, 2=fair, 3=too_hard), userId, createdAt
expiresAt: none

Aggregate on Bug entity (updated atomically):
  ratingCount: number
  ratingSum: number  (sum of ratings 1-3)
  ratingAvg: computed in query (ratingSum/ratingCount)
```

### Aggregate update
In `POST /api/game/submit` and `POST /api/daily/submit`, after showing result, enable rating widget.
`POST /api/bugs/:id/rate { rating: 1|2|3 }` — writes rating item + atomically updates Bug aggregate with `ADD ratingCount 1, ratingSum :r`.

### Admin page addition
- New "Bug Health" tab in admin page
- Table: bug language, category, difficulty, ratingAvg, ratingCount
- Sorted by `|ratingAvg - 2|` descending (most misrated bugs first)
- "Adjust Difficulty" button → updates bug difficulty field, clears ratings

### API routes
- `POST /api/bugs/:id/rate` — submit rating (auth, idempotent)
- `GET /api/admin/bugs/health` — bug health report (admin only)

---

## Files created/modified

### Tournament
| File | Change |
|---|---|
| `src/app/(game)/tournaments/page.tsx` | New — tournament list |
| `src/app/(game)/tournaments/[id]/page.tsx` | New — bracket view |
| `src/app/api/tournaments/route.ts` | New — GET list, POST create |
| `src/app/api/tournaments/[id]/route.ts` | New — GET details |
| `src/app/api/tournaments/[id]/register/route.ts` | New — POST register |
| `src/app/api/cron/tournament-tick/route.ts` | New — advance rounds |
| `src/lib/tournaments.ts` | New — bracket logic |

### Org/Team
| File | Change |
|---|---|
| `src/app/(social)/org/page.tsx` | New — my orgs |
| `src/app/(social)/org/[id]/page.tsx` | New — org leaderboard |
| `src/app/api/org/route.ts` | New — POST create org |
| `src/app/api/org/join/route.ts` | New — POST join via code |
| `src/app/api/org/[id]/route.ts` | New — GET org details |
| `src/app/api/org/[id]/leaderboard/route.ts` | New — GET org leaderboard |
| `src/components/leaderboard/LeaderboardTabs.tsx` | Add "My Org" tab |
| `lambda/leaderboard-updater/index.ts` | Update — also write org leaderboard |

### VS Code Extension
| File | Change |
|---|---|
| `vscode-extension/src/extension.ts` | New |
| `vscode-extension/src/BugPanel.ts` | New |
| `vscode-extension/src/api.ts` | New |
| `vscode-extension/package.json` | New |
| `src/app/api/user/token/route.ts` | New — API token management |
| `src/app/(social)/profile/page.tsx` | Add API token section |

### Bug Ratings
| File | Change |
|---|---|
| `src/app/api/bugs/[id]/rate/route.ts` | New — POST rating |
| `src/app/api/admin/bugs/health/route.ts` | New — GET health report |
| `src/components/game/GameResult.tsx` | Add difficulty rating widget |
| `src/app/(game)/practice/page.tsx` | Add difficulty rating after reveal |
| `src/app/admin/page.tsx` | Add Bug Health tab |
