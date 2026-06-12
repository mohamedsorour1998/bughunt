/**
 * DynamoDB Streams Lambda: async leaderboard materializer.
 *
 * resolveGame finishes by stamping p1EloBefore/p1EloAfter/p2EloBefore/p2EloAfter
 * onto the game META item (after player profiles are updated). That MODIFY
 * event — and only that one — is processed here: for each human player we
 * delete the RANK# row at their old Elo and write the row at their new Elo
 * under LEADERBOARD#GLOBAL and LEADERBOARD#SEASON#1.
 *
 * Idempotent: re-processing the same event deletes a row that's already gone
 * and conditionally re-puts an identical row.
 */
import type { DynamoDBStreamEvent, DynamoDBStreamHandler } from "aws-lambda"
import { DynamoDBClient } from "@aws-sdk/client-dynamodb"
import type { AttributeValue } from "@aws-sdk/client-dynamodb"
import {
  DynamoDBDocumentClient,
  GetCommand,
  DeleteCommand,
  PutCommand,
} from "@aws-sdk/lib-dynamodb"
import { unmarshall } from "@aws-sdk/util-dynamodb"

const TABLE_NAME = process.env.DYNAMODB_TABLE_NAME ?? "bughunt-main"
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

async function moveRankRow(
  board: string,
  userId: string,
  oldElo: number,
  newElo: number,
  profile: DisplayProfile
): Promise<void> {
  if (oldElo !== newElo) {
    await ddb
      .send(
        new DeleteCommand({
          TableName: TABLE_NAME,
          Key: { pk: board, sk: `RANK#${zeroPad(oldElo)}#${userId}` },
        })
      )
      .catch(() => {/* already gone — idempotent */})
  }

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

  const players: Array<{ userId: string; eloBefore: number; eloAfter: number }> = []

  const p1 = img.player1Id as string
  if (p1 && !isBot(p1)) {
    players.push({
      userId: p1,
      eloBefore: (img.p1EloBefore as number) ?? (img.p1EloAfter as number),
      eloAfter: img.p1EloAfter as number,
    })
  }

  const p2 = img.player2Id as string | null
  if (p2 && !isBot(p2) && typeof img.p2EloAfter === "number") {
    players.push({
      userId: p2,
      eloBefore: (img.p2EloBefore as number) ?? (img.p2EloAfter as number),
      eloAfter: img.p2EloAfter as number,
    })
  }

  for (const player of players) {
    const profile = await getDisplayProfile(player.userId)
    if (!profile) continue
    for (const board of LEADERBOARDS) {
      await moveRankRow(board, player.userId, player.eloBefore, player.eloAfter, profile)
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
