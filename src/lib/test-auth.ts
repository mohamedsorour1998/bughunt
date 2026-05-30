/**
 * TEST_MODE auth bypass — only active when process.env.TEST_MODE === "true".
 * API routes call this as a fallback when auth() returns null.
 * The x-test-user-id header is set only in test requests, never in production.
 */
export function getTestSession(req: Request): { user: { id: string; email: string; name: string } } | null {
  if (process.env.TEST_MODE !== "true") return null
  const userId = req.headers.get("x-test-user-id")
  if (!userId) return null
  const users: Record<string, { id: string; email: string; name: string }> = {
    "test-user-1": { id: "test-user-1", email: "testuser1@bughunt.test", name: "Test Player One" },
    "test-user-2": { id: "test-user-2", email: "testuser2@bughunt.test", name: "Test Player Two" },
  }
  return users[userId] ? { user: users[userId] } : null
}
