/**
 * DynamoDB Streams Lambda: async leaderboard materializer.
 *
 * resolveGame finishes by stamping p1EloBefore/p1EloAfter/p2EloBefore/p2EloAfter
 * and p1Seq/p2Seq (the player's NEW gamesPlayed count) onto the game META item
 * (after player profiles are updated). That MODIFY event — and only that one —
 * is processed here: for each human player we delete the RANK# row at their
 * old Elo and write the row at their new Elo under LEADERBOARD#GLOBAL and
 * LEADERBOARD#SEASON#1.
 *
 * Cross-shard reordering guard: DynamoDB Streams only order events per-item,
 * so two games for the same player can arrive out of order. A plain Elo-chain
 * check is insufficient because Elo can cycle (1200→1216→1200). Instead, each
 * (board, user) pair has a per-user cursor row — pk = <board>, sk =
 * CURSOR#<userId>, attrs { userId, elo, seq, updatedAt } — keyed by the
 * player's monotonic gamesPlayed sequence number (a user can't have two
 * concurrent ranked games, so gamesPlayed is a true per-player sequence).
 * Cursor rows are invisible to the read path, which only queries
 * begins_with(sk, "RANK#").
 *
 * Per event: claim the cursor with a conditional update (seq <= :seq, so
 * redelivery of the SAME event can re-claim and repair a partial failure).
 * The claim winner deletes the stale oldElo row (unless it's still the live
 * row — Elo cycles) and writes the newElo row. The claim loser reads the
 * cursor's current elo to find the live row, deletes its own stale oldElo
 * row if it isn't the live row, and writes nothing.
 *
 * Idempotent: re-processing the same event re-claims the cursor, deletes a
 * row that's already gone, and conditionally re-puts an identical row.
 */
import type { DynamoDBStreamEvent, DynamoDBStreamHandler } from "aws-lambda"
import { DynamoDBClient } from "@aws-sdk/client-dynamodb"
import type { AttributeValue } from "@aws-sdk/client-dynamodb"
import {
  DynamoDBDocumentClient,
  GetCommand,
  DeleteCommand,
  PutCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb"
import { unmarshall } from "@aws-sdk/util-dynamodb"

const TABLE_NAME = process.env.DYNAMODB_TABLE_NAME ?? "bughunt-main"
// TODO(season-rollover): SEASON#1 is hardcoded to match getCurrentSeason() in
// src/lib/seasons.ts, which also only knows Season 1 today. When seasons roll
// over, both must derive the active season dynamically or this Lambda will
// keep writing to a stale board.
const LEADERBOARDS = ["LEADERBOARD#GLOBAL", "LEADERBOARD#SEASON#1"]

const client = new DynamoDBClient({})
const ddb = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
})

// ---------------------------------------------------------------------------
// Predicate (exported for unit tests)
// ---------------------------------------------------------------------------

export function shouldProcessImage(img: Record<string, unknown>): boolean {
  if (img.sk !== "META") return false
  if (img.status !== "completed") return false
  if (img.affectsElo === false) return false // private games don't touch boards
  if (typeof img.p1EloAfter !== "number") return false // only the final resolve update
  return true
}

function isBot(userId: string): boolean {
  return userId.startsWith("bot-")
}

function zeroPad(n: number): string {
  return String(n).padStart(6, "0")
}

// ---------------------------------------------------------------------------
// Profile lookup (display fields only — Elo comes from the stream image)
// ---------------------------------------------------------------------------

interface DisplayProfile {
  displayName: string
  avatar: string | null
  gamesPlayed: number
  gamesWon: number
}

async function getDisplayProfile(userId: string): Promise<DisplayProfile | null> {
  const result = await ddb.send(
    new GetCommand({ TableName: TABLE_NAME, Key: { pk: `USER#${userId}`, sk: "PROFILE" } })
  )
  if (!result.Item) return null
  const item = result.Item as Record<string, unknown>
  return {
    displayName: (item.displayName as string) ?? "Unknown",
    avatar: (item.avatar as string | null) ?? null,
    gamesPlayed: (item.gamesPlayed as number) ?? 0,
    gamesWon: (item.gamesWon as number) ?? 0,
  }
}

// ---------------------------------------------------------------------------
// Rank row maintenance
// ---------------------------------------------------------------------------

/**
 * Move (or repair) a player's rank row on `board` from oldElo to newElo,
 * guarded by the per-user CURSOR# row keyed on the player's monotonic
 * gamesPlayed sequence number `seq`.
 *
 * Step 1 — claim: advance the per-user cursor, guarded by the monotonic seq.
 * seq <= :seq (not <) so redelivery of the SAME event re-claims and can repair
 * a partial failure (claimed but crashed before writing the rank row).
 *
 * Step 2 — figure out which Elo the live rank row is at. On a lost claim,
 * read the cursor so we never delete the user's live row.
 *
 * Step 3 — the row at oldElo is stale (this event moved past it, or a newer
 * event already did) unless it IS the live row (Elo cycles: 1200→1216→1200).
 *
 * Step 4 — only the claim winner writes the rank row; stale events stop here.
 */
async function moveRankRow(
  board: string,
  userId: string,
  oldElo: number,
  newElo: number,
  seq: number,
  profile: DisplayProfile
): Promise<void> {
  // Step 1 — claim: advance the per-user cursor, guarded by the monotonic seq.
  let claimed = true
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { pk: board, sk: `CURSOR#${userId}` },
        UpdateExpression: "SET elo = :newElo, seq = :seq, userId = :uid, updatedAt = :now",
        ConditionExpression: "attribute_not_exists(seq) OR seq <= :seq",
        ExpressionAttributeValues: {
          ":newElo": newElo,
          ":seq": seq,
          ":uid": userId,
          ":now": Date.now(),
        },
      })
    )
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "ConditionalCheckFailedException") {
      claimed = false
    } else {
      throw err
    }
  }

  // Step 2 — figure out which Elo the live rank row is at. On a lost claim,
  // read the cursor so we never delete the user's live row.
  let liveElo = newElo
  if (!claimed) {
    const cursor = await ddb.send(
      new GetCommand({ TableName: TABLE_NAME, Key: { pk: board, sk: `CURSOR#${userId}` } })
    )
    liveElo = (cursor.Item?.elo as number) ?? newElo
  }

  // Step 3 — the row at oldElo is stale (this event moved past it, or a newer
  // event already did) unless it IS the live row (Elo cycles: 1200→1216→1200).
  if (oldElo !== newElo && oldElo !== liveElo) {
    try {
      await ddb.send(
        new DeleteCommand({
          TableName: TABLE_NAME,
          Key: { pk: board, sk: `RANK#${zeroPad(oldElo)}#${userId}` },
        })
      )
    } catch (err) {
      // Deletes never throw for missing items — anything caught here is a real
      // failure (throttle, network) that leaves a stale row behind. Make it visible.
      console.error(`[leaderboard] failed to delete stale rank row ${board} elo=${oldElo} user=${userId}:`, err)
    }
  }

  // Step 4 — only the claim winner writes the rank row; stale events stop here.
  if (!claimed) return

  try {
    await ddb.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          pk: board,
          sk: `RANK#${zeroPad(newElo)}#${userId}`,
          userId,
          elo: newElo,
          displayName: profile.displayName,
          avatar: profile.avatar,
          gamesPlayed: profile.gamesPlayed,
          gamesWon: profile.gamesWon,
          updatedAt: Date.now(),
        },
        // Same sk always carries the same Elo, so <= makes re-puts idempotent.
        ConditionExpression: "attribute_not_exists(sk) OR #elo <= :newElo",
        ExpressionAttributeNames: { "#elo": "elo" },
        ExpressionAttributeValues: { ":newElo": newElo },
      })
    )
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "ConditionalCheckFailedException") return
    throw err
  }
}

// ---------------------------------------------------------------------------
// Record processor
// ---------------------------------------------------------------------------

async function processRecord(record: DynamoDBStreamEvent["Records"][0]): Promise<void> {
  if (record.eventName !== "MODIFY") return
  if (!record.dynamodb?.NewImage) return

  const img = unmarshall(
    record.dynamodb.NewImage as Record<string, AttributeValue>
  ) as Record<string, unknown>

  if (!shouldProcessImage(img)) return

  const players: Array<{ userId: string; eloBefore: number; eloAfter: number; seq: number }> = []

  const p1 = img.player1Id as string
  if (p1 && !isBot(p1) && typeof img.p1Seq === "number") {
    players.push({
      userId: p1,
      eloBefore: (img.p1EloBefore as number) ?? (img.p1EloAfter as number),
      eloAfter: img.p1EloAfter as number,
      seq: img.p1Seq,
    })
  }

  const p2 = img.player2Id as string | null
  if (p2 && !isBot(p2) && typeof img.p2EloAfter === "number" && typeof img.p2Seq === "number") {
    players.push({
      userId: p2,
      eloBefore: (img.p2EloBefore as number) ?? (img.p2EloAfter as number),
      eloAfter: img.p2EloAfter as number,
      seq: img.p2Seq,
    })
  }

  for (const player of players) {
    const profile = await getDisplayProfile(player.userId)
    if (!profile) continue
    for (const board of LEADERBOARDS) {
      await moveRankRow(board, player.userId, player.eloBefore, player.eloAfter, player.seq, profile)
    }
  }
}

// ---------------------------------------------------------------------------
// Lambda handler
// ---------------------------------------------------------------------------

export const handler: DynamoDBStreamHandler = async (event) => {
  const results = await Promise.allSettled(event.Records.map((r) => processRecord(r)))
  for (const result of results) {
    if (result.status === "rejected") {
      console.error("Failed to process record:", result.reason)
    }
  }
}
