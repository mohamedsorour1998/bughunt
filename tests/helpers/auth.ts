export function getStorageStatePath(userId: "user1" | "user2"): string {
  return `tests/helpers/.auth-${userId}.json`
}
