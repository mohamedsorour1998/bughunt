# Load Test Summary — 2026-06-13

**Target:** `http://localhost:3001` (Next.js dev server, Turbopack) — **not**
`https://bughunt.vercel.app`. Production is not deployed yet: Vercel returns
`DEPLOYMENT_NOT_FOUND` (`x-vercel-error: NOT_FOUND`) for every path on
`bughunt.vercel.app`, including `/`, and this repo isn't linked to a Vercel
project. This run is a stand-in against the local dev server, which loads the
same `.env.local` credentials — so the real `bughunt-main` DynamoDB table and
Upstash Redis instance were exercised, just not Vercel's edge/serverless runtime.

**Phases run (all 5 completed, 5m43s total):** Warm up (10rps/60s) → Sustained
(100rps/120s) → High (500rps/60s) → Peak (1000rps/30s) → Cool down (100rps/60s).

**Results:**
- 78,600 requests attempted; 6,799 completed (8.6%), 71,801 failed (91.4% —
  almost all `ERR_SOCKET_TIMEOUT` at Artillery's 8s client timeout, plus 760
  `ECONNRESET`).
- Warm-up phase (10rps) was healthy: p95 ~150–270ms, 0 failures.
- Once the arrival rate passed ~65rps (mid Sustained-load), the single
  dev-mode Node process saturated. For the rest of the run, completed
  responses clustered at the timeout ceiling: p50 7.4s, p95/p99 ~8.0s, mean 6.3s.
- Of completed responses: 1,948 × 200 (leaderboard/bugs-random), 4,851 × 401
  (matchmake/SSE — expected, unauthenticated requests).

**What this evidence actually shows:** the Turbopack dev server is a
single-process bottleneck, not a measurement of the serverless architecture
described in `docs/ARCHITECTURE.md` — on Vercel each request runs in its own
function instance with no shared event-loop queue. This run cannot stand in
for a real production capacity test. Once `bughunt.vercel.app` is deployed
(`vercel --prod`, requires interactive login this environment can't complete),
re-run:
```
TARGET_URL=https://bughunt.vercel.app npx artillery run --environment production scripts/load-test.yml
```

**Manual follow-up (not obtainable from this CLI):** Vercel function
invocation/duration metrics and DynamoDB consumed-capacity graphs for
`bughunt-main` during this run — screenshot from the Vercel and AWS consoles
and add to `docs/loadtest/`.
