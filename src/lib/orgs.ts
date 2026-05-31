// src/lib/orgs.ts
import { v4 as uuidv4 } from "uuid"
import {
  getItem,
  putItem,
  updateItem,
  queryItems,
  ddb,
  TABLE_NAME,
} from "@/lib/dynamodb"
import { UpdateCommand } from "@aws-sdk/lib-dynamodb"
import crypto from "crypto"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Org = {
  orgId: string
  name: string
  slug: string
  adminId: string
  memberCount: number
  createdAt: number
  inviteCode: string
}

export type OrgMember = {
  orgId: string
  userId: string
  displayName: string
  elo: number
  joinedAt: number
  role: "admin" | "member"
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateInviteCode(): string {
  return crypto.randomBytes(4).toString("hex").toUpperCase()
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48)
}

// ---------------------------------------------------------------------------
// createOrg
// ---------------------------------------------------------------------------

export async function createOrg(
  name: string,
  adminId: string,
  adminDisplayName: string,
  adminElo: number
): Promise<Org> {
  const orgId = uuidv4()
  const now = Date.now()
  const inviteCode = generateInviteCode()
  const slug = slugify(name)

  const org: Org = {
    orgId,
    name,
    slug,
    adminId,
    memberCount: 1,
    createdAt: now,
    inviteCode,
  }

  await putItem({
    pk: `ORG#${orgId}`,
    sk: "META",
    ...org,
    // Invite code index so we can find org by code
    gsi1pk: `INVITE#${inviteCode}`,
    gsi1sk: orgId,
  })

  // Write admin as first member
  await putItem({
    pk: `ORG#${orgId}`,
    sk: `MEMBER#${adminId}`,
    orgId,
    userId: adminId,
    displayName: adminDisplayName,
    elo: adminElo,
    joinedAt: now,
    role: "admin",
  })

  // Reverse index on the user
  await putItem({
    pk: `USER#${adminId}`,
    sk: `ORG#${orgId}`,
    orgId,
    orgName: name,
    joinedAt: now,
  })

  // Seed org leaderboard entry for admin
  await putItem({
    pk: `LEADERBOARD#ORG#${orgId}`,
    sk: `RANK#${String(adminElo).padStart(12, "0")}#${adminId}`,
    userId: adminId,
    displayName: adminDisplayName,
    elo: adminElo,
    updatedAt: now,
  })

  return org
}

// ---------------------------------------------------------------------------
// joinOrg
// ---------------------------------------------------------------------------

export async function joinOrg(
  inviteCode: string,
  userId: string,
  displayName: string,
  elo: number
): Promise<{ success: boolean; orgId?: string; error?: string }> {
  // Find org by invite code via GSI
  const { items } = await queryItems(
    "gsi1pk = :pk",
    { ":pk": `INVITE#${inviteCode}` },
    { indexName: "gsi1" }
  )

  if (items.length === 0) {
    return { success: false, error: "Invalid invite code" }
  }

  const orgId = (items[0].orgId as string) ?? (items[0].gsi1sk as string)

  // Check user is not already a member
  const existing = await getItem(`ORG#${orgId}`, `MEMBER#${userId}`)
  if (existing) {
    return { success: false, error: "Already a member of this org" }
  }

  const now = Date.now()
  const orgMeta = await getItem(`ORG#${orgId}`, "META") as (Org & { pk: string; sk: string }) | null
  if (!orgMeta) return { success: false, error: "Org not found" }

  // Write member item
  await putItem({
    pk: `ORG#${orgId}`,
    sk: `MEMBER#${userId}`,
    orgId,
    userId,
    displayName,
    elo,
    joinedAt: now,
    role: "member",
  })

  // Write reverse user index
  await putItem({
    pk: `USER#${userId}`,
    sk: `ORG#${orgId}`,
    orgId,
    orgName: orgMeta.name,
    joinedAt: now,
  })

  // Increment memberCount
  await ddb.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { pk: `ORG#${orgId}`, sk: "META" },
      UpdateExpression: "ADD #mc :inc",
      ExpressionAttributeNames: { "#mc": "memberCount" },
      ExpressionAttributeValues: { ":inc": 1 },
    })
  )

  // Seed org leaderboard entry for the new member
  await putItem({
    pk: `LEADERBOARD#ORG#${orgId}`,
    sk: `RANK#${String(elo).padStart(12, "0")}#${userId}`,
    userId,
    displayName,
    elo,
    updatedAt: now,
  })

  return { success: true, orgId }
}

// ---------------------------------------------------------------------------
// getOrg
// ---------------------------------------------------------------------------

export async function getOrg(orgId: string): Promise<{
  org: Org | null
  members: OrgMember[]
}> {
  const { items } = await queryItems(
    "pk = :pk",
    { ":pk": `ORG#${orgId}` }
  )

  const meta = items.find((i) => i.sk === "META") as (Org & { pk: string; sk: string }) | undefined
  if (!meta) return { org: null, members: [] }

  const members = items
    .filter((i) => typeof i.sk === "string" && (i.sk as string).startsWith("MEMBER#"))
    .map((i) => i as unknown as OrgMember)

  return { org: meta as unknown as Org, members }
}

// ---------------------------------------------------------------------------
// getOrgLeaderboard
// ---------------------------------------------------------------------------

export async function getOrgLeaderboard(orgId: string): Promise<
  { userId: string; displayName: string; elo: number }[]
> {
  const { items } = await queryItems(
    "pk = :pk",
    { ":pk": `LEADERBOARD#ORG#${orgId}` },
    { scanIndexForward: false, limit: 50 }
  )

  return items.map((i) => ({
    userId: i.userId as string,
    displayName: i.displayName as string,
    elo: i.elo as number,
  }))
}

// ---------------------------------------------------------------------------
// getUserOrgs
// ---------------------------------------------------------------------------

export async function getUserOrgs(userId: string): Promise<
  { orgId: string; orgName: string; joinedAt: number }[]
> {
  const { items } = await queryItems(
    "pk = :pk AND begins_with(sk, :prefix)",
    { ":pk": `USER#${userId}`, ":prefix": "ORG#" }
  )

  return items.map((i) => ({
    orgId: i.orgId as string,
    orgName: i.orgName as string,
    joinedAt: i.joinedAt as number,
  }))
}

// ---------------------------------------------------------------------------
// regenerateInviteCode
// ---------------------------------------------------------------------------

export async function regenerateInviteCode(
  orgId: string,
  requestingUserId: string
): Promise<{ success: boolean; inviteCode?: string; error?: string }> {
  const { org } = await getOrg(orgId)
  if (!org) return { success: false, error: "Org not found" }
  if (org.adminId !== requestingUserId) return { success: false, error: "Forbidden" }

  const newCode = generateInviteCode()

  await ddb.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { pk: `ORG#${orgId}`, sk: "META" },
      UpdateExpression: "SET #ic = :code, gsi1pk = :gsi1pk",
      ExpressionAttributeNames: { "#ic": "inviteCode" },
      ExpressionAttributeValues: {
        ":code": newCode,
        ":gsi1pk": `INVITE#${newCode}`,
      },
    })
  )

  return { success: true, inviteCode: newCode }
}

// ---------------------------------------------------------------------------
// updateOrgMemberElo  (called after a game to keep leaderboard fresh)
// ---------------------------------------------------------------------------

export async function updateOrgMemberElo(
  orgId: string,
  userId: string,
  displayName: string,
  newElo: number
): Promise<void> {
  const now = Date.now()
  // Overwrite the leaderboard entry with the new Elo sort key
  await putItem({
    pk: `LEADERBOARD#ORG#${orgId}`,
    sk: `RANK#${String(newElo).padStart(12, "0")}#${userId}`,
    userId,
    displayName,
    elo: newElo,
    updatedAt: now,
  })
  // Also update the member record
  await updateItem(`ORG#${orgId}`, `MEMBER#${userId}`, { elo: newElo })
}
