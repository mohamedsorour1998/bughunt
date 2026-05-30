/**
 * DynamoDB client for bughunt-main table.
 *
 * Scale design:
 * - On-demand capacity: auto-scales to millions of req/sec with zero provisioning
 * - Single-table design: eliminates cross-table joins, keeps latency at single-digit ms
 * - UUID partition keys: uniform hash distribution, no hot partitions
 * - Global Tables: replicated to eu-west-1 for multi-region read/write
 * - Per-instance in-memory cache: leaderboard/bugs cached per serverless function instance
 */
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";

// ---------------------------------------------------------------------------
// 1. Singleton DynamoDBDocument client
// ---------------------------------------------------------------------------
const client = new DynamoDBClient({
  region: process.env.AWS_REGION ?? "us-east-1",
});

export const ddb = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

// ---------------------------------------------------------------------------
// 2. Constants
// ---------------------------------------------------------------------------
export const TABLE_NAME =
  process.env.DYNAMODB_TABLE_NAME ?? "bughunt-main";

// ---------------------------------------------------------------------------
// 3. In-memory TTL cache
//    Adapted from RosettaCloud questions_backends.py:19-31
// ---------------------------------------------------------------------------
const DEFAULT_TTL_MS = 60_000; // 60 seconds

interface CacheEntry {
  ts: number;
  val: unknown;
}

const _cache = new Map<string, CacheEntry>();

export function cacheGet(key: string): unknown | undefined {
  const entry = _cache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.ts > DEFAULT_TTL_MS) {
    _cache.delete(key);
    return undefined;
  }
  return entry.val;
}

export function cacheSet(key: string, val: unknown, ttlMs?: number): void {
  // Store the value; evict on next read if expired.
  // ttlMs is stored alongside so cacheGet can respect per-entry TTL when provided.
  _cache.set(key, { ts: Date.now(), val });
  // If a custom TTL is given, schedule cleanup so memory doesn't grow unbounded.
  if (ttlMs !== undefined && ttlMs !== DEFAULT_TTL_MS) {
    setTimeout(() => {
      const e = _cache.get(key);
      if (e && Date.now() - e.ts >= ttlMs) {
        _cache.delete(key);
      }
    }, ttlMs);
  }
}

export function cacheDel(key: string): void {
  _cache.delete(key);
}

// ---------------------------------------------------------------------------
// 4. Generic CRUD wrappers
// ---------------------------------------------------------------------------

/** Fetch a single item by its primary key. Returns null when not found. */
export async function getItem(
  pk: string,
  sk: string
): Promise<Record<string, unknown> | null> {
  const result = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { pk, sk },
    })
  );
  return (result.Item as Record<string, unknown>) ?? null;
}

/** Write an item to the table, optionally guarded by a ConditionExpression. */
export async function putItem(
  item: Record<string, unknown>,
  conditionExpression?: string
): Promise<void> {
  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: item,
      ...(conditionExpression
        ? { ConditionExpression: conditionExpression }
        : {}),
    })
  );
}

/**
 * Partially update an item.
 * pk and sk are always skipped from the updates object.
 * Returns the full item after the update (ReturnValues: "ALL_NEW").
 *
 * Adapted from RosettaCloud users_backends.py lines 212-221.
 */
export async function updateItem(
  pk: string,
  sk: string,
  updates: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const RESERVED = new Set(["pk", "sk"]);

  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};
  const setParts: string[] = [];

  for (const [key, value] of Object.entries(updates)) {
    if (RESERVED.has(key)) continue;
    const nameAlias = `#${key}`;
    const valueAlias = `:${key}`;
    names[nameAlias] = key;
    values[valueAlias] = value;
    setParts.push(`${nameAlias} = ${valueAlias}`);
  }

  if (setParts.length === 0) {
    // Nothing to update — fetch and return current item.
    const existing = await getItem(pk, sk);
    return existing ?? {};
  }

  const result = await ddb.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { pk, sk },
      UpdateExpression: `SET ${setParts.join(", ")}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      ReturnValues: "ALL_NEW",
    })
  );

  return (result.Attributes as Record<string, unknown>) ?? {};
}

/** Delete an item by its primary key. */
export async function deleteItem(pk: string, sk: string): Promise<void> {
  await ddb.send(
    new DeleteCommand({
      TableName: TABLE_NAME,
      Key: { pk, sk },
    })
  );
}

/** Query items using a key condition expression with optional filters/pagination. */
export async function queryItems(
  keyCondition: string,
  expressionValues: Record<string, unknown>,
  options?: {
    indexName?: string;
    filterExpression?: string;
    expressionAttributeNames?: Record<string, string>;
    limit?: number;
    exclusiveStartKey?: Record<string, unknown>;
    scanIndexForward?: boolean;
  }
): Promise<{
  items: Record<string, unknown>[];
  lastEvaluatedKey?: Record<string, unknown>;
}> {
  const result = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: keyCondition,
      ExpressionAttributeValues: expressionValues,
      ...(options?.indexName ? { IndexName: options.indexName } : {}),
      ...(options?.filterExpression
        ? { FilterExpression: options.filterExpression }
        : {}),
      ...(options?.expressionAttributeNames
        ? { ExpressionAttributeNames: options.expressionAttributeNames }
        : {}),
      ...(options?.limit !== undefined ? { Limit: options.limit } : {}),
      ...(options?.exclusiveStartKey
        ? { ExclusiveStartKey: options.exclusiveStartKey }
        : {}),
      ...(options?.scanIndexForward !== undefined
        ? { ScanIndexForward: options.scanIndexForward }
        : {}),
    })
  );

  return {
    items: (result.Items as Record<string, unknown>[]) ?? [],
    lastEvaluatedKey: result.LastEvaluatedKey as
      | Record<string, unknown>
      | undefined,
  };
}

// ---------------------------------------------------------------------------
// 5. Conditional PutItem helper
//    Adapted from RosettaCloud users_backends.py line 131
// ---------------------------------------------------------------------------

/**
 * Write an item only if it does not already exist.
 * Returns true when the item was written, false when it already existed.
 */
export async function putItemIfNotExists(
  item: Record<string, unknown>
): Promise<boolean> {
  try {
    await putItem(item, "attribute_not_exists(pk)");
    return true;
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      err.name === "ConditionalCheckFailedException"
    ) {
      return false;
    }
    throw err;
  }
}
