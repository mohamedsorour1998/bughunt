import { test, expect } from "@playwright/test"

// The practice page uses useSession() — mock the NextAuth session endpoint
// so the page can determine whether to show the sign-in nudge.
test.beforeEach(async ({ page }) => {
  await page.route("**/api/auth/session", route =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        user: {
          id: "test-user-1",
          name: "Test Player One",
          email: "testuser1@bughunt.test",
          image: null,
        },
        expires: "2099-01-01",
      }),
    })
  )
})

test("practice page shows Practice Mode badge", async ({ page }) => {
  await page.goto("/practice")
  await expect(page.getByText(/Practice Mode/i)).toBeVisible()
})

test("practice page loads a code block", async ({ page }) => {
  await page.goto("/practice")
  // Code block (pre or code element) should appear after bug loads
  await expect(page.locator("pre").first().or(page.locator("code").first())).toBeVisible({
    timeout: 10000,
  })
})

test("practice page shows 4 answer option buttons", async ({ page }) => {
  await page.goto("/practice")
  // Wait for the answer grid to appear — AnswerOptions renders a grid of 4 buttons,
  // each containing a label span (A/B/C/D) and an option text span.
  // We wait until at least one button with a single-letter label span exists.
  await page.waitForFunction(
    () => {
      const buttons = Array.from(document.querySelectorAll("button"))
      return buttons.filter(b => {
        const labelSpan = b.querySelector("span")
        return (
          labelSpan &&
          /^[A-D]$/.test(labelSpan.textContent?.trim() ?? "")
        )
      }).length >= 4
    },
    { timeout: 10000 }
  )
  // Locate all buttons that have a single-letter ABCD label span inside
  const optionButtons = page.locator("button").filter({
    has: page.locator("span").filter({ hasText: /^[A-D]$/ }),
  })
  await expect(optionButtons).toHaveCount(4)
})

test("clicking answer reveals explanation and Next Bug button", async ({ page }) => {
  await page.goto("/practice")
  await page.waitForFunction(
    () => {
      const buttons = Array.from(document.querySelectorAll("button"))
      return (
        buttons.filter(b => {
          const labelSpan = b.querySelector("span")
          return labelSpan && /^[A-D]$/.test(labelSpan.textContent?.trim() ?? "")
        }).length >= 4
      )
    },
    { timeout: 10000 }
  )
  const optionButtons = page.locator("button").filter({
    has: page.locator("span").filter({ hasText: /^[A-D]$/ }),
  })
  await optionButtons.first().click()
  await expect(page.getByRole("button", { name: /Next Bug/i })).toBeVisible({ timeout: 5000 })
})

test("Next Bug button loads a new code block", async ({ page }) => {
  await page.goto("/practice")
  await page.waitForFunction(
    () => {
      const buttons = Array.from(document.querySelectorAll("button"))
      return (
        buttons.filter(b => {
          const labelSpan = b.querySelector("span")
          return labelSpan && /^[A-D]$/.test(labelSpan.textContent?.trim() ?? "")
        }).length >= 4
      )
    },
    { timeout: 10000 }
  )
  await page.locator("button").filter({ has: page.locator("span").filter({ hasText: /^[A-D]$/ }) }).first().click()
  await page.getByRole("button", { name: /Next Bug/i }).click()
  await expect(page.locator("pre").first().or(page.locator("code").first())).toBeVisible({
    timeout: 10000,
  })
})
