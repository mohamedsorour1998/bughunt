import { test as setup, expect } from "@playwright/test"
import { seedTestUsers } from "../helpers/db"
import { TEST_USER_1, TEST_USER_2 } from "../helpers/fixtures"
import { getStorageStatePath } from "../helpers/auth"

setup.describe.configure({ mode: "serial" })

setup("seed test users in DynamoDB", async () => {
  await seedTestUsers()
})

setup("create auth state for test-user-1", async ({ page }) => {
  const response = await page.request.post("/api/test/auth", {
    data: { userId: TEST_USER_1.userId },
  })
  expect(response.ok()).toBeTruthy()
  await page.context().storageState({ path: getStorageStatePath("user1") })
})

setup("create auth state for test-user-2", async ({ page }) => {
  const response = await page.request.post("/api/test/auth", {
    data: { userId: TEST_USER_2.userId },
  })
  expect(response.ok()).toBeTruthy()
  await page.context().storageState({ path: getStorageStatePath("user2") })
})
