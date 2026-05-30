import NextAuth from "next-auth"
import Google from "next-auth/providers/google"
import GitHub from "next-auth/providers/github"
import { DynamoDBAdapter } from "@auth/dynamodb-adapter"
import { DynamoDB, DynamoDBClientConfig } from "@aws-sdk/client-dynamodb"
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb"

const config: DynamoDBClientConfig = {
  region: process.env.AWS_REGION ?? "us-east-1",
}

const client = DynamoDBDocument.from(new DynamoDB(config), {
  marshallOptions: { removeUndefinedValues: true },
})

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DynamoDBAdapter(client, {
    tableName: "bughunt-main",
    partitionKey: "pk",
    sortKey: "sk",
    indexName: "gsi1",
    indexPartitionKey: "gsi1pk",
    indexSortKey: "gsi1sk",
  }),
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      allowDangerousEmailAccountLinking: true,
    }),
    GitHub({
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
      allowDangerousEmailAccountLinking: true,
    }),
  ],
  callbacks: {
    session({ session, user }) {
      if (session.user) session.user.id = user.id
      return session
    },
  },
  events: {
    async createUser({ user }) {
      const { DynamoDBClient } = await import("@aws-sdk/client-dynamodb")
      const { DynamoDBDocument: DDC } = await import("@aws-sdk/lib-dynamodb")
      const ddb = DDC.from(
        new DynamoDBClient({ region: process.env.AWS_REGION ?? "us-east-1" })
      )
      try {
        await ddb.put({
          TableName: "bughunt-main",
          Item: {
            pk: `USER#${user.id}`,
            sk: "PROFILE",
            gsi2pk: `EMAIL#${user.email}`,
            gsi2sk: user.id!,
            userId: user.id,
            email: user.email,
            displayName: user.name ?? user.email?.split("@")[0] ?? "Player",
            avatar: user.image ?? null,
            elo: 1200,
            rank: "Gold",
            gamesPlayed: 0,
            gamesWon: 0,
            currentStreak: 0,
            bestStreak: 0,
            bugsSeen: [],
            achievementsUnlocked: [],
            createdAt: Date.now(),
          },
          ConditionExpression: "attribute_not_exists(pk)",
        })
      } catch (err: unknown) {
        // ConditionalCheckFailedException = profile already exists (idempotent re-login), safe to ignore
        if ((err as { name?: string }).name !== "ConditionalCheckFailedException") {
          console.error("[auth] Failed to create user profile for", user.id, err)
        }
      }
    },
  },
})
