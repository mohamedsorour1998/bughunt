import { cleanupTestUsers } from "../helpers/db"

export default async function globalTeardown() {
  try {
    await cleanupTestUsers()
    console.log("[teardown] Test user cleanup complete.")
  } catch (e) {
    console.warn("[teardown] Cleanup failed (non-fatal):", e)
  }
}
