# Devpost submission — BugHunt

**Project name:** BugHunt

**Elevator pitch (≤200 chars):** Real-time 1v1 debugging duels: spot the bug before your opponent, earn Elo ratings, climb the global leaderboard. Built for 1M daily players on a single DynamoDB table — no servers, no limits.

**Tagline (longer):** Chess.com for debugging at million-user scale — one DynamoDB table, 290 resolves/second, zero servers to manage.

**Track:** 3 — Million-scale global app (gaming/social/entertainment)

## About the project (Devpost "Project Story" field — paste as Markdown)

## Inspiration
Every developer debugs. It's the skill you use more than any algorithm — reading unfamiliar code, spotting what's wrong, fixing it under pressure. Yet there's no competitive platform for it. LeetCode tests algorithms. HackerRank tests data structures. Nothing tests the skill you actually use at 2am in production. We made that feeling a competitive sport.

## What it does
Real-time human vs human debugging duels: two players are matched by Elo rating through a Redis sorted-set queue, see the same buggy code snippet, and race to identify the bug in three 120-second rounds — fastest accurate answer wins. Every write is protected by a DynamoDB ConditionExpression so double-submits, double-resolves, and simultaneous joins are clean no-ops at any traffic level.

Beyond the core duel: chess-style Elo ratings and rank tiers; a DynamoDB Streams → Lambda leaderboard that is *written not computed* (constant-time reads at any user count); daily challenges with streaks; bracketed tournaments; org/team leaderboards; a social layer (follow, feed, direct challenges); community bug submissions quality-screened by Bedrock Nova; a VS Code extension; shareable result cards. When no human is available after 10 seconds, a serverless bot fills the slot.

## How we built it
Next.js 16 App Router on Vercel — stateless serverless functions, no servers to provision or patch. One DynamoDB table (`bughunt-main`, on-demand, Global Tables → 3 regions) holds every entity: users, games, answers, bugs, tournaments, orgs, social graph, notifications, chat. At 1M DAU × 5 games/day that's ~290 resolves/second at peak (~3,500 WCU/s) — absorbed by on-demand capacity with uniform UUID partition distribution.

DynamoDB Streams → Lambda materializes the leaderboard: game resolution stamps Elo audit fields onto the game item, the Lambda moves `RANK#<paddedElo>#<userId>` rows, and top-100 reads are a single descending Query with `Limit: 100`. Constant time regardless of user count.

Upstash Redis handles ephemeral coordination: Elo-bucketed matchmaking sorted sets, rate-limit counters, game-event pub/sub with DynamoDB-polling fallback. Bedrock Nova Lite quality-screens community bug submissions and optionally plays as bot opponent. 180+ tests (unit, API against real DynamoDB, Playwright E2E).

## Challenges
Multiplayer on serverless is a pile of race conditions: double-submits, double-resolution, rematch races, queue claim races, tournament slot conflicts. We settled every one with DynamoDB ConditionExpressions — the loser of any race gets a clean no-op, never corruption. No locks, no transactions.

Real-time without WebSockets: Vercel serverless functions can't hold persistent connections. Solution: SSE with layered fallbacks — TCP Redis pub/sub (instant push) → 10s DynamoDB safety poll → client polling every 3s. The game works even if Redis is completely down.

## Accomplishments
- ~290 resolves/second peak capacity on a single DynamoDB table with zero provisioned capacity
- Leaderboard written, never computed — constant-time reads at any user count
- Every race condition resolved with ConditionExpressions, not locks
- Honest capacity math published in the repo: four known limits with concrete mitigation paths

## What we learned
Single-table design is a forcing function: you must know every access pattern before writing a line of code. That sounds painful, but it means your data model serves your app perfectly — no ORM surprises, no N+1 queries, no migration headaches. On-demand DynamoDB makes 95% of scale free; the engineering is in the other 5%: hot partitions, item-size ceilings, held-open serverless functions.

## What's next
Top-N write gating on the leaderboard Lambda, per-difficulty index sharding, multi-region writes once functions go multi-region, mobile PWA, language-specific ladders.

---

## Built with (tag each one separately in the Devpost field)

Next.js, TypeScript, React, Tailwind CSS, Vercel, Amazon DynamoDB, DynamoDB Streams, AWS Lambda, Amazon Bedrock Nova, Upstash Redis, Upstash QStash, NextAuth.js, Playwright, Node.js

---

## "Try it out" links

- https://bughunt-beryl.vercel.app
- https://github.com/mohamedsorour1998/bughunt

---

## Video demo link

[YouTube link — record from docs/demo-video-script.md, upload as public, paste URL here]

---

## Additional info (judges only)

**Submitter Type:** Individual

**Country of Residence:** [your country]

**App Status:** Existing — significantly modified during the Submission Period

**If Existing, what was updated:**
BugHunt's core gameplay existed before the hackathon, but the following were built or substantially reworked during the submission period: the full bot opponent system (serverless lazy evaluation via Bedrock Nova), DynamoDB Streams → Lambda leaderboard materializer, real-time SSE with Redis pub/sub and DynamoDB-polling fallback, tournament and org subsystems, social layer (follow/feed/challenges), VS Code extension, community bug submission pipeline with Bedrock quality gate, production load testing and the full million-DAU capacity analysis. The matchmaking system was also rearchitected to be resilient to Redis failures with graceful degradation.

**Testing Instructions for Judges:**
1. Visit https://bughunt-beryl.vercel.app
2. Sign in with Google or GitHub (free, no data stored beyond your name/avatar)
3. Click **Play** → **Find Match** — you will be matched with a human opponent or a bot within ~10 seconds
4. Complete a 3-round game; result page shows Elo change and per-round explanation
5. Visit **Daily** for today's solo challenge, **Leaderboard** for the global ranking, **Practice** for unlimited solo mode
6. To test without signing in: use the **Practice** mode (no auth required)

**Which Track:** Track 3 — Million-scale global app (gaming / social / entertainment)

**Published Vercel/v0 Link:** https://bughunt-beryl.vercel.app

**Vercel Team ID:** [go to vercel.com → select your team → Settings → General → scroll to "Team ID" → copy `team_xxxxx`]

**Which database:** Amazon DynamoDB

**Architecture diagram:** export `docs/architecture-diagram.html` → open in Chrome → Ctrl+P → Save as PDF → upload here (or screenshot as PNG)

**AWS database screenshot:** open https://console.aws.amazon.com/dynamodb → Tables → bughunt-main → screenshot showing table name, item count, and on-demand billing mode → upload here

**Bonus Points URL:** [paste your dev.to or Medium article URL once published — article already contains "created for the purposes of entering the H0 Hackathon" and #H0Hackathon]
