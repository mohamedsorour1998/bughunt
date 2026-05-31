/**
 * DynamoDB Streams Lambda: async leaderboard updater.
 * Triggered by MODIFY events on bughunt-main. Filters for game META items
 * that transition to status=completed and updates LEADERBOARD#GLOBAL and
 * LEADERBOARD#SEASON#1 entries idempotently.
 */
import { DynamoDBStreamEvent, DynamoDBStreamHandler } from "aws-lambda"
import { DynamoDBClient } from "@aws-sdk/client-dynamodb"
import {
  DynamoDBDocumentClient,
  GetCommand,
  DeleteCommand,
  PutCommand,
} from "@aws-sdk/lib-dynamodb"
import { unmarshall } from "@aws-sdk/util-dynamodb"
import { AttributeValue } from "@aws-sdk/client-dynamodb"

const TABLE_NAME = process.env.DYNAMODB_TABLE_NAME ?? "bughunt-main"

const client = new DynamoDBClient({})
const ddb = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function zeroPad(n: number): string {
  return String(n).padStart(6, "0")
}

interface UserProfile {
  userId: string
  displayName: string
  avatar: string | null
  elo: number
  gamesPlayed: number
  gamesWon: number
}

async function getUserProfile(userId: string): Promise<UserProfile | null> {
  const result = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { pk: `USER#${userId}`, sk: "PROFILE" },
    })
  )
  if (!result.Item) return null
  const item = result.Item as Record<string, unknown>
  return {
    userId: item.userId as string,
    displayName: item.displayName as string,
    avatar: (item.avatar as string | null) ?? null,
    elo: item.elo as number,
    gamesPlayed: item.gamesPlayed as number,
    gamesWon: item.gamesWon as number,
  }
}

async function updateLeaderboardEntry(
  pk: string,
  userId: string,
  oldElo: number,
  newElo: number,
  displayName: string,
  avatar: string | null,
  gamesPlayed: number,
  gamesWon: number
): Promise<void> {
  // Delete old rank entry
  const oldKey = zeroPad(oldElo) + "#" + userId
  await ddb
    .send(
      new DeleteCommand({
        TableName: TABLE_NAME,
        Key: { pk, sk: `RANK#${oldKey}` },
      })
    )
    .catch(() => {/* ignore if not found */})

  // Write new rank entry — idempotent: same userId+elo always produces the same sk
  const newKey = zeroPad(newElo) + "#" + userId
  try {
    await ddb.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          pk,
          sk: `RANK#${newKey}`,
          userId,
          elo: newElo,
          displayName,
          avatar,
          gamesPlayed,
          gamesWon,
          updatedAt: Date.now(),
        },
        // Idempotent: only write if this exact entry doesn't exist yet
        ConditionExpression: "attribute_not_exists(sk) OR #elo <= :newElo",
        ExpressionAttributeNames: { "#elo": "elo" },
        ExpressionAttributeValues: { ":newElo": newElo },
      })
    )
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      err.name === "ConditionalCheckFailedException"
    ) {
      // Already up-to-date — idempotent, skip
      return
    }
    throw err
  }
}

// ---------------------------------------------------------------------------
// Record processor
// ---------------------------------------------------------------------------

interface GameRecord {
  gameId: string
  player1Id: string
  player2Id: string | null
  status: string
  winnerId: string | null
}

async function processRecord(record: DynamoDBStreamEvent["Records"][0]): Promise<void> {
  // Only process MODIFY events
  if (record.eventName !== "MODIFY") return
  if (!record.dynamodb?.NewImage) return

  const newImage = unmarshall(
    record.dynamodb.NewImage as Record<string, AttributeValue>
  ) as Record<string, unknown>

  // Filter: must be META item with status=completed
  if (newImage.sk !== "META") return
  if (newImage.status !== "completed") return

  const game = newImage as unknown as GameRecord

  // Fetch player profiles
  const [p1Profile, p2Profile] = await Promise.all([
    getUserProfile(game.player1Id),
    game.player2Id ? getUserProfile(game.player2Id) : Promise.resolve(null),
  ])

  if (!p1Profile) return

  const leaderboards = ["LEADERBOARD#GLOBAL", "LEADERBOARD#SEASON#1"]

  // Read elo-before from OldImage if available
  const oldImage = record.dynamodb.OldImage
    ? (unmarshall(record.dynamodb.OldImage as Record<string, AttributeValue>) as Record<string, unknown>)
    : null

  // For p1: use current profile elo as both old and new (Lambda sees final state)
  // The profile has already been updated by resolveGame
  const p1OldElo = (oldImage?.p1EloBefore as number | undefined) ?? p1Profile.elo
  const p2OldElo = (oldImage?.p2EloBefore as number | undefined) ?? p2Profile?.elo ?? 1200

  for (const lb of leaderboards) {
    await updateLeaderboardEntry(
      lb,
      game.player1Id,
      p1OldElo,
      p1Profile.elo,
      p1Profile.displayName,
      p1Profile.avatar,
      p1Profile.gamesPlayed,
      p1Profile.gamesWon
    )

    if (p2Profile) {
      await updateLeaderboardEntry(
        lb,
        game.player2Id!,
        p2OldElo,
        p2Profile.elo,
        p2Profile.displayName,
        p2Profile.avatar,
        p2Profile.gamesPlayed,
        p2Profile.gamesWon
      )
    }
  }
}

// ---------------------------------------------------------------------------
// Lambda handler
// ---------------------------------------------------------------------------

export const handler: DynamoDBStreamHandler = async (event) => {
  const results = await Promise.allSettled(
    event.Records.map((record) => processRecord(record))
  )

  // Log failures but don't rethrow — we don't want to poison the stream
  for (const result of results) {
    if (result.status === "rejected") {
      console.error("Failed to process record:", result.reason)
    }
  }
}
