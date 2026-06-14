# BugHunt — 3:00 demo script

Record at 1080p, dark theme, no dead air. Pre-stage: logged-in browser, second
incognito window, DynamoDB console (Streams + Global tables tabs), VS Code
with the extension installed, terminal with `aws dynamodb query` ready.

| Time | Shot | Script |
|---|---|---|
| 0:00–0:12 | Landing page hero | "Every developer debugs. BugHunt makes it a sport. Two players, the same buggy code, 120 seconds — fastest accurate eye wins." |
| 0:12–0:25 | Scroll to teaser, answer it live | "You don't even need an account to feel it — spot the bug, get the explanation. Now let's play for real." |
| 0:25–0:50 | Click Find Match → 10s → bot match → DuelHeader | "Matchmaking runs on Elo-bucketed Redis queues. No humans near my rating right now — so after ten seconds, BugHunt summons a Nova bot at my level. No bot servers exist: my own requests power its turns." |
| 0:50–1:25 | Play rounds 1–2, show pips + 'Opponent submitted!' + verdict flash | "Three rounds. Every submit is a DynamoDB conditional write — double-submits are physically impossible. The duel header streams my opponent's progress live." |
| 1:25–1:45 | Round 3 → result page, rank-up chip, Elo, explanations | "Win, Elo, per-round breakdown with explanations — every bug teaches you something. Rematch and post-game chat are one click." |
| 1:45–2:05 | Landing page leaderboard refresh + DynamoDB console Streams tab | "Here's the part database people will like: the leaderboard never aggregates at read time. Game resolution stamps Elo audit fields, DynamoDB Streams trigger a Lambda, and it moves my RANK row — materialized, idempotent, top-100 is one Query." |
| 2:05–2:25 | Global tables tab + ARCHITECTURE.md capacity table | "Single table, on-demand, replicated to three regions. The architecture doc does the math at a million DAU — including the honest limits and their mitigation paths." |
| 2:25–2:45 | Quick cuts: daily challenge, tournament bracket, org leaderboard, social feed, community submit w/ Nova QA | "Beyond 1v1: daily challenges, brackets, org leaderboards, a social layer, and community-submitted bugs that Bedrock Nova quality-screens before review." |
| 2:45–3:00 | VS Code extension practicing a bug → end card | "It even lives in your editor. BugHunt — Next.js on Vercel, DynamoDB underneath, built to scale to everyone who's ever shipped a bug. Which is all of us." |

End card: BugHunt logo · live URL · GitHub URL · "Vercel + AWS Databases — H0 Hackathon".
