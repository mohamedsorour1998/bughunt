// redis-helpers.test.ts — unit tests for queue logic
// Uses a hand-rolled mock; no real Redis connection required.

import { strict as assert } from "assert"

interface MockRedis {
  data: Map<string, Map<string, number>>
  strings: Map<string, string>
  zadd(key: string, score: number | { score: number; member: string }, member?: string): Promise<number>
  zrangebyscore(key: string, min: number | string, max: number | string, opts?: { limit?: [number, number] }): Promise<string[]>
  zrange(key: string, start: number, stop: number): Promise<string[]>
  zrem(key: string, member: string): Promise<number>
  expire(key: string, seconds: number): Promise<number>
  get(key: string): Promise<string | null>
  set(key: string, value: string, opts?: { ex?: number }): Promise<string>
  incr(key: string): Promise<number>
  publish(channel: string, message: string): Promise<number>
  _reset(): void
}

function createMockRedis(): MockRedis {
  const data = new Map<string, Map<string, number>>()
  const strings = new Map<string, string>()
  return {
    data, strings,
    async zadd(key, scoreOrObj, memberArg) {
      let score: number; let member: string
      if (typeof scoreOrObj === "object") { score = scoreOrObj.score; member = scoreOrObj.member }
      else { score = scoreOrObj; member = memberArg! }
      if (!data.has(key)) data.set(key, new Map())
      data.get(key)!.set(member, score)
      return 1
    },
    async zrangebyscore(key, min, max, opts) {
      const set = data.get(key); if (!set) return []
      const minN = min === "-inf" ? -Infinity : Number(min)
      const maxN = max === "+inf" ? Infinity : Number(max)
      const entries = [...set.entries()].filter(([, s]) => s >= minN && s <= maxN).sort(([, a], [, b]) => a - b).map(([m]) => m)
      if (opts?.limit) { const [offset, count] = opts.limit; return entries.slice(offset, offset + count) }
      return entries
    },
    async zrange(key, start, stop) {
      const set = data.get(key); if (!set) return []
      const entries = [...set.entries()].sort(([, a], [, b]) => a - b).map(([m]) => m)
      return stop === -1 ? entries.slice(start) : entries.slice(start, stop + 1)
    },
    async zrem(key, member) { return data.get(key)?.delete(member) ? 1 : 0 },
    async expire() { return 1 },
    async get(key) { return strings.get(key) ?? null },
    async set(key, value) { strings.set(key, value); return "OK" },
    async incr(key) { const v = parseInt(strings.get(key) ?? "0", 10) + 1; strings.set(key, String(v)); return v },
    async publish() { return 0 },
    _reset() { data.clear(); strings.clear() },
  }
}

type RedisLike = MockRedis

function eloRangeBucket(elo: number): number { return Math.floor(elo / 200) * 200 }

async function enqueuePlayer(redis: RedisLike, userId: string, elo: number): Promise<void> {
  const range = eloRangeBucket(elo)
  const score = Math.floor(Date.now() / 1000)
  await redis.zadd(`queue:${range}`, { score, member: userId })
  await redis.expire(`queue:${range}`, 300)
}

async function findMatch(redis: RedisLike, userId: string, elo: number): Promise<string | null> {
  const range = eloRangeBucket(elo)
  const ranges = [...new Set([Math.max(0, range - 200), range, range + 200])]
  for (const r of ranges) {
    const members = await redis.zrange(`queue:${r}`, 0, 9)
    for (const m of members) { if (m !== userId) return m }
  }
  return null
}

async function dequeuePlayer(redis: RedisLike, userId: string, elo: number): Promise<void> {
  await redis.zrem(`queue:${eloRangeBucket(elo)}`, userId)
}

async function rateLimitCheck(redis: RedisLike, userId: string, action: string, maxRequests: number, windowSeconds: number): Promise<boolean> {
  const windowStart = Math.floor(Date.now() / 1000 / windowSeconds)
  const key = `ratelimit:${userId}:${action}:${windowStart}`
  const count = await redis.incr(key)
  if (count === 1) await redis.expire(key, windowSeconds * 2)
  return count <= maxRequests
}

function test(name: string, fn: () => Promise<void>) {
  return fn().then(() => console.log("✓", name), (e) => { console.error("✗", name, e); process.exit(1) })
}

const redis = createMockRedis()

async function runAll() {
  await test("enqueuePlayer adds to sorted set", async () => {
    redis._reset()
    await enqueuePlayer(redis, "user-a", 1200)
    const members = await redis.zrange("queue:1200", 0, -1)
    assert.deepEqual(members, ["user-a"])
  })
  await test("findMatch returns first non-self member", async () => {
    redis._reset()
    await enqueuePlayer(redis, "user-a", 1200)
    await enqueuePlayer(redis, "user-b", 1200)
    assert.equal(await findMatch(redis, "user-a", 1200), "user-b")
  })
  await test("findMatch returns null when only self in queue", async () => {
    redis._reset()
    await enqueuePlayer(redis, "user-a", 1200)
    assert.equal(await findMatch(redis, "user-a", 1200), null)
  })
  await test("findMatch searches adjacent elo buckets", async () => {
    redis._reset()
    await enqueuePlayer(redis, "user-b", 1000)
    assert.equal(await findMatch(redis, "user-a", 1200), "user-b")
  })
  await test("dequeuePlayer removes from sorted set", async () => {
    redis._reset()
    await enqueuePlayer(redis, "user-a", 1200)
    await dequeuePlayer(redis, "user-a", 1200)
    assert.equal(await findMatch(redis, "user-b", 1200), null)
  })
  await test("rateLimitCheck allows up to maxRequests", async () => {
    redis._reset()
    const results = await Promise.all([rateLimitCheck(redis, "u1", "matchmake", 3, 60), rateLimitCheck(redis, "u1", "matchmake", 3, 60), rateLimitCheck(redis, "u1", "matchmake", 3, 60)])
    assert.deepEqual(results, [true, true, true])
  })
  await test("rateLimitCheck blocks when over limit", async () => {
    redis._reset()
    await rateLimitCheck(redis, "u1", "matchmake", 2, 60)
    await rateLimitCheck(redis, "u1", "matchmake", 2, 60)
    assert.equal(await rateLimitCheck(redis, "u1", "matchmake", 2, 60), false)
  })
  console.log("\nAll redis-helpers tests passed!")
}
runAll()
