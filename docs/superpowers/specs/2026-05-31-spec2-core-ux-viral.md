# Spec 2 — Core UX + Viral Growth

**Goal:** Polish the core gameplay loop, add the Daily Challenge (primary viral/retention mechanic), enable community bug submissions, and add a shareable result card.

**Depends on:** Spec 1 (Redis for daily challenge cache, SSE replaces polling on play page).

---

## 1. Rematch Button

### What
After a game ends, players see a "Rematch" button that initiates a new game against the same opponent directly — bypassing the matchmaking queue.

### Flow
1. Player clicks "Rematch" on result page → `POST /api/game/rematch { opponentId }`
2. Server creates a **pending rematch** item in DynamoDB: `PK=REMATCH#<userId>, SK=<opponentId>`, TTL=60s
3. Server returns `{ status: "pending", rematching: true }`
4. Play page polls `GET /api/game/rematch/status?opponentId=X` every 2s
5. When opponent also clicks "Rematch" (or if they opened the same result page): server detects mutual rematch, creates game directly with `createGame(userId, opponentId, newBugId)`, returns gameId
6. If opponent doesn't rematch within 60s: show "Opponent declined" and fall back to regular matchmaking

### DynamoDB entity
```
PK: REMATCH#<userId>
SK: <opponentId>
Fields: expiresAt (60s TTL), createdAt
```

### New API routes
- `POST /api/game/rematch` — create pending rematch
- `GET /api/game/rematch/status?opponentId=` — check if mutual rematch exists

### UI changes
- `src/components/game/GameResult.tsx`: add "Rematch" button alongside "Play Again"
- Button shows "Waiting for opponent..." after first click (60s countdown)
- If opponent rematches: both auto-redirect to `/play?gameId=X`

---

## 2. Mobile-Optimized Code Viewer

### What
The current CodeViewer uses Prism.js with horizontal scroll. On mobile (375px) this is nearly unusable. Redesign for mobile-first with a compact language picker and better touch handling.

### Changes to `src/components/game/CodeViewer.tsx`
- Add font size toggle: `text-xs` (mobile default) / `text-sm` (desktop) / `text-base` (large)
- Horizontal scroll replaced with word-wrap toggle — user can switch between "wrap" and "scroll" modes
- Line numbers hidden on screens < 480px (they consume 3 chars of width)
- Bug line highlight uses full-width red left border (`border-l-4 border-red-500`) instead of background color (easier to spot on small screens)
- Add copy-to-clipboard button on the code block header
- Pinch-to-zoom: `touch-action: auto` on the code container (allows native browser zoom)

### No new files — modify existing component only.

---

## 3. Daily Challenge

### What
One featured bug per day, same for everyone globally. Players compete for the fastest correct answer. Shareable result card with OG image. The primary viral/retention mechanic.

### Scale justification
Daily Challenge is served from Redis with a 24h TTL — one DynamoDB read per day, then Redis cache serves all 1M users.

### DynamoDB entity — Daily Challenge entry
```
PK: DAILY#<YYYY-MM-DD>
SK: META
Fields: bugId, date, totalPlayers, avgTimeMs
```

### DynamoDB entity — Daily Challenge submission
```
PK: DAILY#<YYYY-MM-DD>
SK: SUBMISSION#<userId>
Fields: userId, correct, timeElapsedMs, submittedAt
expiresAt: midnight UTC + 30 days
```

### Daily Challenge leaderboard
```
PK: LEADERBOARD#DAILY#<YYYY-MM-DD>
SK: RANK#<paddedTime>#<userId>
Fields: userId, displayName, timeElapsedMs, correct
```
Sorted by time ascending (fastest first, only correct answers ranked).

### Bug selection
Daily bug selected by cron (Vercel Cron Job, 00:00 UTC):
- `POST /api/cron/daily-challenge` (protected with `CRON_SECRET` header)
- Picks a bug not used in last 30 days, weighted by `timesServed` (less-served bugs preferred)
- Writes `DAILY#<today>` item to DynamoDB
- Sets Redis key `daily_challenge:<YYYY-MM-DD>` with bugId, expires at midnight

### API routes
- `GET /api/daily` — returns today's bug (no correctAnswer), player's submission if exists, leaderboard top 10
- `POST /api/daily/submit` — submit answer, write submission + update daily leaderboard
- `GET /api/daily/[date]` — historical daily challenge results

### Page: `src/app/(game)/daily/page.tsx`
- Shows bug with no timer (self-paced but time is recorded for leaderboard)
- Once submitted: shows result, explanation, leaderboard
- "Challenge Streak" — consecutive daily completions tracked in user profile (new field: `dailyStreak`, `lastDailyDate`)
- "Share Result" button (see §4)

### Navbar addition
- "Daily" link added to NAV_LINKS
- Shows 🔥 badge if user hasn't done today's yet

---

## 4. Shareable Result Card (OG Image)

### What
After completing the daily challenge (or any game), a "Share Result" button generates a link with a beautiful Open Graph preview image. When shared on Twitter/LinkedIn/Discord, the card auto-previews.

### Architecture
Use Vercel OG (`@vercel/og`) to generate dynamic OG images server-side as PNG responses.

### Package
```
npm install @vercel/og
```

### New route: `GET /api/og/daily?date=YYYY-MM-DD&userId=`
```typescript
// src/app/api/og/daily/route.tsx
import { ImageResponse } from "@vercel/og"

export const runtime = "edge"

export async function GET(req: Request) {
  // fetch daily challenge + user submission
  // render OG card as ImageResponse
  return new ImageResponse(
    <div style={{ ... }}>
      <div>🐛 BugHunt Daily Challenge</div>
      <div>{date}</div>
      <div>Solved in {time}s — Rank #{rank} globally</div>
      <div>bughunt.vercel.app</div>
    </div>,
    { width: 1200, height: 630 }
  )
}
```

### Share page: `src/app/share/daily/[date]/page.tsx`
```typescript
// Server component with metadata for OG
export async function generateMetadata({ params }) {
  return {
    openGraph: {
      images: [`/api/og/daily?date=${params.date}&userId=...`]
    }
  }
}
```

### Share button in daily result
```
https://bughunt.vercel.app/share/daily/2026-06-01?userId=abc
```
Copies URL to clipboard. When pasted anywhere with link preview, shows the OG card.

Also add OG for game results: `GET /api/og/game?gameId=` with the same pattern.

---

## 5. User Bug Submissions

### What
Community members can submit bugs for admin review. Bedrock AI runs a quality filter before the admin sees it. Accepted bugs are attributed to the submitter on their profile.

### DynamoDB entity additions
```
Bug entity — add fields:
  submittedBy: string | null   (userId of submitter, null for hand-crafted)
  submitterDisplayName: string | null

User Profile — add fields:
  bugsSubmitted: number  (count of accepted community submissions)
  bugsRejected: number
```

### Flow
1. User fills out form at `src/app/(game)/submit-bug/page.tsx`
2. `POST /api/bugs/submit` — writes bug with `status: "pending_review"`, `submittedBy: userId`
3. Bedrock Nova runs automatic quality check: "Is this a real, non-trivial bug with plausible answer options?" → if score < 0.7, auto-reject with explanation
4. If quality check passes: appears in admin review queue
5. Admin approves: bug goes active, `bugsSubmitted` incremented for submitter, user gets "Community Contributor" achievement
6. Admin rejects: `bugsRejected` incremented, user gets feedback message

### New routes
- `POST /api/bugs/submit` — authenticated, rate-limited (3 submissions/day), calls Bedrock quality check
- `GET /api/bugs/my-submissions` — user's submission history + status

### New page: `src/app/(game)/submit-bug/page.tsx`
- Form: language, category, difficulty, buggyCode, correctCode, bugLine, 4 options, correctAnswer, explanation, hint
- Code preview (CodeViewer) as user types
- Submission confirmation: "Under review — usually within 24 hours"

### Bedrock quality check prompt
```
You are a quality filter for a competitive debugging game. Evaluate this bug submission:
Language: {language}
Category: {category}  
Buggy code: {buggyCode}
Correct answer: option {correctAnswer} — "{options[correctAnswer]}"
Explanation: {explanation}

Rate 0.0–1.0 on:
- Is this a real, non-trivial bug? (not just a typo)
- Are the wrong options plausible distractors? 
- Is the explanation accurate?
- Is the code self-contained (5–20 lines)?

Return JSON: {"score": 0.0-1.0, "feedback": "one sentence"}
```

---

## Files created/modified
| File | Change |
|---|---|
| `src/components/game/GameResult.tsx` | Add Rematch button |
| `src/app/api/game/rematch/route.ts` | New — POST create rematch |
| `src/app/api/game/rematch/status/route.ts` | New — GET check mutual rematch |
| `src/components/game/CodeViewer.tsx` | Mobile optimizations |
| `src/app/(game)/daily/page.tsx` | New — Daily Challenge page |
| `src/app/api/daily/route.ts` | New — GET today's challenge |
| `src/app/api/daily/submit/route.ts` | New — POST submit answer |
| `src/app/api/daily/[date]/route.ts` | New — GET historical |
| `src/app/api/cron/daily-challenge/route.ts` | New — daily bug picker |
| `src/app/api/og/daily/route.tsx` | New — OG image for daily |
| `src/app/api/og/game/route.tsx` | New — OG image for game |
| `src/app/share/daily/[date]/page.tsx` | New — shareable daily page |
| `src/app/(game)/submit-bug/page.tsx` | New — community submission form |
| `src/app/api/bugs/submit/route.ts` | New — POST submit bug |
| `src/app/api/bugs/my-submissions/route.ts` | New — GET user submissions |
| `src/components/layout/Navbar.tsx` | Add Daily link + 🔥 badge |
| `src/lib/users.ts` | Add dailyStreak, bugsSubmitted fields |
