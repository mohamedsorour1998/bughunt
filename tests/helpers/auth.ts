export function getStorageStatePath(userId: string): string {
  return `tests/helpers/.auth-${userId}.json`
}
