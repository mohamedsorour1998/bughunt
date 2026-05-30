import { test, expect } from "@playwright/test"
import { TEST_USER_1 } from "../helpers/fixtures"

// Mock the NextAuth session and profile API for pages using useSession()
test.beforeEach(async ({ page }) => {
  await page.route("**/api/auth/session", route =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        user: {
          id: TEST_USER_1.userId,
          name: TEST_USER_1.displayName,
          email: TEST_USER_1.email,
          image: null,
        },
        expires: "2099-01-01",
      }),
    })
  )

  // Mock the profile API — the cookie-based TEST_MODE auth bypass
  // requires a Next.js request context that isn't always available in
  // production builds; mocking keeps these tests deterministic.
  await page.route("**/api/user/profile", route =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        userId: TEST_USER_1.userId,
        displayName: TEST_USER_1.displayName,
        avatar: null,
        elo: TEST_USER_1.elo,
        rank: TEST_USER_1.rank,
        gamesPlayed: TEST_USER_1.gamesPlayed,
        gamesWon: TEST_USER_1.gamesWon,
        currentStreak: TEST_USER_1.currentStreak,
        bestStreak: TEST_USER_1.bestStreak,
      }),
    })
  )

  // Mock match history — empty is fine for these tests
  await page.route("**/api/user/history", route =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ entries: [] }),
    })
  )

  // Mock public profile endpoint for /profile/[userId]
  await page.route(`**/api/user/profile/${TEST_USER_1.userId}`, route =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        userId: TEST_USER_1.userId,
        displayName: TEST_USER_1.displayName,
        avatar: null,
        elo: TEST_USER_1.elo,
        rank: TEST_USER_1.rank,
        gamesPlayed: TEST_USER_1.gamesPlayed,
        gamesWon: TEST_USER_1.gamesWon,
        currentStreak: TEST_USER_1.currentStreak,
        bestStreak: TEST_USER_1.bestStreak,
      }),
    })
  )
})

test("own profile shows displayName", async ({ page }) => {
  await page.goto("/profile")
  // displayName appears in both navbar and profile header; target the h1 specifically
  await expect(page.getByRole("heading", { name: TEST_USER_1.displayName })).toBeVisible({
    timeout: 8000,
  })
})

test("own profile shows Elo 1200", async ({ page }) => {
  await page.goto("/profile")
  await expect(page.getByText(/1200/).first()).toBeVisible({ timeout: 8000 })
})

test("own profile shows Gold rank badge", async ({ page }) => {
  await page.goto("/profile")
  await expect(page.getByText(/Gold/i).first()).toBeVisible({ timeout: 8000 })
})

test("own profile shows stats grid", async ({ page }) => {
  await page.goto("/profile")
  await expect(page.getByText(/Games Played/i)).toBeVisible({ timeout: 8000 })
})

test("public profile page shows displayName without email", async ({ page }) => {
  await page.goto(`/profile/${TEST_USER_1.userId}`)
  // displayName may appear in navbar too — target the h1 heading specifically
  await expect(page.getByRole("heading", { name: TEST_USER_1.displayName })).toBeVisible({
    timeout: 8000,
  })
  await expect(page.getByText(TEST_USER_1.email)).not.toBeVisible()
})
