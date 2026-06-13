import { test, after } from "node:test"
import assert from "node:assert/strict"
import { GET as getLeaderboard } from "../../src/app/api/leaderboard/route"
import { getLeaderboardPlayers } from "../../src/lib/leaderboard"

after(() => { setImmediate(() => process.exit(0)) })

test("GET /api/leaderboard returns 200 with players array", async () => {
  const req = new Request("http://localhost/api/leaderboard")
  const res = await getLeaderboard(req)
  assert.equal(res.status, 200)
  const body = await res.json() as { players: unknown[] }
  assert.ok(Array.isArray(body.players), "players should be an array")
})

test("GET /api/leaderboard players are sorted by elo descending", async () => {
  const players = await getLeaderboardPlayers()
  for (let i = 1; i < players.length; i++) {
    const a = players[i - 1] as { elo: number }
    const b = players[i] as { elo: number }
    assert.ok(a.elo >= b.elo, `player ${i} elo ${a.elo} >= player ${i+1} elo ${b.elo}`)
  }
})

test("GET /api/leaderboard players have sequential rank numbers", async () => {
  const players = await getLeaderboardPlayers()
  if (players.length > 1) {
    const first = players[0] as { rank: number }
    const second = players[1] as { rank: number }
    assert.equal(first.rank, 1)
    assert.equal(second.rank, 2)
  }
})

test("GET /api/leaderboard?season=current returns 200", async () => {
  const req = new Request("http://localhost/api/leaderboard?season=current")
  const res = await getLeaderboard(req)
  assert.equal(res.status, 200)
  const body = await res.json() as { players: unknown[] }
  assert.ok(Array.isArray(body.players))
})
