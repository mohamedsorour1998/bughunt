/**
 * One-shot ops script: wipe all RANK# rows under LEADERBOARD#GLOBAL and
 * LEADERBOARD#SEASON#1, then rebuild them from current USER#…/PROFILE items.
 * Run after deploying the fixed Streams Lambda, or whenever the boards drift.
 *
 *   npx tsx scripts/rebuild-leaderboard.ts
 */
import { DynamoDBClient } from "@aws-sdk/client-dynamodb"
import {
  DynamoDBDocumentClient, ScanCommand, QueryCommand, DeleteCommand, PutCommand,
} from "@aws-sdk/lib-dynamodb"

const TABLE = process.env.DYNAMODB_TABLE_NAME ?? "bughunt-main"
const ddb = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: process.env.AWS_REGION ?? "us-east-1" }),
  { marshallOptions: { removeUndefinedValues: true } }
)
const BOARDS = ["LEADERBOARD#GLOBAL", "LEADERBOARD#SEASON#1"]
const zeroPad = (n: number) => String(n).padStart(6, "0")

async function wipeBoard(pk: string): Promise<number> {
  let removed = 0
  let lastKey: Record<string, unknown> | undefined
  do {
    const res = await ddb.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: { ":pk": pk },
      ExclusiveStartKey: lastKey,
    }))
    for (const item of res.Items ?? []) {
      await ddb.send(new DeleteCommand({ TableName: TABLE, Key: { pk, sk: item.sk as string } }))
      removed++
    }
    lastKey = res.LastEvaluatedKey
  } while (lastKey)
  return removed
}

async function main() {
  for (const board of BOARDS) {
    console.log(`wiped ${await wipeBoard(board)} rows from ${board}`)
  }

  let lastKey: Record<string, unknown> | undefined
  let written = 0
  do {
    const res = await ddb.send(new ScanCommand({
      TableName: TABLE,
      FilterExpression: "sk = :profile AND attribute_exists(elo) AND gamesPlayed > :zero",
      ExpressionAttributeValues: { ":profile": "PROFILE", ":zero": 0 },
      ExclusiveStartKey: lastKey,
    }))
    for (const item of res.Items ?? []) {
      const userId = item.userId as string
      if (!userId || userId.startsWith("bot-") || userId.startsWith("test-")) continue
      for (const board of BOARDS) {
        await ddb.send(new PutCommand({
          TableName: TABLE,
          Item: {
            pk: board,
            sk: `RANK#${zeroPad(item.elo as number)}#${userId}`,
            userId,
            elo: item.elo,
            displayName: item.displayName,
            avatar: (item.avatar as string | null) ?? null,
            gamesPlayed: item.gamesPlayed,
            gamesWon: item.gamesWon,
            updatedAt: Date.now(),
          },
        }))
        written++
      }
    }
    lastKey = res.LastEvaluatedKey
  } while (lastKey)
  console.log(`wrote ${written} rank rows`)
}

main().catch((err) => { console.error(err); process.exit(1) })
