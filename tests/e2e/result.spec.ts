import { test, expect, type Page } from "@playwright/test"
import { seedTestUsers, cleanupTestUsers, seedTestGame, cleanupTestGame, getFirstNActiveBugIds } from "../helpers/db"
import { TEST_USER_1, TEST_USER_2, TABLE_NAME } from "../helpers/fixtures"
import { DynamoDBClient } from "@aws-sdk/client-dynamodb"
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb"

const COMPLETED_GAME_ID = `test-result-game-${Date.now()}`

const ddb = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: process.env.AWS_REGION ?? "us-east-1" }),
  { marshallOptions: { removeUndefinedValues: true } }
)

// Write a GAMEID# lookup item so the result page can find match history
async function seedMatchHistoryLookup(gameId: string, userId: string, result: "win" | "loss") {
  await ddb.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: {
      pk: `USER#${userId}`,
      sk: `GAMEID#${gameId}`,
      gameId,
      result,
      eloBefore: 1200,
      eloAfter: result === "win" ? 1216 : 1184,
      eloChange: result === "win" ? 16 : -16,
      opponentId: TEST_USER_2.userId,
      opponentName: TEST_USER_2.displayName,
      newAchievements: [],
      createdAt: Date.now(),
    },
  }))
}

// Seed PLAYER# records (answers[] shape) so the result page can resolve player1/player2 records
async function seedGamePlayers(gameId: string, player1Id: string, player2Id: string, bugIds: string[]) {
  const now = Date.now()
  for (const [userId, allCorrect] of [[player1Id, true], [player2Id, false]] as [string, boolean][]) {
    await ddb.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        pk: `GAME#${gameId}`,
        sk: `PLAYER#${userId}`,
        gameId,
        userId,
        answers: bugIds.map((bugId) => ({
          bugId,
          answer: 0,
          correct: allCorrect,
          submittedAt: now,
          timeElapsedMs: 5000,
        })),
      },
    }))
  }
}

async function mockSession(page: Page) {
  await page.route("/api/auth/session", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      user: { id: TEST_USER_1.userId, name: TEST_USER_1.displayName, email: TEST_USER_1.email, image: null },
      expires: "2099-01-01",
    }),
  }))
}

test.describe("Result page", () => {
  test.beforeAll(async () => {
    await seedTestUsers()
    const bugIds = await getFirstNActiveBugIds(3)
    await seedTestGame(COMPLETED_GAME_ID, TEST_USER_1.userId, TEST_USER_2.userId, bugIds, "completed")
    const now = Date.now()
    // Set winnerId + completion fields on the game META so the result page knows who won
    await ddb.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        pk: `GAME#${COMPLETED_GAME_ID}`,
        sk: "META",
        gsi1pk: `ACTIVE_GAME#${TEST_USER_1.userId}`,
        gsi1sk: COMPLETED_GAME_ID,
        gameId: COMPLETED_GAME_ID,
        player1Id: TEST_USER_1.userId,
        player2Id: TEST_USER_2.userId,
        bugIds,
        bugId: bugIds[0],
        currentRound: 3,
        roundStartedAt: [now - 30_000, now - 20_000, now - 10_000],
        status: "completed",
        winnerId: TEST_USER_1.userId,
        createdAt: now - 30_000,
        expiresAt: Math.floor(now / 1000) + 86400 * 90,
      },
    }))
    await seedGamePlayers(COMPLETED_GAME_ID, TEST_USER_1.userId, TEST_USER_2.userId, bugIds)
    await seedMatchHistoryLookup(COMPLETED_GAME_ID, TEST_USER_1.userId, "win")
  })

  test.afterAll(async () => {
    await cleanupTestGame(COMPLETED_GAME_ID)
    await cleanupTestUsers()
  })

  test.beforeEach(async ({ page }) => {
    await mockSession(page)
  })

  test("result page loads for a completed game", async ({ page }) => {
    await page.goto(`/game/result/${COMPLETED_GAME_ID}`)
    // Should NOT show game-not-found error
    await expect(page.getByText(/Game not found|game not found/i)).not.toBeVisible({ timeout: 8000 })
  })

  test("result page shows win/loss/draw outcome banner", async ({ page }) => {
    await page.goto(`/game/result/${COMPLETED_GAME_ID}`)
    await expect(page.getByText(/You Won|You Lost|Draw/i).first()).toBeVisible({ timeout: 8000 })
  })

  test("result page shows Elo change", async ({ page }) => {
    await page.goto(`/game/result/${COMPLETED_GAME_ID}`)
    // Should show something like "+16 Elo" or just "Elo"
    await expect(page.getByText(/Elo/i).first()).toBeVisible({ timeout: 8000 })
  })

  test("result page shows a per-round breakdown for all 3 rounds", async ({ page }) => {
    await page.goto(`/game/result/${COMPLETED_GAME_ID}`)
    await expect(page.getByText(/Round 1 of 3/i).first()).toBeVisible({ timeout: 8000 })
    await expect(page.getByText(/Round 2 of 3/i).first()).toBeVisible({ timeout: 8000 })
    await expect(page.getByText(/Round 3 of 3/i).first()).toBeVisible({ timeout: 8000 })
  })

  test("result page shows Play Again button", async ({ page }) => {
    await page.goto(`/game/result/${COMPLETED_GAME_ID}`)
    await expect(page.getByRole("button", { name: /Play Again/i })).toBeVisible({ timeout: 8000 })
  })

  test("result page for nonexistent game shows error state", async ({ page }) => {
    await page.goto("/game/result/nonexistent-game-id-xyz-abc")
    await expect(page.getByText(/not found|Not Found|Game not found|error/i).first()).toBeVisible({ timeout: 8000 })
  })
})
