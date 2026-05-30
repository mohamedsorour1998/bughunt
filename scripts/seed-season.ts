/**
 * Seed Season 1 into DynamoDB.
 *
 * PK: SEASON#1, SK: META
 *
 * Run once:
 *   npx tsx scripts/seed-season.ts
 * Or via package.json:
 *   npm run db:seed-season
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";

const TABLE_NAME = process.env.DYNAMODB_TABLE_NAME ?? "bughunt-main";
const REGION = process.env.AWS_REGION ?? "us-east-1";

const client = new DynamoDBClient({ region: REGION });
const ddb = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

async function seedSeason(): Promise<void> {
  console.log(`\nSeeding Season 1 into table '${TABLE_NAME}' (${REGION})…\n`);

  const season = {
    pk: "SEASON#1",
    sk: "META",
    seasonId: "1",
    seasonNumber: 1,
    name: "Season 1",
    startDate: "2026-06-01",
    endDate: "2026-06-30",
    status: "active",
  };

  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: season,
    })
  );

  console.log("Season 1 written:");
  console.log(JSON.stringify(season, null, 2));
  console.log("\nDone.\n");
}

seedSeason().catch((err) => {
  console.error("Error seeding season:", err);
  process.exit(1);
});
