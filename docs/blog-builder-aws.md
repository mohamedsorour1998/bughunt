# Chess.com for debugging: how BugHunt runs a real-time game on DynamoDB with zero servers

*Built for the H0 Hackathon (Vercel + AWS Databases), Track 3: million-scale global apps.*

BugHunt is a competitive debugging game: two players get the same three buggy
snippets, 120 seconds each; most correct answers wins, total time breaks ties,
Elo on the line. The interesting part isn't the game — it's that a real-time
multiplayer game runs entirely on serverless primitives: Next.js on Vercel,
one DynamoDB table, a Streams Lambda, and Upstash Redis for coordination.

## One table, every entity

Everything lives in `bughunt-main`: users, games, per-player answers, bugs,
daily challenges, tournaments, orgs, follows, notifications, chat. Two GSIs
cover the non-key access patterns (active-game-by-user, user-by-email). Every
hot-path read is a key lookup or single-partition Query; nothing aggregates at
read time. [Include the key-pattern table from the repo README.]

## Concurrency without transactions: ConditionExpressions everywhere

A multiplayer game is a pile of races: both players submitting in the same
millisecond, resolve being triggered twice, a rematch accepted at both ends.
Every one of those is settled by a conditional write — `status = :active` to
claim resolution exactly once, `attribute_not_exists(answers[2].submittedAt)`
to make double-submits a no-op, optimistic `version` checks (with an
`attribute_not_exists(version)` clause for legacy items!) on the shared bug
index. The loser of a race gets a clean 409, never a corrupted game.

## The leaderboard is a materialized view, courtesy of Streams

Naive leaderboards scan-and-sort; ours is written, never computed. When a game
resolves we stamp `p1EloBefore/After`, `p2EloBefore/After` onto the game item
*after* profiles update; a Streams-triggered Lambda moves each player's
`RANK#<zero-padded-elo>#<userId>` row. Top-100 is one descending Query. The
zero-padding trick turns DynamoDB's lexicographic sort into a numeric ranking.

## Bots with no servers

Hackathon demos die on empty matchmaking queues. Our bots have no process:
when a human's request touches a game (status poll, submit, SSE tick), it
checks whether the bot's deterministic think-delay — seeded from
sha256(gameId:round) — has elapsed and, if so, writes the bot's answer through
the same conditional path humans use. Any number of concurrent requests agree
on what the bot does; the conditional write dedupes the rest. Optionally,
Amazon Nova Lite literally picks the bot's answers.

## The honest scale math

[Summarize the 1M-DAU table and the three limits + mitigations from
docs/ARCHITECTURE.md — leaderboard partition write gating, BUG#INDEX item-size
sharding path, SSE push upgrade via TCP pub/sub.]

The thing I'd tell other builders: on-demand DynamoDB makes the *easy* 95% of
scale free, and single-table design forces you to know your access patterns
before you write a line. The remaining 5% — hot partitions, item-size
ceilings, held-open connections — is where the real architecture lives. Do
that math in the open; your future self (and apparently hackathon judges) will
thank you.

*Try it: [live URL] · Source: [GitHub URL]*
