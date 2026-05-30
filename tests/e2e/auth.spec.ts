import { test, expect } from "@playwright/test"
import { TEST_USER_1 } from "../helpers/fixtures"

test("login page renders Google and GitHub sign-in buttons", async ({ browser }) => {
  // Use fresh context without auth state
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await page.goto("/login")
  await expect(page.getByText(/Google/i)).toBeVisible()
  await expect(page.getByText(/GitHub/i)).toBeVisible()
  await ctx.close()
})

test("unauthenticated user sees sign-in prompt on play page", async ({ browser }) => {
  const ctx = await browser.newContext() // no storageState
  const page = await ctx.newPage()
  await page.goto("/play")
  await expect(page.getByRole("button", { name: /Sign in to play/i })).toBeVisible()
  await ctx.close()
})

test("authenticated user can access play page (Find Match visible)", async ({ page }) => {
  // Intercept NextAuth session endpoint to return test user's session.
  // useSession() calls /api/auth/session — we mock it to return test-user-1.
  await page.route("**/api/auth/session", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        user: {
          id: TEST_USER_1.userId,
          email: TEST_USER_1.email,
          name: TEST_USER_1.displayName,
        },
        expires: new Date(Date.now() + 3600 * 1000).toISOString(),
      }),
    })
  })
  await page.goto("/play")
  await expect(page.getByRole("button", { name: /Find Match/i })).toBeVisible({ timeout: 8000 })
})
