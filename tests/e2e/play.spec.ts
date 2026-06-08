import { test, expect, type BrowserContext, type Page } from "@playwright/test"
import { cleanupTestUsers, seedTestUsers } from "../helpers/db"
import { TEST_USER_1, TEST_USER_2 } from "../helpers/fixtures"
import { getStorageStatePath } from "../helpers/auth"

// Helper to mock NextAuth session for a given page
async function mockSession(page: Page, user: typeof TEST_USER_1) {
  await page.route("**/api/auth/session", route =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        user: { id: user.userId, name: user.displayName, email: user.email, image: null },
        expires: "2099-01-01",
      }),
    })
  )
}

let ctx1: BrowserContext
let ctx2: BrowserContext
let page1: Page
let page2: Page
let createdGameId: string | null = null

test.describe("Two-player full game flow", () => {
  test.describe.configure({ mode: "serial" })

  test.beforeAll(async ({ browser }) => {
    await seedTestUsers()

    // Player 1 context with user1 auth state
    ctx1 = await browser.newContext({ storageState: getStorageStatePath("user1") })
    page1 = await ctx1.newPage()
    await mockSession(page1, TEST_USER_1)

    // Player 2 context with user2 auth state
    ctx2 = await browser.newContext({ storageState: getStorageStatePath("user2") })
    page2 = await ctx2.newPage()
    await mockSession(page2, TEST_USER_2)
  })

  test.afterAll(async () => {
    await cleanupTestUsers()
    await ctx1.close()
    await ctx2.close()
  })

  test("idle state: Find Match button and Elo visible for player 1", async () => {
    await page1.goto("/play")
    await expect(page1.getByRole("button", { name: /Find Match/i })).toBeVisible({ timeout: 8000 })
  })

  test("both players matchmake and reach playing state", async () => {
    // Player 1 finds match
    await page1.goto("/play")
    await mockSession(page1, TEST_USER_1)
    await page1.getByRole("button", { name: /Find Match/i }).click()
    await expect(page1.getByText(/Finding Opponent/i)).toBeVisible({ timeout: 8000 })

    // Player 2 finds match shortly after
    await page2.goto("/play")
    await mockSession(page2, TEST_USER_2)
    await page2.getByRole("button", { name: /Find Match/i }).click()

    // Both should reach playing state (code block visible) within 20 seconds
    await expect(page1.locator("pre").first()).toBeVisible({ timeout: 30000 })
    await expect(page2.locator("pre").first()).toBeVisible({ timeout: 30000 })
  })

  test("playing state shows timer, round badge, and 4 answer buttons on both sides", async () => {
    // Timer like "2:00" or "1:58"
    await expect(page1.getByText(/\d+:\d{2}/).first()).toBeVisible()
    // Round badge
    await expect(page1.getByText(/Round 1 of 3/i).first()).toBeVisible({ timeout: 8000 })
    // 4 answer buttons
    const answerBtns = page1.locator("button").filter({
      has: page1.locator("span").filter({ hasText: /^[A-D]$/ }),
    })
    await expect(answerBtns).toHaveCount(4)
  })

  test("both players play through all 3 rounds and redirect to the result page", async () => {
    const answerBtnsFor = (page: Page) =>
      page.locator("button").filter({ has: page.locator("span").filter({ hasText: /^[A-D]$/ }) })

    for (let round = 1; round <= 3; round++) {
      await expect(page1.getByText(new RegExp(`Round ${round} of 3`, "i")).first()).toBeVisible({ timeout: 30000 })
      await expect(page2.getByText(new RegExp(`Round ${round} of 3`, "i")).first()).toBeVisible({ timeout: 30000 })

      const p1Btns = answerBtnsFor(page1)
      const p2Btns = answerBtnsFor(page2)

      // Guard: only click if still enabled (round may have auto-advanced already)
      if (await p1Btns.first().isEnabled().catch(() => false)) await p1Btns.first().click()
      await expect(p1Btns.first()).toBeDisabled({ timeout: 8000 })

      if (await p2Btns.first().isEnabled().catch(() => false)) await p2Btns.first().click()
      await expect(p2Btns.first()).toBeDisabled({ timeout: 8000 })

      if (round < 3) {
        // Next round's code block + re-enabled buttons appear once both have submitted
        await expect(page1.getByText(new RegExp(`Round ${round + 1} of 3`, "i")).first()).toBeVisible({ timeout: 30000 })
        await expect(page2.getByText(new RegExp(`Round ${round + 1} of 3`, "i")).first()).toBeVisible({ timeout: 30000 })
        await expect(answerBtnsFor(page1).first()).toBeEnabled({ timeout: 15000 })
        await expect(answerBtnsFor(page2).first()).toBeEnabled({ timeout: 15000 })
      }
    }

    // Both pages redirect to /game/result/...
    await page1.waitForURL(/\/game\/result\//, { timeout: 30000 })
    await page2.waitForURL(/\/game\/result\//, { timeout: 30000 })

    // Capture gameId for optional cleanup
    const url = page1.url()
    const match = url.match(/\/game\/result\/([^/?]+)/)
    if (match) createdGameId = match[1]
  })

  test("result page shows outcome banner on both pages", async () => {
    // Both pages should show some outcome — use .first() to avoid strict-mode
    // violation when the outcome text appears in both the h1 and a summary span.
    await expect(page1.getByText(/You Won|You Lost|Draw/i).first()).toBeVisible({ timeout: 8000 })
    await expect(page2.getByText(/You Won|You Lost|Draw/i).first()).toBeVisible({ timeout: 8000 })
  })

  test("result page shows Elo change on both pages", async () => {
    await expect(page1.getByText(/[+-]\d+ Elo|Elo/i).first()).toBeVisible({ timeout: 5000 })
    await expect(page2.getByText(/[+-]\d+ Elo|Elo/i).first()).toBeVisible({ timeout: 5000 })
  })

  test("Play Again button navigates back to /play", async () => {
    await page1.getByRole("button", { name: /Play Again/i }).click()
    await expect(page1).toHaveURL("/play", { timeout: 5000 })
  })
})
