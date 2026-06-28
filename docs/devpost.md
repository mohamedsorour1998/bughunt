# Devpost submission — BugHunt

**Tagline:** Chess.com for debugging — race a rival (or Amazon Nova) to find the bug. DynamoDB keeps score for millions.

**Track:** 3 — Million-scale global app (gaming/social/entertainment)

## Inspiration
Every developer has stared at code hunting a bug under time pressure. We made that feeling a competitive sport — because the skill is real, trainable, and weirdly fun head-to-head.

## What it does
Real-time human vs human debugging duels: two players see the same buggy code, race to identify the bug, earn Elo ratings like chess. Three rounds × 120s, fastest accurate answer wins. Redis Elo-bucketed matchmaking pairs you with a skill-matched human opponent; if no one is in range after 10 seconds, a serverless bot (optionally powered by Bedrock Nova) steps in so you're never stuck waiting. Also: daily challenges with streaks; bracketed tournaments; org/team leaderboards; a social layer (follow, feed, direct challenges); community bug submissions quality-screened by Nova; a VS Code extension; shareable result cards.

## How we built it
Next.js 16 App Router on Vercel; one DynamoDB table (on-demand, TTL, 2 GSIs, Global Tables to 3 regions) as the source of truth; DynamoDB Streams → Lambda materializing the leaderboard as RANK# rows (top-100 = one Query); Upstash Redis for Elo-bucketed matchmaking queues, rate limits, and game-event pub/sub with DynamoDB-polling fallback; Bedrock Nova for content QA, generation, and bot play. 180+ tests (unit, API-against-real-DynamoDB, Playwright E2E) and a production artillery load test.

## Challenges
Multiplayer on serverless is a pile of races: double-submits, double-resolution, rematch races, queue claim races. We settled every one with DynamoDB ConditionExpressions (and one optimistic-versioned index with bounded retries) rather than locks — the loser of any race gets a clean no-op. The second challenge was real-time without WebSockets: SSE with layered fallbacks (TCP pub/sub → DynamoDB polling → client polling).

## Accomplishments
A leaderboard that is written, never computed; bots that need no servers; honest million-DAU capacity math published in docs/ARCHITECTURE.md — including the system's three real limits and their designed mitigations.

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
