export const TEST_USER_1 = {
  userId: "test-user-1",
  email: "testuser1@bughunt.test",
  displayName: "Test Player One",
  elo: 1200,
  rank: "Gold",
  gamesPlayed: 5,
  gamesWon: 3,
  currentStreak: 2,
  bestStreak: 3,
  bugsSeen: [] as string[],
  achievementsUnlocked: [] as string[],
  createdAt: Date.now(),
}

export const TEST_USER_2 = {
  userId: "test-user-2",
  email: "testuser2@bughunt.test",
  displayName: "Test Player Two",
  elo: 1250,
  rank: "Gold",
  gamesPlayed: 8,
  gamesWon: 4,
  currentStreak: 0,
  bestStreak: 4,
  bugsSeen: [] as string[],
  achievementsUnlocked: [] as string[],
  createdAt: Date.now(),
}

export const TABLE_NAME = process.env.DYNAMODB_TABLE_NAME ?? "bughunt-main"
export const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000"
