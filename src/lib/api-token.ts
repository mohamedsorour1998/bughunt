import { getItem, putItem, deleteItem, TABLE_NAME, ddb } from "@/lib/dynamodb"
import { QueryCommand } from "@aws-sdk/lib-dynamodb"
import { createHash, randomBytes } from "crypto"

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex")
}

export async function generateApiToken(userId: string): Promise<string> {
  const raw = randomBytes(32).toString("hex")
  const hashed = hashToken(raw)
  await putItem({
    pk: `USER#${userId}`,
    sk: "API_TOKEN",
    userId,
    tokenHash: hashed,
    createdAt: Date.now(),
  })
  return `${userId}.${raw}` // format: userId.hex — userId for O(1) lookup
}

export async function validateApiToken(bearerToken: string): Promise<string | null> {
  const parts = bearerToken.split(".")
  if (parts.length !== 2) return null
  const [userId, raw] = parts
  const item = await getItem(`USER#${userId}`, "API_TOKEN")
  if (!item) return null
  const hashed = hashToken(raw)
  if (item.tokenHash !== hashed) return null
  return userId
}

export async function revokeApiToken(userId: string): Promise<void> {
  await deleteItem(`USER#${userId}`, "API_TOKEN")
}

export async function hasApiToken(userId: string): Promise<boolean> {
  const item = await getItem(`USER#${userId}`, "API_TOKEN")
  return !!item
}
