// Mock for @/auth — used in TEST_MODE to avoid loading NextAuth and its ESM-only dependencies
export async function auth(): Promise<null> {
  return null
}

export const handlers = {}
export const signIn = async () => {}
export const signOut = async () => {}
