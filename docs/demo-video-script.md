# BugHunt — Demo Video Script (< 3 minutes)

**Required by H0 rules:**
1. What problem your app solves, for whom, and why you chose this problem
2. Footage of the working application
3. Explain the AWS Database used (DynamoDB)

**Pre-stage:**
- Logged into https://bughunt-beryl.vercel.app
- Set Vercel env: `BOT_MATCH_AFTER_MS=5000`, `BOT_THINK_MIN_MS=3000`, `BOT_THINK_SPAN_MS=4000`
- Have DynamoDB console open (table view showing items)
- Record at 1080p, dark theme

---

## Script

### Opening — The Problem (0:00–0:20)

**[Show: Landing page hero]**

> "Debugging is the most important skill developers use every day — but there's no good way to practice it competitively. LeetCode tests algorithms. BugHunt tests the skill you actually use at work: reading someone else's code and finding what's wrong."

> "BugHunt is a real-time competitive debugging game. Two players see the same buggy code, race to identify the bug, and earn Elo ratings — like chess, but for code review."

### Live Demo — Playing a Game (0:20–1:20)

**[Show: Click "Find Match" on play page]**

> "Let's play. I click Find Match — behind the scenes, my Elo rating is pushed into a Redis matchmaking queue bucketed by skill level. No humans right now, so after five seconds BugHunt summons a bot opponent near my rating."

**[Show: Bot match starts, DuelHeader appears with opponent info]**

> "The bot isn't a separate server — it's pure lazy evaluation. My own polling requests check whether the bot's deterministic think delay has elapsed and write its answer if so. Zero infrastructure."

**[Show: Read bug, select answer, submit. Show "Correct!" or "Not quite" flash. Show opponent submitted indicator.]**

> "Three rounds, 120 seconds each. Every answer submission is a DynamoDB conditional write — if two requests hit simultaneously, the second is a clean no-op, never a corrupted game."

**[Show: Rounds 2 and 3, fast cuts. Then result page with Elo change, per-round breakdown, explanations.]**

> "Win or lose, you learn — every round shows the explanation and the fixed code. My Elo updates, and the leaderboard reflects it immediately."

### DynamoDB Deep Dive (1:20–2:10)

**[Show: DynamoDB console — table items view with sample items visible]**

> "Everything runs on one DynamoDB table: users, games, answers, bugs, leaderboards, tournaments, social graph — all in a single-table design."

> "Why DynamoDB? Every hot-path read is a key lookup or single-partition query. Loading my profile: one read. My active game: one GSI query. The top-100 leaderboard: one descending query. No joins, no aggregations at read time."

**[Show: Architecture diagram (screenshot or HTML page)]**

> "Game resolution stamps Elo fields onto the game item. DynamoDB Streams triggers a Lambda that moves materialized RANK rows — the leaderboard is *written*, never computed. At a million daily active users, that's 290 resolves per second at peak. On-demand capacity handles it without provisioning."

> "All concurrent operations — double submits, simultaneous game resolution, tournament joins — are protected by ConditionExpressions. The loser of any race gets a clean no-op, never corruption."

### Features Montage (2:10–2:40)

**[Quick cuts, 3–4 seconds each:]**

**[Show: Leaderboard page]**
> "Global and seasonal leaderboards."

**[Show: Daily challenge page]**
> "Daily challenges with streaks."

**[Show: Submit bug page]**
> "Community-submitted bugs, quality-screened by Amazon Bedrock Nova."

**[Show: Practice mode]**
> "Solo practice mode to sharpen your skills."

### Closing (2:40–2:55)

**[Show: Landing page with live URL]**

> "BugHunt — Next.js 16 on Vercel, DynamoDB underneath, built to scale to everyone who's ever shipped a bug. Which is all of us."

> "Try it now at bughunt-beryl.vercel.app."

**[End card: BugHunt logo, live URL, GitHub URL, "Vercel + AWS DynamoDB — H0 Hackathon"]**

---

## Timing breakdown

| Section | Duration | Cumulative |
|---------|----------|------------|
| Opening — problem & audience | 20s | 0:20 |
| Live demo — playing a game | 60s | 1:20 |
| DynamoDB deep dive | 50s | 2:10 |
| Features montage | 30s | 2:40 |
| Closing | 15s | 2:55 |

**Total: ~2:55** (under the 3:00 limit)

## Recording tips
- Use OBS or Loom, 1080p, capture browser tab audio off
- Keep mouse movements deliberate, no frantic clicking
- Cut dead time in editing (matchmaking wait, page loads)
- Consider a subtle background music track (royalty-free, low volume)
