/**
 * BugHunt DynamoDB Table Setup Script
 *
 * Table: bughunt-main  (single-table design)
 *
 * Entity key patterns:
 * User:           pk=USER#<id>              sk=PROFILE
 * Game:           pk=GAME#<id>              sk=META
 * Game Player:    pk=GAME#<id>              sk=PLAYER#<userId>
 * Match Queue:    pk=MATCH#QUEUE#<range>    sk=<ts>#<userId>    gsi1pk=ACTIVE_GAME#<userId> gsi1sk=<gameId>
 * Bug:            pk=BUG#<id>               sk=META
 * Leaderboard:    pk=LEADERBOARD#GLOBAL     sk=RANK#<paddedElo>#<userId>
 * Match History:  pk=USER#<id>              sk=GAME#<ts>#<gameId>
 *
 * GSI1: gsi1pk=ACTIVE_GAME#<userId>  gsi1sk=<gameId>
 *       → check if a user currently has an active game in progress
 *
 * GSI2: gsi2pk=EMAIL#<email>         gsi2sk=<userId>
 *       → auth lookup: find a User record by email address
 */

import {
  DynamoDBClient,
  CreateTableCommand,
  DescribeTableCommand,
  UpdateTimeToLiveCommand,
  DescribeTimeToLiveCommand,
  ResourceInUseException,
  ResourceNotFoundException,
  type CreateTableCommandInput,
} from "@aws-sdk/client-dynamodb";

const TABLE_NAME = "bughunt-main";
const REGION = process.env.AWS_REGION ?? "us-east-1";
const TTL_ATTRIBUTE = "expiresAt";

const client = new DynamoDBClient({ region: REGION });

/** Returns true when the table exists (in any state), false when it does not. */
async function tableExists(): Promise<boolean> {
  try {
    await client.send(new DescribeTableCommand({ TableName: TABLE_NAME }));
    return true;
  } catch (err) {
    if (err instanceof ResourceNotFoundException) {
      return false;
    }
    throw err;
  }
}

/** Creates the bughunt-main table with GSI1, GSI2, and on-demand billing. */
async function createTable(): Promise<string> {
  const params: CreateTableCommandInput = {
    TableName: TABLE_NAME,
    BillingMode: "PAY_PER_REQUEST", // on-demand — no capacity planning needed

    // ── Primary key ────────────────────────────────────────────────────────
    KeySchema: [
      { AttributeName: "pk", KeyType: "HASH" },
      { AttributeName: "sk", KeyType: "RANGE" },
    ],

    // ── Attribute definitions (only indexed attributes go here) ───────────
    AttributeDefinitions: [
      { AttributeName: "pk",     AttributeType: "S" },
      { AttributeName: "sk",     AttributeType: "S" },
      // GSI1 — active-game lookup by userId
      { AttributeName: "gsi1pk", AttributeType: "S" },
      { AttributeName: "gsi1sk", AttributeType: "S" },
      // GSI2 — auth lookup by email
      { AttributeName: "gsi2pk", AttributeType: "S" },
      { AttributeName: "gsi2sk", AttributeType: "S" },
    ],

    GlobalSecondaryIndexes: [
      {
        // GSI1: used to check whether a user has an active game
        IndexName: "gsi1",
        KeySchema: [
          { AttributeName: "gsi1pk", KeyType: "HASH" },
          { AttributeName: "gsi1sk", KeyType: "RANGE" },
        ],
        Projection: { ProjectionType: "ALL" },
      },
      {
        // GSI2: used to look up a user record by email (auth flow)
        IndexName: "gsi2",
        KeySchema: [
          { AttributeName: "gsi2pk", KeyType: "HASH" },
          { AttributeName: "gsi2sk", KeyType: "RANGE" },
        ],
        Projection: { ProjectionType: "ALL" },
      },
    ],
  };

  try {
    const result = await client.send(new CreateTableCommand(params));
    const arn = result.TableDescription?.TableArn ?? "(ARN unavailable)";
    console.log(`Table created: ${arn}`);
    return arn;
  } catch (err) {
    if (err instanceof ResourceInUseException) {
      // Race condition: table was created between our exists-check and now.
      console.log(`Table '${TABLE_NAME}' already exists (caught ResourceInUseException).`);
      return await getTableArn();
    }
    throw err;
  }
}

/** Fetches the ARN of an already-existing table. */
async function getTableArn(): Promise<string> {
  const result = await client.send(new DescribeTableCommand({ TableName: TABLE_NAME }));
  return result.Table?.TableArn ?? "(ARN unavailable)";
}

/** Polls until the table reaches ACTIVE status (needed before TTL can be set). */
async function waitForActive(): Promise<void> {
  console.log("Waiting for table to become ACTIVE…");
  for (let attempt = 0; attempt < 30; attempt++) {
    const result = await client.send(new DescribeTableCommand({ TableName: TABLE_NAME }));
    const status = result.Table?.TableStatus;
    if (status === "ACTIVE") {
      console.log("Table is ACTIVE.");
      return;
    }
    console.log(`  Table status: ${status} — retrying in 2 s…`);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error("Timed out waiting for table to become ACTIVE.");
}

/** Enables TTL on the expiresAt attribute (idempotent). */
async function enableTTL(): Promise<void> {
  // Ensure the table is ACTIVE before attempting TTL operations
  await waitForActive();

  // Check current TTL status first to give a clear log message
  const current = await client.send(
    new DescribeTimeToLiveCommand({ TableName: TABLE_NAME })
  );
  const status = current.TimeToLiveDescription?.TimeToLiveStatus;

  if (status === "ENABLED" || status === "ENABLING") {
    console.log(`TTL already ${status.toLowerCase()} on attribute '${TTL_ATTRIBUTE}' — skipping.`);
    return;
  }

  await client.send(
    new UpdateTimeToLiveCommand({
      TableName: TABLE_NAME,
      TimeToLiveSpecification: {
        AttributeName: TTL_ATTRIBUTE,
        Enabled: true,
      },
    })
  );
  console.log(`TTL enabled on attribute '${TTL_ATTRIBUTE}'.`);
}

/** Main entry point. Safe to run multiple times. */
async function main(): Promise<void> {
  console.log(`\nSetting up DynamoDB table '${TABLE_NAME}' in ${REGION}…\n`);

  let tableArn: string;

  if (await tableExists()) {
    console.log(`Table '${TABLE_NAME}' already exists — skipping creation.`);
    tableArn = await getTableArn();
  } else {
    tableArn = await createTable();
  }

  // TTL setup is always attempted — it is idempotent
  await enableTTL();

  console.log(`\nDone.\nTable ARN: ${tableArn}\n`);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
