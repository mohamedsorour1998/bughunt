/**
 * Safe wrapper around NextAuth's auth() that catches UntrustedHost and other
 * initialization errors that NextAuth throws in test/local environments where
 * AUTH_TRUST_HOST is not set. Returns null on failure so the TEST_MODE fallbacks
 * can proceed.
 */
export async function safeAuth(): Promise<{ user: { id: string; email?: string | null; name?: string | null } } | null> {
  try {
    const { auth } = await import("@/auth")
    const session = await auth()
    // Validate that the session has a usable user id — auth() can return partial
    // objects when NextAuth encounters config errors (UntrustedHost, MissingSecret).
    if (!session?.user?.id) return null
    return session as { user: { id: string; email?: string | null; name?: string | null } }
  } catch {
    return null
  }
}

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

/**
 * Cookie-based TEST_MODE auth bypass for browser-driven Playwright tests.
 * Reads the "test-user-id" cookie set by /api/test/auth.
 */
export async function getTestSessionFromCookies(): Promise<{ user: { id: string; email: string; name: string } } | null> {
  if (process.env.TEST_MODE !== "true") return null
  try {
    const { cookies } = await import("next/headers")
    const cookieStore = await cookies()
    const userId = cookieStore.get("test-user-id")?.value
    if (!userId) return null
    const users: Record<string, { id: string; email: string; name: string }> = {
      "test-user-1": { id: "test-user-1", email: "testuser1@bughunt.test", name: "Test Player One" },
      "test-user-2": { id: "test-user-2", email: "testuser2@bughunt.test", name: "Test Player Two" },
    }
    return users[userId] ? { user: users[userId] } : null
  } catch {
    return null
  }
}
