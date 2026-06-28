# Devpost submission — BugHunt

**Project name:** BugHunt

**Elevator pitch (≤60 chars):** Chess.com for debugging — race rivals, earn Elo ratings.

**Tagline (longer):** Chess.com for debugging at million-user scale — one DynamoDB table, 290 resolves/second, zero servers to manage.

**Track:** 3 — Million-scale global app (gaming/social/entertainment)

## Inspiration
Every developer has stared at code hunting a bug under time pressure. We made that feeling a competitive sport — because the skill is real, trainable, and weirdly fun head-to-head.

## What it does
BugHunt is a real-time 1v1 competitive debugging game designed to scale to millions of concurrent players on a single DynamoDB table with no dedicated servers. Two players are matched by Elo rating through a Redis sorted-set queue, see the same buggy code snippet, and race to identify the bug in three 120-second rounds — fastest accurate answer wins. Every write is protected by a DynamoDB ConditionExpression so double-submits, double-resolves, and simultaneous joins are all clean no-ops at any traffic level.

Beyond the core duel: chess-style Elo ratings and rank tiers; a DynamoDB Streams → Lambda leaderboard that is written not computed (constant-time reads at any user count); daily challenges with streaks; bracketed tournaments; org/team leaderboards; a social layer (follow, feed, direct challenges); community bug submissions quality-screened by Bedrock Nova; a VS Code extension; shareable result cards. When no human opponent is available after 10 seconds, a serverless bot (no process — driven by the human's own requests) fills the slot.

## How we built it
Next.js 16 App Router on Vercel; one DynamoDB table (on-demand, TTL, 2 GSIs, Global Tables to 3 regions) as the source of truth; DynamoDB Streams → Lambda materializing the leaderboard as RANK# rows (top-100 = one Query); Upstash Redis for Elo-bucketed matchmaking queues, rate limits, and game-event pub/sub with DynamoDB-polling fallback; Bedrock Nova for content QA, generation, and bot play. 180+ tests (unit, API-against-real-DynamoDB, Playwright E2E) and a production artillery load test.

## Challenges
Multiplayer on serverless is a pile of races: double-submits, double-resolution, rematch races, queue claim races. We settled every one with DynamoDB ConditionExpressions (and one optimistic-versioned index with bounded retries) rather than locks — the loser of any race gets a clean no-op. The second challenge was real-time without WebSockets: SSE with layered fallbacks (TCP pub/sub → DynamoDB polling → client polling).

## Accomplishments
Designed and load-tested for 1M DAU: 58 games/s average, ~290/s peak, ~3,500 WCU/s across DynamoDB — absorbed by on-demand capacity with uniform UUID partition distribution. A leaderboard that is written, never computed (constant-time reads regardless of user count). Every race condition in a multiplayer game solved with ConditionExpressions rather than locks. Honest capacity math — including four known limits and concrete mitigations — published in the repo.

## What we learned
Single-table design is a forcing function: you must know every access pattern up front. On-demand mode makes 95% of scale free; the engineering is in the other 5% (hot partitions, item ceilings, held-open functions).

## What's next
Top-N write gating on the leaderboard Lambda, per-difficulty index sharding, multi-region writes once functions go multi-region, mobile PWA, language-specific ladders.

**Links:**
- Live app: https://bughunt-beryl.vercel.app
- GitHub: https://github.com/mohamedsorour1998/bughunt
- Demo video: [YouTube link — upload from docs/demo-video-script.md]
- Architecture diagram: docs/architecture-diagram.html (screenshot for Devpost)
- Blog post: docs/hackathon-article.md (publish on dev.to or Medium with #H0Hackathon)
