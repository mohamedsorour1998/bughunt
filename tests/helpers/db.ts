import { DynamoDBClient } from "@aws-sdk/client-dynamodb"
import {
  DynamoDBDocumentClient, PutCommand, DeleteCommand,
  GetCommand, QueryCommand
} from "@aws-sdk/lib-dynamodb"
import { TEST_USER_1, TEST_USER_2, TABLE_NAME } from "./fixtures"

const client = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: process.env.AWS_REGION ?? "us-east-1" }),
  { marshallOptions: { removeUndefinedValues: true } }
)

export async function seedTestUsers(): Promise<void> {
  for (const user of [TEST_USER_1, TEST_USER_2]) {
    await client.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        pk: `USER#${user.userId}`,
        sk: "PROFILE",
        gsi2pk: `EMAIL#${user.email}`,
        gsi2sk: user.userId,
        userId: user.userId,
        email: user.email,
        displayName: user.displayName,
        avatar: null,
        elo: user.elo,
        rank: user.rank,
        gamesPlayed: user.gamesPlayed,
        gamesWon: user.gamesWon,
        currentStreak: user.currentStreak,
        bestStreak: user.bestStreak,
        bugsSeen: user.bugsSeen,
        achievementsUnlocked: user.achievementsUnlocked,
        createdAt: user.createdAt,
      },
    }))
  }
}

export async function cleanupTestUsers(): Promise<void> {
  for (const user of [TEST_USER_1, TEST_USER_2]) {
    await client.send(new DeleteCommand({
      TableName: TABLE_NAME,
      Key: { pk: `USER#${user.userId}`, sk: "PROFILE" },
    })).catch(() => {}) // ignore if already deleted
  }
}

export async function getTestUserFromDB(userId: string): Promise<Record<string, unknown> | null> {
  const res = await client.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: { pk: `USER#${userId}`, sk: "PROFILE" },
  }))
  return res.Item ?? null
}

interface RoundAnswer {
  bugId: string
  answer: number | null
  correct: boolean | null
  submittedAt: number | null
  timeElapsedMs: number | null
}

function emptyRoundAnswer(bugId: string): RoundAnswer {
  return { bugId, answer: null, correct: null, submittedAt: null, timeElapsedMs: null }
}

export async function seedTestGame(
  gameId: string,
  player1Id: string,
  player2Id: string,
  bugIds: string[],
  status = "active"
): Promise<void> {
  const now = Date.now()
  const roundStartedAt = bugIds.map((_, i) => (i === 0 ? now : 0))

  // Main game record
  await client.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: {
      pk: `GAME#${gameId}`,
      sk: "META",
      gsi1pk: `ACTIVE_GAME#${player1Id}`,
      gsi1sk: gameId,
      gameId,
      player1Id,
      player2Id,
      bugIds,
      bugId: bugIds[0],
      currentRound: 0,
      roundStartedAt,
      status,
      winnerId: null,
      createdAt: now,
      expiresAt: Math.floor(now / 1000) + 86400 * 90,
    },
  }))
  // GSI1 marker for player 2
  await client.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: {
      pk: `GAME#${gameId}`,
      sk: `ACTIVE_PLAYER#${player2Id}`,
      gsi1pk: `ACTIVE_GAME#${player2Id}`,
      gsi1sk: gameId,
      expiresAt: Math.floor(now / 1000) + 86400 * 90,
    },
  }))
  // Pre-filled GamePlayer records for both players (mirrors createGamePlayerRecord)
  for (const userId of [player1Id, player2Id]) {
    await client.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        pk: `GAME#${gameId}`,
        sk: `PLAYER#${userId}`,
        gameId,
        userId,
        answers: bugIds.map(emptyRoundAnswer),
      },
    }))
  }
}

// Overwrite a player's answers array directly — useful for seeding completed-game fixtures
export async function seedGamePlayerAnswers(
  gameId: string,
  userId: string,
  answers: RoundAnswer[]
): Promise<void> {
  await client.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: {
      pk: `GAME#${gameId}`,
      sk: `PLAYER#${userId}`,
      gameId,
      userId,
      answers,
    },
  }))
}

export async function cleanupTestGame(gameId: string): Promise<void> {
  const res = await client.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: "pk = :pk",
    ExpressionAttributeValues: { ":pk": `GAME#${gameId}` },
  })).catch(() => ({ Items: [] }))
  for (const item of res.Items ?? []) {
    await client.send(new DeleteCommand({
      TableName: TABLE_NAME,
      Key: { pk: item.pk as string, sk: item.sk as string },
    })).catch(() => {})
  }
}

export async function getFirstActiveBugId(): Promise<string> {
  const res = await client.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: { pk: "BUG#INDEX", sk: "META" },
  }))
  const ids = (res.Item?.bugIds as string[]) ?? []
  if (!ids.length) throw new Error("No bugs in BUG#INDEX — run npm run db:seed first")
  return ids[0]
}

export async function getFirstNActiveBugIds(n: number): Promise<string[]> {
  const res = await client.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: { pk: "BUG#INDEX", sk: "META" },
  }))
  const ids = (res.Item?.bugIds as string[]) ?? []
  if (ids.length < n) throw new Error(`Need ${n} bugs in BUG#INDEX — run npm run db:seed first`)
  return ids.slice(0, n)
}
