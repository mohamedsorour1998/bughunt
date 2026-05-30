import { test, expect } from "@playwright/test"

test("hero heading is visible", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByRole("heading", { name: /Debug Faster/i })).toBeVisible()
})

test("Start Playing CTA links to /play", async ({ page }) => {
  await page.goto("/")
  // Multiple "Start Playing" links may appear (hero + leaderboard preview); check the first
  const cta = page.getByRole("link", { name: /Start Playing/i }).first()
  await expect(cta).toBeVisible()
  await expect(cta).toHaveAttribute("href", "/play")
})

test("Practice Solo CTA links to /practice", async ({ page }) => {
  await page.goto("/")
  const cta = page.getByRole("link", { name: /Practice Solo/i })
  await expect(cta).toBeVisible()
  await expect(cta).toHaveAttribute("href", "/practice")
})

test("3 feature cards are visible", async ({ page }) => {
  await page.goto("/")
  // Match headings for the feature cards — these are h3 elements
  await expect(page.getByRole("heading", { name: /Real Bugs/i })).toBeVisible()
  await expect(page.getByRole("heading", { name: /Elo Rating/i })).toBeVisible()
  await expect(page.getByRole("heading", { name: /Matchmaking/i })).toBeVisible()
})

test("Navbar links are visible on landing", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByRole("link", { name: /Leaderboard/i }).first()).toBeVisible()
})
