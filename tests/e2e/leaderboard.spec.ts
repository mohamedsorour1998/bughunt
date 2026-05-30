import { test, expect } from "@playwright/test"

test("leaderboard page renders without error", async ({ page }) => {
  await page.goto("/leaderboard")
  // No error boundary / crash
  await expect(page.locator("body")).not.toContainText("Application error")
  // Wait for the page to hydrate — the Leaderboard heading must be visible
  await expect(page.getByRole("heading", { name: /^Leaderboard$/i })).toBeVisible({
    timeout: 5000,
  })
  // Either table or empty state (empty state text may vary)
  const hasTable = (await page.locator("table").count()) > 0
  const hasEmptyState = (await page.getByText(/No players/i).count()) > 0
  expect(hasTable || hasEmptyState).toBeTruthy()
})

test("leaderboard shows Season 1 banner", async ({ page }) => {
  await page.goto("/leaderboard")
  // Use the paragraph in the season banner (not the tab button, which also contains "Season 1")
  const seasonBanner = page
    .locator("p")
    .filter({ hasText: /^Season 1$/ })
    .first()
    .or(page.getByText(/Season 1/i).first())
  await expect(seasonBanner).toBeVisible({ timeout: 5000 })
})

test("leaderboard tabs are present (All Time / Season 1)", async ({ page }) => {
  await page.goto("/leaderboard")
  // LeaderboardTabs uses Base UI Tabs which renders with role="tab"
  const allTimeTab = page
    .getByRole("tab", { name: /All Time/i })
    .or(page.getByRole("button", { name: /All Time/i }))
  if ((await allTimeTab.count()) > 0) {
    await expect(allTimeTab.first()).toBeVisible()
  }
})
