/**
 * BugHunt — Seed Script
 *
 * Writes 50 hand-crafted bugs to DynamoDB and builds the BUG#INDEX item.
 * Idempotent: if the index already exists the script prints a message and
 * exits without re-writing the bugs.
 *
 * Run: npm run db:seed
 * Force re-seed: npx tsx scripts/seed-bugs.ts --force
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb"
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  BatchWriteCommand,
} from "@aws-sdk/lib-dynamodb"
import { v4 as uuidv4 } from "uuid"

// ---------------------------------------------------------------------------
// DynamoDB setup (standalone — not importing @/lib/dynamodb so this script
// works without the Next.js path-alias resolver)
// ---------------------------------------------------------------------------

const TABLE_NAME = process.env.DYNAMODB_TABLE_NAME ?? "bughunt-main"
const REGION = process.env.AWS_REGION ?? "us-east-1"

const client = new DynamoDBClient({ region: REGION })
const ddb = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
})

// ---------------------------------------------------------------------------
// Types (duplicated here to keep script self-contained)
// ---------------------------------------------------------------------------

type Difficulty = 1 | 2 | 3 | 4 | 5
type CorrectAnswer = 0 | 1 | 2 | 3

interface BugDef {
  bugId: string
  language: string
  category: string
  difficulty: Difficulty
  buggyCode: string
  correctCode: string
  bugLine: number
  options: [string, string, string, string]
  correctAnswer: CorrectAnswer
  explanation: string
  hint: string
  source: string
  status: "active" | "pending_review"
  timesServed: number
  createdAt: number
}

// ---------------------------------------------------------------------------
// Bug definitions — 50 bugs across multiple languages
// =========================================================================
// ORIGINAL 20 bugs (IDs 1–20) + 30 new bugs (IDs 21–50)
// ---------------------------------------------------------------------------

const bugs: BugDef[] = [
  // =========================================================================
  // PYTHON × 5  (original, IDs 1–5)
  // =========================================================================

  // 1. Python — off-by-one
  {
    bugId: uuidv4(),
    language: "python",
    category: "off-by-one",
    difficulty: 2,
    buggyCode: `def find_last(items, target):
    for i in range(len(items)):
        if items[i] == target:
            last = i
    return last`,
    correctCode: `def find_last(items, target):
    last = -1
    for i in range(len(items)):
        if items[i] == target:
            last = i
    return last`,
    bugLine: 2,
    options: [
      "The loop uses range(len(items)) instead of range(len(items) - 1)",
      "The variable 'last' is referenced before assignment when 'target' is not found",
      "The loop iterates in the wrong direction",
      "The function should return None instead of an index",
    ],
    correctAnswer: 1,
    explanation:
      "If 'target' never appears in 'items', the name 'last' is never assigned, so the bare 'return last' raises UnboundLocalError. The fix is to initialise last = -1 (or None) before the loop.",
    hint: "What happens when the target value does not exist in the list?",
    source: "manual",
    status: "active",
    timesServed: 0,
    createdAt: Date.now(),
  },

  // 2. Python — mutable default argument
  {
    bugId: uuidv4(),
    language: "python",
    category: "mutable default arg",
    difficulty: 3,
    buggyCode: `def append_item(value, collection=[]):
    collection.append(value)
    return collection

result1 = append_item(1)
result2 = append_item(2)`,
    correctCode: `def append_item(value, collection=None):
    if collection is None:
        collection = []
    collection.append(value)
    return collection`,
    bugLine: 1,
    options: [
      "The function modifies its parameter in place instead of returning a copy",
      "The default argument '[]' is created once and shared across all calls",
      "Python lists cannot be used as function default arguments",
      "The 'append' method is not available on list default arguments",
    ],
    correctAnswer: 1,
    explanation:
      "In Python, default argument values are evaluated once when the function is defined, not on each call. Because a list is mutable, all calls that omit 'collection' share the same list object, so result2 is [1, 2] instead of [2]. The fix is to use None as the sentinel and create a fresh list inside the function.",
    hint: "Default argument values are evaluated at function definition time, not at call time.",
    source: "manual",
    status: "active",
    timesServed: 0,
    createdAt: Date.now(),
  },

  // 3. Python — wrong comparison (is vs ==)
  {
    bugId: uuidv4(),
    language: "python",
    category: "wrong comparison",
    difficulty: 2,
    buggyCode: `def is_admin(user):
    role = user.get("role")
    if role is "admin":
        return True
    return False`,
    correctCode: `def is_admin(user):
    role = user.get("role")
    if role == "admin":
        return True
    return False`,
    bugLine: 3,
    options: [
      "user.get() should be user['role'] to raise an error if key is missing",
      "'is' compares object identity, not value equality; two 'admin' strings may not be the same object",
      "The function should raise ValueError for non-admin roles instead of returning False",
      "String comparisons in Python must use .equals() not comparison operators",
    ],
    correctAnswer: 1,
    explanation:
      "The 'is' operator tests object identity (same memory address), not value equality. Due to Python's string interning, 'role is \"admin\"' sometimes works in a REPL, but it is unreliable across function boundaries and across Python implementations. Use '==' for value comparison.",
    hint: "'is' and '==' are different operators in Python.",
    source: "manual",
    status: "active",
    timesServed: 0,
    createdAt: Date.now(),
  },

  // 4. Python — async error (missing await)
  {
    bugId: uuidv4(),
    language: "python",
    category: "async error",
    difficulty: 3,
    buggyCode: `import asyncio

async def fetch_data(url):
    await asyncio.sleep(0.1)
    return {"url": url, "data": "..."}

async def process():
    result = fetch_data("https://example.com")
    print(result["data"])`,
    correctCode: `import asyncio

async def fetch_data(url):
    await asyncio.sleep(0.1)
    return {"url": url, "data": "..."}

async def process():
    result = await fetch_data("https://example.com")
    print(result["data"])`,
    bugLine: 8,
    options: [
      "asyncio.sleep should use time.sleep for blocking I/O",
      "fetch_data is called without 'await', so 'result' is a coroutine object, not the returned dict",
      "async functions cannot return dictionaries",
      "The 'process' function is missing a return statement",
    ],
    correctAnswer: 1,
    explanation:
      "Calling an async function without 'await' returns a coroutine object, not the function's return value. Accessing result[\"data\"] on a coroutine raises TypeError. Adding 'await' before the call suspends process() until fetch_data completes and assigns the actual dict to result.",
    hint: "What does calling an async function without await actually return?",
    source: "manual",
    status: "active",
    timesServed: 0,
    createdAt: Date.now(),
  },

  // 5. Python — scope issue (nonlocal)
  {
    bugId: uuidv4(),
    language: "python",
    category: "scope issue",
    difficulty: 3,
    buggyCode: `def make_counter():
    count = 0
    def increment():
        count += 1
        return count
    return increment

counter = make_counter()
print(counter())`,
    correctCode: `def make_counter():
    count = 0
    def increment():
        nonlocal count
        count += 1
        return count
    return increment`,
    bugLine: 4,
    options: [
      "Closures in Python cannot modify variables from an enclosing scope without 'nonlocal'",
      "The counter variable is garbage-collected before increment() runs",
      "Augmented assignment (+=) is not allowed inside nested functions",
      "The increment function should take count as a parameter instead of using closure",
    ],
    correctAnswer: 0,
    explanation:
      "When Python sees 'count += 1' inside increment(), it treats 'count' as a local variable (because it is assigned). Reading it before the assignment raises UnboundLocalError. Declaring 'nonlocal count' tells the interpreter to use the binding from the enclosing make_counter() scope.",
    hint: "How does Python decide whether a variable in a function is local or from an enclosing scope?",
    source: "manual",
    status: "active",
    timesServed: 0,
    createdAt: Date.now(),
  },

  // =========================================================================
  // JAVASCRIPT × 5  (original, IDs 6–10)
  // =========================================================================

  // 6. JavaScript — type coercion
  {
    bugId: uuidv4(),
    language: "javascript",
    category: "type coercion",
    difficulty: 2,
    buggyCode: `function sumArray(arr) {
  let total = 0;
  for (const item of arr) {
    total = total + item;
  }
  return total;
}

console.log(sumArray([1, 2, "3"]));`,
    correctCode: `function sumArray(arr) {
  let total = 0;
  for (const item of arr) {
    total = total + Number(item);
  }
  return total;
}`,
    bugLine: 4,
    options: [
      "The for...of loop does not work with arrays in JavaScript",
      "When 'item' is the string '\"3\"', the + operator concatenates instead of adding, yielding '\"33\"'",
      "Initialising 'total' to 0 instead of 0.0 causes integer overflow",
      "The function should use Array.prototype.reduce instead of a for loop",
    ],
    correctAnswer: 1,
    explanation:
      "JavaScript's + operator is overloaded: when either operand is a string it performs concatenation. After summing 1+2 the total is 3 (number), then 3 + \"3\" produces \"33\" (string). Wrapping each item in Number() ensures numeric addition.",
    hint: "What does JavaScript's + operator do when one operand is a string?",
    source: "manual",
    status: "active",
    timesServed: 0,
    createdAt: Date.now(),
  },

  // 7. JavaScript — closure in loop
  {
    bugId: uuidv4(),
    language: "javascript",
    category: "closure in loop",
    difficulty: 3,
    buggyCode: `const fns = [];
for (var i = 0; i < 3; i++) {
  fns.push(function() { return i; });
}
console.log(fns[0](), fns[1](), fns[2]());`,
    correctCode: `const fns = [];
for (let i = 0; i < 3; i++) {
  fns.push(function() { return i; });
}
console.log(fns[0](), fns[1](), fns[2]());`,
    bugLine: 2,
    options: [
      "Arrow functions should be used instead of function expressions inside loops",
      "var declares a single function-scoped variable; all closures share the same 'i', which is 3 after the loop",
      "fns.push() copies the current value of i, not a reference to it",
      "The loop condition should be i <= 3 to capture all indices",
    ],
    correctAnswer: 1,
    explanation:
      "With 'var', there is only one 'i' variable in the function scope. All three closures close over the same binding. After the loop finishes i is 3, so fns[0](), fns[1]() and fns[2]() all return 3. Changing 'var' to 'let' creates a fresh binding per loop iteration, so each closure captures its own value.",
    hint: "How do var and let differ in terms of scoping inside a for loop?",
    source: "manual",
    status: "active",
    timesServed: 0,
    createdAt: Date.now(),
  },

  // 8. JavaScript — == vs ===
  {
    bugId: uuidv4(),
    language: "javascript",
    category: "loose equality",
    difficulty: 2,
    buggyCode: `function isZero(value) {
  return value == 0;
}

console.log(isZero(""));
console.log(isZero(false));
console.log(isZero(null));`,
    correctCode: `function isZero(value) {
  return value === 0;
}`,
    bugLine: 2,
    options: [
      "The function should use typeof to check for numeric zero",
      "Loose equality (==) coerces '', false and null to 0, so non-zero values incorrectly return true",
      "JavaScript's == operator always converts both sides to strings before comparing",
      "The function needs an explicit Number() cast before comparing",
    ],
    correctAnswer: 1,
    explanation:
      "Loose equality (==) performs type coercion. In JavaScript: \"\" == 0 → true, false == 0 → true, null == 0 → false (but null == undefined → true). This means isZero(\"\") and isZero(false) both return true, which is almost certainly wrong. Strict equality (===) never coerces types.",
    hint: "What values does JavaScript consider equal to 0 when using ==?",
    source: "manual",
    status: "active",
    timesServed: 0,
    createdAt: Date.now(),
  },

  // 9. JavaScript — async/await mistake (missing error handling in Promise.all)
  {
    bugId: uuidv4(),
    language: "javascript",
    category: "async/await mistake",
    difficulty: 4,
    buggyCode: `async function loadUserData(userIds) {
  const results = await Promise.all(
    userIds.map(id => fetchUser(id))
  );
  return results.filter(Boolean);
}`,
    correctCode: `async function loadUserData(userIds) {
  const results = await Promise.allSettled(
    userIds.map(id => fetchUser(id))
  );
  return results
    .filter(r => r.status === "fulfilled")
    .map(r => r.value);
}`,
    bugLine: 2,
    options: [
      "Promise.all does not accept an array of promises",
      "If any single fetchUser() call rejects, Promise.all rejects immediately and the other results are lost",
      "The filter(Boolean) call removes valid user objects that are falsy",
      "async/await cannot be used with array.map()",
    ],
    correctAnswer: 1,
    explanation:
      "Promise.all has fail-fast semantics: if any promise rejects, the whole Promise.all rejects immediately, discarding the successfully fetched users. For partial-failure tolerance, Promise.allSettled waits for all promises regardless of outcome, then you filter for fulfilled ones.",
    hint: "What does Promise.all do when one of its promises rejects?",
    source: "manual",
    status: "active",
    timesServed: 0,
    createdAt: Date.now(),
  },

  // 10. JavaScript — prototype mutation
  {
    bugId: uuidv4(),
    language: "javascript",
    category: "prototype mutation",
    difficulty: 4,
    buggyCode: `Array.prototype.last = function() {
  return this[this.length - 1];
};

const nums = [1, 2, 3];
for (const key in nums) {
  console.log(key);
}`,
    correctCode: `function last(arr) {
  return arr[arr.length - 1];
}

const nums = [1, 2, 3];
for (const key in nums) {
  console.log(key);
}`,
    bugLine: 1,
    options: [
      "The 'last' method name conflicts with a built-in Array method",
      "Adding 'last' to Array.prototype makes it enumerable, so for...in loops over arrays yield '\"last\"' as an extra key",
      "Prototype methods cannot use 'this' to reference the array",
      "for...in should not be used with arrays; use for...of instead",
    ],
    correctAnswer: 1,
    explanation:
      "Adding a property to Array.prototype with plain assignment makes it enumerable. for...in iterates all enumerable properties, including inherited ones — so the loop yields '0', '1', '2', and unexpectedly '\"last\"'. The fix is to either use Object.defineProperty with enumerable: false, or avoid mutating built-in prototypes entirely.",
    hint: "What is the difference between own and inherited enumerable properties in a for...in loop?",
    source: "manual",
    status: "active",
    timesServed: 0,
    createdAt: Date.now(),
  },

  // =========================================================================
  // TYPESCRIPT × 4  (original, IDs 11–14)
  // =========================================================================

  // 11. TypeScript — unsafe type assertion
  {
    bugId: uuidv4(),
    language: "typescript",
    category: "type assertion",
    difficulty: 3,
    buggyCode: `interface User {
  id: number;
  name: string;
}

async function getUser(id: number): Promise<User> {
  const response = await fetch(\`/api/users/\${id}\`);
  const data = await response.json();
  return data as User;
}`,
    correctCode: `interface User {
  id: number;
  name: string;
}

function isUser(obj: unknown): obj is User {
  return (
    typeof obj === "object" &&
    obj !== null &&
    typeof (obj as Record<string, unknown>).id === "number" &&
    typeof (obj as Record<string, unknown>).name === "string"
  );
}

async function getUser(id: number): Promise<User> {
  const response = await fetch(\`/api/users/\${id}\`);
  const data: unknown = await response.json();
  if (!isUser(data)) throw new Error("Invalid user shape");
  return data;
}`,
    bugLine: 9,
    options: [
      "The fetch API is not available in TypeScript without a polyfill",
      "'as User' is a compile-time assertion that is erased at runtime; if the API returns unexpected data, runtime errors will occur silently",
      "response.json() returns a Promise and must be awaited a second time",
      "TypeScript interfaces cannot be used as return types for async functions",
    ],
    correctAnswer: 1,
    explanation:
      "'as User' tells the TypeScript compiler to treat 'data' as a User, but TypeScript types are erased at runtime. If the API response is missing 'name' or 'id', no error is thrown — you'll just get undefined where you expect a value, causing silent downstream bugs. A runtime type guard is needed to validate the shape.",
    hint: "TypeScript's type system exists only at compile time. What happens to type assertions at runtime?",
    source: "manual",
    status: "active",
    timesServed: 0,
    createdAt: Date.now(),
  },

  // 12. TypeScript — optional chaining short-circuit
  {
    bugId: uuidv4(),
    language: "typescript",
    category: "optional chaining",
    difficulty: 2,
    buggyCode: `interface Config {
  database?: {
    host: string;
    port: number;
  };
}

function getPort(config: Config): number {
  return config.database?.port || 5432;
}`,
    correctCode: `function getPort(config: Config): number {
  return config.database?.port ?? 5432;
}`,
    bugLine: 9,
    options: [
      "Optional chaining (?.) throws if 'database' is undefined",
      "The || operator uses falsy coercion, so a real port value of 0 would be replaced by 5432",
      "The return type should be number | undefined when using optional chaining",
      "config.database.port must be accessed with a non-null assertion (!.)",
    ],
    correctAnswer: 1,
    explanation:
      "The logical OR operator (||) returns the right side when the left side is falsy. Port 0 is a valid port number but is falsy, so config.database?.port || 5432 returns 5432 instead of 0. The nullish coalescing operator (??) only falls back when the left side is null or undefined, making it the correct choice here.",
    hint: "What is the difference between || and ?? when the left-hand value is 0?",
    source: "manual",
    status: "active",
    timesServed: 0,
    createdAt: Date.now(),
  },

  // 13. TypeScript — generic constraint missing
  {
    bugId: uuidv4(),
    language: "typescript",
    category: "generic constraint",
    difficulty: 4,
    buggyCode: `function getProperty<T, K>(obj: T, key: K) {
  return obj[key];
}

const user = { id: 1, name: "Alice" };
const name = getProperty(user, "name");`,
    correctCode: `function getProperty<T, K extends keyof T>(obj: T, key: K): T[K] {
  return obj[key];
}`,
    bugLine: 1,
    options: [
      "Generic functions cannot accept two type parameters",
      "K is unconstrained so obj[key] is a type error; K must extend keyof T to guarantee the key exists on obj",
      "The return type is inferred as any because T is not constrained to object",
      "keyof T only works with interface types, not plain object literals",
    ],
    correctAnswer: 1,
    explanation:
      "Without the constraint K extends keyof T, TypeScript cannot verify that 'key' is actually a property of 'obj', so obj[key] produces a type error. Adding 'K extends keyof T' makes the constraint explicit, and the return type T[K] gives precise type inference — e.g. getProperty(user, 'name') returns string.",
    hint: "How do you tell TypeScript that a generic type parameter must be a valid key of another type?",
    source: "manual",
    status: "active",
    timesServed: 0,
    createdAt: Date.now(),
  },

  // 14. TypeScript — enum misuse (string enum vs numeric)
  {
    bugId: uuidv4(),
    language: "typescript",
    category: "enum misuse",
    difficulty: 3,
    buggyCode: `enum Status {
  Active,
  Inactive,
  Pending,
}

function saveStatus(status: Status) {
  fetch("/api/status", {
    method: "POST",
    body: JSON.stringify({ status }),
  });
}

saveStatus(Status.Active);`,
    correctCode: `enum Status {
  Active = "active",
  Inactive = "inactive",
  Pending = "pending",
}`,
    bugLine: 2,
    options: [
      "Numeric enums cannot be passed to JSON.stringify",
      "Without explicit string values, TypeScript numeric enums serialize as integers (0, 1, 2), sending {status: 0} to the API instead of a meaningful string",
      "The enum must be declared const to be used inside a function",
      "fetch() cannot serialize enum values; they must be cast to string first",
    ],
    correctAnswer: 1,
    explanation:
      "TypeScript numeric enums auto-assign integer values starting at 0. Status.Active is 0, Status.Inactive is 1, etc. JSON.stringify({ status: Status.Active }) produces '{\"status\":0}', not '{\"status\":\"active\"}'. If the API expects a string discriminator, use a string enum with explicit values.",
    hint: "What numeric value does TypeScript assign to the first member of an enum with no explicit values?",
    source: "manual",
    status: "active",
    timesServed: 0,
    createdAt: Date.now(),
  },

  // =========================================================================
  // SQL × 3  (original, IDs 15–17)
  // =========================================================================

  // 15. SQL — off-by-one in LIMIT / OFFSET pagination
  {
    bugId: uuidv4(),
    language: "sql",
    category: "off-by-one in LIMIT",
    difficulty: 2,
    buggyCode: `-- Fetch page 1 (items 1-10), page 2 (items 11-20), etc.
SELECT id, name, score
FROM leaderboard
ORDER BY score DESC
LIMIT 10 OFFSET page * 10;`,
    correctCode: `SELECT id, name, score
FROM leaderboard
ORDER BY score DESC
LIMIT 10 OFFSET (page - 1) * 10;`,
    bugLine: 5,
    options: [
      "OFFSET must always be a literal integer, not an expression",
      "Using 'page * 10' skips the first 10 rows on page 1 (OFFSET 10); the correct expression is (page - 1) * 10",
      "LIMIT 10 should be LIMIT 10 ROWS ONLY for ANSI SQL compliance",
      "ORDER BY must come after LIMIT in standard SQL",
    ],
    correctAnswer: 1,
    explanation:
      "When page=1 (the first page), 'page * 10' evaluates to OFFSET 10, which skips the first 10 rows and returns rows 11-20. Page 1 should use OFFSET 0, which means the formula must be '(page - 1) * 10'.",
    hint: "What OFFSET value should the first page of results use?",
    source: "manual",
    status: "active",
    timesServed: 0,
    createdAt: Date.now(),
  },

  // 16. SQL — NULL comparison
  {
    bugId: uuidv4(),
    language: "sql",
    category: "NULL comparison",
    difficulty: 2,
    buggyCode: `SELECT id, name
FROM users
WHERE deleted_at = NULL;`,
    correctCode: `SELECT id, name
FROM users
WHERE deleted_at IS NULL;`,
    bugLine: 3,
    options: [
      "NULL is a reserved keyword and cannot appear in WHERE clauses",
      "'= NULL' always evaluates to UNKNOWN in SQL, so no rows are ever returned; use 'IS NULL' instead",
      "deleted_at must be cast to TEXT before comparing with NULL",
      "NULL comparisons require the COALESCE function",
    ],
    correctAnswer: 1,
    explanation:
      "In SQL, NULL represents an unknown value. Any comparison involving NULL (including = NULL, != NULL, > NULL) evaluates to UNKNOWN, not TRUE or FALSE. The WHERE clause only passes rows where the condition is TRUE, so 'WHERE deleted_at = NULL' returns zero rows. The correct syntax is 'WHERE deleted_at IS NULL'.",
    hint: "What does any comparison expression return when one side is NULL in SQL?",
    source: "manual",
    status: "active",
    timesServed: 0,
    createdAt: Date.now(),
  },

  // 17. SQL — wrong JOIN type
  {
    bugId: uuidv4(),
    language: "sql",
    category: "wrong JOIN type",
    difficulty: 3,
    buggyCode: `-- Find all customers and their order totals (including customers with no orders)
SELECT c.id, c.name, SUM(o.amount) AS total
FROM customers c
INNER JOIN orders o ON c.id = o.customer_id
GROUP BY c.id, c.name;`,
    correctCode: `SELECT c.id, c.name, COALESCE(SUM(o.amount), 0) AS total
FROM customers c
LEFT JOIN orders o ON c.id = o.customer_id
GROUP BY c.id, c.name;`,
    bugLine: 4,
    options: [
      "SUM() cannot be used with INNER JOIN",
      "INNER JOIN excludes customers who have no matching rows in orders; LEFT JOIN is needed to keep all customers",
      "GROUP BY must list all non-aggregate columns, but c.name is optional here",
      "The ON clause should use '=' with COALESCE to handle NULLs",
    ],
    correctAnswer: 1,
    explanation:
      "INNER JOIN only returns rows where a match exists in both tables. Customers with no orders have no matching row in the orders table and are silently dropped from the result. LEFT JOIN keeps all rows from the left (customers) table and fills order columns with NULL, so every customer appears — even those with no orders.",
    hint: "Which type of JOIN preserves all rows from the left table even when there is no matching row on the right?",
    source: "manual",
    status: "active",
    timesServed: 0,
    createdAt: Date.now(),
  },

  // =========================================================================
  // GO × 3  (original, IDs 18–20)
  // =========================================================================

  // 18. Go — nil pointer dereference
  {
    bugId: uuidv4(),
    language: "go",
    category: "nil pointer",
    difficulty: 3,
    buggyCode: `type Node struct {
    Value int
    Next  *Node
}

func sumList(head *Node) int {
    total := 0
    for head.Next != nil {
        total += head.Value
        head = head.Next
    }
    return total
}`,
    correctCode: `func sumList(head *Node) int {
    total := 0
    for head != nil {
        total += head.Value
        head = head.Next
    }
    return total
}`,
    bugLine: 7,
    options: [
      "The loop should use a counter variable instead of pointer comparison",
      "The loop condition 'head.Next != nil' dereferences 'head' without checking if head itself is nil, causing a panic on an empty list or at the last node",
      "Go does not support linked lists with pointer fields",
      "total should be declared outside the function to avoid stack overflow",
    ],
    correctAnswer: 1,
    explanation:
      "The condition 'head.Next != nil' dereferences 'head' first. If head is nil (empty list), this immediately panics with a nil pointer dereference. Even for a valid list, the last node's value is never added because the loop exits when head.Next is nil, skipping the last node. The fix is to check 'head != nil' and process inside the loop.",
    hint: "What happens when you access a field on a nil pointer in Go?",
    source: "manual",
    status: "active",
    timesServed: 0,
    createdAt: Date.now(),
  },

  // 19. Go — goroutine leak
  {
    bugId: uuidv4(),
    language: "go",
    category: "goroutine leak",
    difficulty: 4,
    buggyCode: `func fetchWithTimeout(url string, timeout time.Duration) ([]byte, error) {
    ch := make(chan []byte)
    go func() {
        data, _ := http.Get(url)
        body, _ := io.ReadAll(data.Body)
        ch <- body
    }()
    select {
    case data := <-ch:
        return data, nil
    case <-time.After(timeout):
        return nil, errors.New("timeout")
    }
}`,
    correctCode: `func fetchWithTimeout(url string, timeout time.Duration) ([]byte, error) {
    ch := make(chan []byte, 1)
    go func() {
        resp, _ := http.Get(url)
        body, _ := io.ReadAll(resp.Body)
        ch <- body
    }()
    select {
    case data := <-ch:
        return data, nil
    case <-time.After(timeout):
        return nil, errors.New("timeout")
    }
}`,
    bugLine: 2,
    options: [
      "http.Get does not work inside goroutines",
      "The unbuffered channel means the goroutine blocks forever on 'ch <- body' after a timeout, leaking the goroutine",
      "select statements cannot have a default case with time.After",
      "io.ReadAll must be called before the goroutine is launched",
    ],
    correctAnswer: 1,
    explanation:
      "When the timeout fires, the function returns. The goroutine, however, is still running and eventually tries to send on ch — an unbuffered channel with no receiver. The send blocks forever, leaking the goroutine. Making the channel buffered (make(chan []byte, 1)) lets the goroutine send without a receiver, after which it exits cleanly.",
    hint: "What happens to a goroutine that tries to send on an unbuffered channel when there is no longer a receiver?",
    source: "manual",
    status: "active",
    timesServed: 0,
    createdAt: Date.now(),
  },

  // 20. Go — integer overflow
  {
    bugId: uuidv4(),
    language: "go",
    category: "integer overflow",
    difficulty: 4,
    buggyCode: `func daysToSeconds(days int32) int32 {
    return days * 24 * 60 * 60
}

result := daysToSeconds(30)
fmt.Println(result)`,
    correctCode: `func daysToSeconds(days int64) int64 {
    return days * 24 * 60 * 60
}`,
    bugLine: 2,
    options: [
      "Go does not allow constant expressions in return statements",
      "Multiplying 30 days by 86400 produces 2,592,000 — well within int32 range — but larger values (e.g. 25 days × 86400 × large multiplier) silently wrap around due to int32 overflow",
      "int32 multiplication in Go requires explicit casting with int32()",
      "The function should return a float64 to avoid precision loss",
    ],
    correctAnswer: 1,
    explanation:
      "int32 has a maximum value of 2,147,483,647. daysToSeconds(days) = days × 86400, which overflows int32 when days > 24,855 (~68 years). Year-scale inputs (e.g. 365 × years) can easily reach that threshold. Using int64 (max ~9.2 × 10^18) avoids the overflow for any realistic input.",
    hint: "What is the maximum value of int32, and how many seconds are in 25+ days?",
    source: "manual",
    status: "active",
    timesServed: 0,
    createdAt: Date.now(),
  },

  // =========================================================================
  // NEW BUGS — 30 more (IDs 21–50)
  // =========================================================================

  // -----------------------------------------------------------------------
  // BASH × 7  (IDs 21–27)
  // -----------------------------------------------------------------------

  // 21. Bash — unquoted variable with spaces
  {
    bugId: uuidv4(),
    language: "bash",
    category: "quoting",
    difficulty: 2,
    buggyCode: `#!/bin/bash
FILE="my document.txt"
if [ -f $FILE ]; then
    echo "File exists"
fi`,
    correctCode: `#!/bin/bash
FILE="my document.txt"
if [ -f "$FILE" ]; then
    echo "File exists"
fi`,
    bugLine: 3,
    options: [
      "The -f flag is for directories, not files",
      "Unquoted $FILE splits on whitespace; [ -f my document.txt ] is parsed as [ -f my ] with extra tokens, causing a syntax error",
      "FILE should be declared with declare -r to prevent word splitting",
      "[ ] must be replaced with [[ ]] when using variables",
    ],
    correctAnswer: 1,
    explanation:
      "Without quotes, bash performs word splitting on $FILE. 'my document.txt' splits into two tokens: 'my' and 'document.txt'. The test command [ -f my document.txt ] receives unexpected arguments and fails with 'too many arguments'. Always quote variable expansions: \"$FILE\".",
    hint: "What happens to a variable containing spaces when it is not quoted in bash?",
    source: "manual",
    status: "active",
    timesServed: 0,
    createdAt: Date.now(),
  },

  // 22. Bash — arithmetic with let vs $(( ))
  {
    bugId: uuidv4(),
    language: "bash",
    category: "arithmetic",
    difficulty: 3,
    buggyCode: `#!/bin/bash
x=5
y=3
result=$x-$y
echo $result`,
    correctCode: `#!/bin/bash
x=5
y=3
result=$((x - y))
echo $result`,
    bugLine: 4,
    options: [
      "Bash variables cannot hold numeric values",
      "result=$x-$y performs string concatenation, producing '5-3' not 2; arithmetic requires $(( ))",
      "The echo statement needs -n to suppress the trailing newline",
      "x and y must be declared with declare -i for integer arithmetic",
    ],
    correctAnswer: 1,
    explanation:
      "In bash, variable assignment is always string concatenation unless you use arithmetic expansion. $x-$y simply concatenates the values and the literal '-', producing the string '5-3'. Use $((x - y)) (or let result=x-y) to perform integer arithmetic.",
    hint: "How does bash interpret $x-$y in a variable assignment?",
    source: "manual",
    status: "active",
    timesServed: 0,
    createdAt: Date.now(),
  },

  // 23. Bash — test command string vs integer
  {
    bugId: uuidv4(),
    language: "bash",
    category: "test command",
    difficulty: 3,
    buggyCode: `#!/bin/bash
count=10
if [ $count > 5 ]; then
    echo "Greater"
fi`,
    correctCode: `#!/bin/bash
count=10
if [ $count -gt 5 ]; then
    echo "Greater"
fi`,
    bugLine: 3,
    options: [
      "The variable $count must be quoted inside [ ]",
      "Inside [ ], the > operator is I/O redirection, not numeric comparison; use -gt for integers",
      "Integers must be compared with (( )) not [ ]",
      "The if statement is missing a semicolon before then",
    ],
    correctAnswer: 1,
    explanation:
      "Inside [ ], the > operator is treated as output redirection (it creates a file named '5'). The test effectively becomes [ $count ] which is true for any non-empty string. The correct numeric comparison operators are -gt, -lt, -ge, -le, -eq, -ne. Use (( count > 5 )) for C-style arithmetic comparisons.",
    hint: "What does > mean inside single-bracket [ ] in bash?",
    source: "manual",
    status: "active",
    timesServed: 0,
    createdAt: Date.now(),
  },

  // 24. Bash — pipe subshell variable scope
  {
    bugId: uuidv4(),
    language: "bash",
    category: "subshell scope",
    difficulty: 4,
    buggyCode: `#!/bin/bash
count=0
cat file.txt | while read line; do
    count=$((count + 1))
done
echo "Lines: $count"`,
    correctCode: `#!/bin/bash
count=0
while read line; do
    count=$((count + 1))
done < file.txt
echo "Lines: $count"`,
    bugLine: 3,
    options: [
      "while read without IFS= will strip leading whitespace from lines",
      "The pipe creates a subshell for the while loop; modifications to $count inside the loop are invisible to the parent shell",
      "cat file.txt | while is slower than < redirection but produces the same result",
      "count=$((count + 1)) requires spaces around the variable name",
    ],
    correctAnswer: 1,
    explanation:
      "Each component of a pipeline (in bash) runs in a subshell. The while loop modifying $count operates on a copy of the variable; when the subshell exits the change is lost. The parent shell's $count remains 0. Redirecting stdin with < file.txt keeps the while loop in the current shell, so the count update is visible.",
    hint: "Does the right side of a pipe in bash run in the same shell process as the parent?",
    source: "manual",
    status: "active",
    timesServed: 0,
    createdAt: Date.now(),
  },

  // 25. Bash — glob expansion in array
  {
    bugId: uuidv4(),
    language: "bash",
    category: "glob expansion",
    difficulty: 3,
    buggyCode: `#!/bin/bash
files="*.log"
for f in $files; do
    rm "$f"
done`,
    correctCode: `#!/bin/bash
for f in *.log; do
    rm "$f"
done`,
    bugLine: 2,
    options: [
      "rm requires the -f flag to delete files",
      "Storing a glob pattern in a quoted variable prevents expansion; the literal string '*.log' is used rather than matching files",
      "The for loop must use $(ls *.log) to expand glob patterns",
      "Variables holding filenames should always be declared with declare -a",
    ],
    correctAnswer: 1,
    explanation:
      "When a glob like *.log is assigned to a variable with quotes, it is stored as the literal string '*.log'. When that variable is expanded unquoted in the for loop ($files), bash checks for files matching '*.log' — which may work, but if no files match, the literal string is passed to rm, causing an error. The idiomatic and safe approach is to use the glob directly in the for statement.",
    hint: "Does assigning '*.log' to a variable and then expanding it behave the same as using the glob directly?",
    source: "manual",
    status: "active",
    timesServed: 0,
    createdAt: Date.now(),
  },

  // 26. Bash — script exit on first error
  {
    bugId: uuidv4(),
    language: "bash",
    category: "error handling",
    difficulty: 3,
    buggyCode: `#!/bin/bash
cd /tmp/work_dir
rm -rf important_data/
echo "Cleanup done"`,
    correctCode: `#!/bin/bash
set -euo pipefail
cd /tmp/work_dir
rm -rf important_data/
echo "Cleanup done"`,
    bugLine: 2,
    options: [
      "rm -rf should always use the --preserve-root flag",
      "If 'cd /tmp/work_dir' fails (directory doesn't exist), the script continues and 'rm -rf important_data/' runs in the current directory",
      "echo should be replaced with printf for POSIX compliance",
      "The script needs a trap to handle SIGINT",
    ],
    correctAnswer: 1,
    explanation:
      "Without 'set -e', a failed command does not stop the script. If /tmp/work_dir does not exist, cd fails but the script continues. Then 'rm -rf important_data/' runs in whatever directory the script started in — potentially deleting data you didn't intend to touch. 'set -euo pipefail' makes the script abort on any error, unset variable, or pipe failure.",
    hint: "What happens in a bash script when a command fails but 'set -e' is not set?",
    source: "manual",
    status: "active",
    timesServed: 0,
    createdAt: Date.now(),
  },

  // 27. Bash — command substitution trailing newline
  {
    bugId: uuidv4(),
    language: "bash",
    category: "command substitution",
    difficulty: 2,
    buggyCode: `#!/bin/bash
content=$(cat config.txt)
if [ "$content" = "" ]; then
    echo "Config is empty"
fi`,
    correctCode: `#!/bin/bash
content=$(cat config.txt)
if [ -z "$content" ]; then
    echo "Config is empty"
fi`,
    bugLine: 3,
    options: [
      "cat config.txt should be replaced with < config.txt for efficiency",
      "Command substitution $() strips trailing newlines, so a file containing only newlines tests as empty; -z is the correct empty-string test",
      "The [ ] condition must use == instead of = for string comparison",
      "The variable $content should be unquoted when comparing to an empty string",
    ],
    correctAnswer: 1,
    explanation:
      "Command substitution $() automatically strips all trailing newlines from the output. A file containing only whitespace or newlines will produce an empty string in $content. Comparing with = \"\" works, but the canonical and most readable test for an empty string in bash is -z. More importantly, a file with content but a trailing newline is NOT empty — the comparison with \"\" is correct for that case too, but -z makes intent clearer.",
    hint: "What does $() do to trailing newlines in command output?",
    source: "manual",
    status: "active",
    timesServed: 0,
    createdAt: Date.now(),
  },

  // -----------------------------------------------------------------------
  // TYPESCRIPT × 8  (IDs 28–35)
  // -----------------------------------------------------------------------

  // 28. TypeScript — decorator metadata ordering
  {
    bugId: uuidv4(),
    language: "typescript",
    category: "decorators",
    difficulty: 5,
    buggyCode: `function Log(target: any, key: string, descriptor: PropertyDescriptor) {
  const original = descriptor.value;
  descriptor.value = function(...args: any[]) {
    console.log(\`Calling \${key}\`);
    return original.apply(this, args);
  };
  return descriptor;
}

function Memoize(target: any, key: string, descriptor: PropertyDescriptor) {
  const cache = new Map();
  const original = descriptor.value;
  descriptor.value = function(...args: any[]) {
    const cacheKey = JSON.stringify(args);
    if (cache.has(cacheKey)) return cache.get(cacheKey);
    const result = original.apply(this, args);
    cache.set(cacheKey, result);
    return result;
  };
  return descriptor;
}

class Calculator {
  @Log
  @Memoize
  compute(n: number): number {
    return n * n;
  }
}`,
    correctCode: `class Calculator {
  @Memoize
  @Log
  compute(n: number): number {
    return n * n;
  }
}`,
    bugLine: 23,
    options: [
      "Decorators cannot be stacked on a single method in TypeScript",
      "Decorators apply bottom-up: @Memoize runs first, then @Log wraps it. With @Log on top, Log wraps Memoize — so every call logs even when a cached result is returned",
      "The descriptor.value replacement in Log must call new.target instead of this",
      "Memoize needs the reflect-metadata package to access parameter types",
    ],
    correctAnswer: 1,
    explanation:
      "TypeScript method decorators are applied from bottom to top (innermost first). With @Log above @Memoize, @Memoize is applied first (wraps the original), then @Log wraps the memoized version. Every call to compute() goes through Log — even cache hits — which logs 'Calling compute' needlessly. Swapping the order so @Memoize is on top means Log is the outer wrapper and Memoize is inner; Log fires on every call, Memoize short-circuits inside.",
    hint: "In what order are stacked method decorators applied in TypeScript?",
    source: "manual",
    status: "active",
    timesServed: 0,
    createdAt: Date.now(),
  },

  // 29. TypeScript — mapped type readonly trap
  {
    bugId: uuidv4(),
    language: "typescript",
    category: "mapped types",
    difficulty: 4,
    buggyCode: `type DeepReadonly<T> = {
  readonly [K in keyof T]: T[K];
};

interface Config {
  server: { host: string; port: number };
  debug: boolean;
}

const cfg: DeepReadonly<Config> = {
  server: { host: "localhost", port: 3000 },
  debug: false,
};

cfg.server.port = 8080; // Should this be allowed?`,
    correctCode: `type DeepReadonly<T> = {
  readonly [K in keyof T]: T[K] extends object ? DeepReadonly<T[K]> : T[K];
};`,
    bugLine: 3,
    options: [
      "readonly properties cannot be used inside mapped types",
      "The mapped type marks top-level properties readonly but nested objects remain mutable; cfg.server.port can still be reassigned",
      "DeepReadonly requires the infer keyword to recurse into nested types",
      "TypeScript does not support recursive mapped types",
    ],
    correctAnswer: 1,
    explanation:
      "The mapped type makes T's own keys readonly, but the value types T[K] are unchanged. For cfg.server, the server property itself is readonly (can't reassign cfg.server), but the object it points to is a plain mutable { host: string; port: number }. Therefore cfg.server.port = 8080 compiles without error. True deep readonly requires recursing into object-valued properties.",
    hint: "Does marking a property readonly also make the object it references readonly?",
    source: "manual",
    status: "active",
    timesServed: 0,
    createdAt: Date.now(),
  },

  // 30. TypeScript — conditional type distributivity
  {
    bugId: uuidv4(),
    language: "typescript",
    category: "conditional types",
    difficulty: 5,
    buggyCode: `type IsString<T> = T extends string ? true : false;

type Result = IsString<string | number>; // Expected: false`,
    correctCode: `type IsString<T> = [T] extends [string] ? true : false;

type Result = IsString<string | number>; // Now: false`,
    bugLine: 1,
    options: [
      "Conditional types cannot use union types as type arguments",
      "Bare conditional types distribute over unions: IsString<string | number> becomes (IsString<string> | IsString<number>) = true | false = boolean, not false",
      "The extends keyword in a conditional type requires a constraint, not a type",
      "string | number needs to be wrapped in a tuple before using extends",
    ],
    correctAnswer: 1,
    explanation:
      "When a generic conditional type T extends U ? X : Y is applied to a union type, TypeScript distributes the conditional over each union member. IsString<string | number> becomes IsString<string> | IsString<number> = true | false = boolean — not the simple false you might expect. Wrapping in a tuple ([T] extends [string]) prevents distribution and checks the union as a whole.",
    hint: "What does TypeScript do when a conditional type is applied to a union type argument?",
    source: "manual",
    status: "active",
    timesServed: 0,
    createdAt: Date.now(),
  },

  // 31. TypeScript — type predicate narrowing bug
  {
    bugId: uuidv4(),
    language: "typescript",
    category: "type predicates",
    difficulty: 4,
    buggyCode: `interface Cat { meow(): void }
interface Dog { bark(): void }

function isCat(animal: Cat | Dog): boolean {
  return (animal as Cat).meow !== undefined;
}

function makeNoise(animal: Cat | Dog) {
  if (isCat(animal)) {
    animal.meow(); // TypeScript still sees Cat | Dog here
  }
}`,
    correctCode: `function isCat(animal: Cat | Dog): animal is Cat {
  return typeof (animal as Cat).meow === "function";
}`,
    bugLine: 4,
    options: [
      "Type guards must use instanceof instead of property checks",
      "Returning boolean instead of 'animal is Cat' means TypeScript does not narrow the type inside the if block; animal remains Cat | Dog",
      "The cast (animal as Cat) bypasses the type system and will crash at runtime",
      "isCat must be a method on a class, not a standalone function",
    ],
    correctAnswer: 1,
    explanation:
      "A function returning plain boolean is just a boolean check — TypeScript does not use it to narrow the type at the call site. To tell TypeScript 'if this returns true, the argument is of type Cat', the return type must be a type predicate: 'animal is Cat'. Without it, inside the if block TypeScript still sees 'Cat | Dog' and calling animal.meow() is a type error.",
    hint: "What return type annotation tells TypeScript to narrow a union type when a guard function returns true?",
    source: "manual",
    status: "active",
    timesServed: 0,
    createdAt: Date.now(),
  },

  // 32. TypeScript — function overload implementation signature
  {
    bugId: uuidv4(),
    language: "typescript",
    category: "overloads",
    difficulty: 4,
    buggyCode: `function format(value: string): string;
function format(value: number): string;
function format(value: string | number): string {
  if (typeof value === "string") return value.toUpperCase();
  return value.toFixed(2);
}

const fn: (x: string | number) => string = format;`,
    correctCode: `function format(value: string): string;
function format(value: number): string;
function format(value: string | number): string {
  if (typeof value === "string") return value.toUpperCase();
  return value.toFixed(2);
}

// Correct: call with a specific overload signature
const result = format("hello" as string);`,
    bugLine: 8,
    options: [
      "Overloaded functions cannot be assigned to variables in TypeScript",
      "The implementation signature (string | number) is not part of the public type; assigning to a variable typed as (string | number) => string fails because that signature is not among the overloads",
      "toFixed() is not available on the number type in TypeScript",
      "Overload signatures must use interface syntax, not function declarations",
    ],
    correctAnswer: 1,
    explanation:
      "In TypeScript, the implementation signature of an overloaded function is hidden from external callers — only the overload signatures are public. The public type of 'format' is the union of its overloads: ((x: string) => string) & ((x: number) => string). Assigning it to a variable typed as (x: string | number) => string fails because 'string | number' is not one of the declared overloads. Callers must use one of the specific overload types.",
    hint: "Is the implementation signature of an overloaded function visible to callers in TypeScript?",
    source: "manual",
    status: "active",
    timesServed: 0,
    createdAt: Date.now(),
  },

  // 33. TypeScript — template literal type inference
  {
    bugId: uuidv4(),
    language: "typescript",
    category: "template literals",
    difficulty: 4,
    buggyCode: `type EventName = "click" | "focus" | "blur";
type Handler = \`on\${EventName}\`;

function on(event: Handler, cb: () => void) {}

on("onclick", () => {});  // Should this compile?`,
    correctCode: `on("onClick", () => {});  // Correct: camelCase`,
    bugLine: 6,
    options: [
      "Template literal types only work with string literals, not union types",
      "'onclick' is not in the Handler type; template literals are case-sensitive and produce 'onClick', 'onFocus', 'onBlur' — not lowercase versions",
      "The on() function should accept a generic parameter instead of a mapped type",
      "Template literal types require the --strictTemplateTypes compiler flag",
    ],
    correctAnswer: 1,
    explanation:
      "Template literal types are purely structural string concatenation. `on${EventName}` produces the union 'onClick' | 'onFocus' | 'onBlur' — all with the original casing of EventName preserved. Passing 'onclick' (all lowercase) fails because it is not a member of the Handler union. The compiler enforces exact string matching.",
    hint: "Do TypeScript template literal types alter the casing of the interpolated type?",
    source: "manual",
    status: "active",
    timesServed: 0,
    createdAt: Date.now(),
  },

  // 34. TypeScript — assertion function typing
  {
    bugId: uuidv4(),
    language: "typescript",
    category: "assertion functions",
    difficulty: 5,
    buggyCode: `function assertDefined<T>(val: T | null | undefined): void {
  if (val === null || val === undefined) {
    throw new Error("Value is not defined");
  }
}

function processUser(user: User | null) {
  assertDefined(user);
  user.name; // TypeScript: user is still User | null here
}`,
    correctCode: `function assertDefined<T>(val: T | null | undefined): asserts val is T {
  if (val === null || val === undefined) {
    throw new Error("Value is not defined");
  }
}`,
    bugLine: 1,
    options: [
      "Assertion functions must throw a specific AssertionError subclass",
      "The return type must be 'asserts val is T'; returning void does not tell TypeScript that val is narrowed after the call",
      "Generic assertion functions require the Exclude utility type to remove null",
      "assertDefined must be inlined — TypeScript cannot narrow across function call boundaries",
    ],
    correctAnswer: 1,
    explanation:
      "A plain void return type tells TypeScript nothing about the state of val after the function returns. TypeScript 3.7 introduced assertion function signatures: 'asserts val is T'. This tells the compiler that if assertDefined returns normally (without throwing), val is definitely T — narrowing subsequent references automatically. Without it, user remains User | null after the call.",
    hint: "What return type annotation enables TypeScript to narrow a type after a throwing guard function returns?",
    source: "manual",
    status: "active",
    timesServed: 0,
    createdAt: Date.now(),
  },

  // 35. TypeScript — narrowing failure with type alias
  {
    bugId: uuidv4(),
    language: "typescript",
    category: "narrowing failures",
    difficulty: 4,
    buggyCode: `type StringOrNumber = string | number;

function double(x: StringOrNumber): StringOrNumber {
  if (typeof x === "string") {
    return x.repeat(2);
  }
  return x * 2;
}

let val: StringOrNumber = Math.random() > 0.5 ? "hi" : 42;
if (typeof val === "string") {
  val.toUpperCase();
}
val.toUpperCase(); // Is this a type error?`,
    correctCode: `// After the if block, val reverts to StringOrNumber (string | number).
// val.toUpperCase() outside the if block IS a type error.
// TypeScript narrowing only applies within the narrowed scope.`,
    bugLine: 14,
    options: [
      "TypeScript does not narrow type aliases, only inline union types",
      "After the if block, control flow analysis widens val back to StringOrNumber; calling toUpperCase() outside the narrowed block is a type error",
      "typeof checks only work with primitive types declared directly, not via type aliases",
      "val must be re-assigned after the if block to preserve the narrowed type",
    ],
    correctAnswer: 1,
    explanation:
      "TypeScript's control-flow narrowing is scoped. Inside 'if (typeof val === \"string\") { }', val is narrowed to string. Outside the block (line 14), TypeScript widens val back to StringOrNumber (string | number) because val could have entered via the else path. Calling val.toUpperCase() at line 14 is a compile-time type error. The narrowing only holds within the block where the check is in scope.",
    hint: "How long does TypeScript's control-flow narrowing last after an if block ends?",
    source: "manual",
    status: "active",
    timesServed: 0,
    createdAt: Date.now(),
  },

  // -----------------------------------------------------------------------
  // SQL × 5  (IDs 36–40)
  // -----------------------------------------------------------------------

  // 36. SQL — GROUP BY without aggregate
  {
    bugId: uuidv4(),
    language: "sql",
    category: "GROUP BY",
    difficulty: 3,
    buggyCode: `SELECT department, name, MAX(salary) AS top_salary
FROM employees
GROUP BY department;`,
    correctCode: `SELECT department, MAX(salary) AS top_salary
FROM employees
GROUP BY department;`,
    bugLine: 1,
    options: [
      "MAX() cannot be used with GROUP BY in standard SQL",
      "Non-aggregated column 'name' is not in the GROUP BY clause; the query will fail or return an arbitrary name per department",
      "The GROUP BY clause should list all SELECT columns including MAX(salary)",
      "department must be cast to TEXT before grouping",
    ],
    correctAnswer: 1,
    explanation:
      "In standard SQL, every column in the SELECT list must either be in the GROUP BY clause or wrapped in an aggregate function. 'name' is neither. In MySQL with ONLY_FULL_GROUP_BY disabled this returns an arbitrary name; in PostgreSQL and most strict databases this is an error. Remove 'name' from SELECT, or add it to GROUP BY if the intent is to group by (department, name).",
    hint: "What rule governs which columns can appear in the SELECT list when using GROUP BY?",
    source: "manual",
    status: "active",
    timesServed: 0,
    createdAt: Date.now(),
  },

  // 37. SQL — HAVING vs WHERE
  {
    bugId: uuidv4(),
    language: "sql",
    category: "HAVING",
    difficulty: 3,
    buggyCode: `SELECT department, COUNT(*) AS headcount
FROM employees
WHERE headcount > 10
GROUP BY department;`,
    correctCode: `SELECT department, COUNT(*) AS headcount
FROM employees
GROUP BY department
HAVING COUNT(*) > 10;`,
    bugLine: 3,
    options: [
      "COUNT(*) should be COUNT(id) for accuracy",
      "WHERE is evaluated before GROUP BY so 'headcount' alias does not exist yet; aggregates must be filtered with HAVING",
      "The WHERE clause cannot reference column aliases in any SQL dialect",
      "HAVING and WHERE can be used interchangeably for aggregate conditions",
    ],
    correctAnswer: 1,
    explanation:
      "SQL evaluates clauses in this logical order: FROM → WHERE → GROUP BY → HAVING → SELECT → ORDER BY. The WHERE clause filters individual rows before grouping. The alias 'headcount' and the aggregate COUNT(*) do not exist at the WHERE stage. HAVING is designed for post-aggregation filtering and is evaluated after GROUP BY.",
    hint: "At which stage of SQL evaluation does WHERE filter rows, relative to GROUP BY?",
    source: "manual",
    status: "active",
    timesServed: 0,
    createdAt: Date.now(),
  },

  // 38. SQL — window function PARTITION BY bug
  {
    bugId: uuidv4(),
    language: "sql",
    category: "window functions",
    difficulty: 4,
    buggyCode: `SELECT
  employee_id,
  department,
  salary,
  RANK() OVER (ORDER BY salary DESC) AS dept_rank
FROM employees;`,
    correctCode: `SELECT
  employee_id,
  department,
  salary,
  RANK() OVER (PARTITION BY department ORDER BY salary DESC) AS dept_rank
FROM employees;`,
    bugLine: 5,
    options: [
      "RANK() requires a ROWS BETWEEN frame clause",
      "Missing PARTITION BY department; the RANK() is computed globally across all departments, not within each department",
      "ORDER BY inside OVER() is not supported in all SQL dialects",
      "dept_rank will be NULL when two employees have the same salary",
    ],
    correctAnswer: 1,
    explanation:
      "Without PARTITION BY, the window function operates over the entire result set as a single partition. RANK() will rank all employees globally by salary, not within their department. Adding 'PARTITION BY department' restarts the ranking for each department, which is the typical intent for a 'rank within group' query.",
    hint: "What does PARTITION BY do in a window function, and what happens when it is omitted?",
    source: "manual",
    status: "active",
    timesServed: 0,
    createdAt: Date.now(),
  },

  // 39. SQL — correlated subquery performance trap
  {
    bugId: uuidv4(),
    language: "sql",
    category: "subquery correlation",
    difficulty: 4,
    buggyCode: `SELECT e.name, e.salary
FROM employees e
WHERE e.salary > (
  SELECT AVG(salary)
  FROM employees
  WHERE department = e.department
);`,
    correctCode: `SELECT e.name, e.salary
FROM employees e
JOIN (
  SELECT department, AVG(salary) AS avg_sal
  FROM employees
  GROUP BY department
) dept_avg ON e.department = dept_avg.department
WHERE e.salary > dept_avg.avg_sal;`,
    bugLine: 3,
    options: [
      "AVG() cannot be used in a correlated subquery",
      "The correlated subquery re-executes for every row in the outer query; for large tables this is O(n²) — a derived table or CTE computes AVG once per department",
      "WHERE inside a subquery cannot reference the outer query's alias",
      "The subquery must be in the FROM clause, not the WHERE clause",
    ],
    correctAnswer: 1,
    explanation:
      "The subquery references e.department from the outer query, making it correlated. The database must re-execute the subquery once per row in the employees table to compute the department average. For 10,000 employees in 50 departments, that is 10,000 executions instead of 50. Rewriting with a derived table or CTE computes each department average once, drastically improving performance.",
    hint: "How many times does a correlated subquery execute relative to the outer query's row count?",
    source: "manual",
    status: "active",
    timesServed: 0,
    createdAt: Date.now(),
  },

  // 40. SQL — UNION vs UNION ALL duplicates
  {
    bugId: uuidv4(),
    language: "sql",
    category: "UNION vs UNION ALL",
    difficulty: 3,
    buggyCode: `-- Get all active user IDs from two regional shards
SELECT user_id FROM users_us WHERE active = 1
UNION
SELECT user_id FROM users_eu WHERE active = 1;`,
    correctCode: `SELECT user_id FROM users_us WHERE active = 1
UNION ALL
SELECT user_id FROM users_eu WHERE active = 1;`,
    bugLine: 3,
    options: [
      "UNION requires both queries to have the same number of columns",
      "UNION performs an implicit DISTINCT, silently removing users who appear in both shards; UNION ALL preserves all rows including duplicates",
      "UNION cannot be used with a WHERE clause in either sub-select",
      "UNION ALL is only valid when the two result sets have no overlapping rows",
    ],
    correctAnswer: 1,
    explanation:
      "UNION removes duplicate rows from the combined result (equivalent to applying DISTINCT). If a user_id exists in both users_us and users_eu (e.g. a user who moved regions), that row will appear only once, silently losing the duplicate. UNION ALL keeps all rows from both queries without deduplication. For a simple merge of two shards where you want every record, UNION ALL is usually correct and also faster (no sort/hash dedup step).",
    hint: "What extra operation does UNION perform compared to UNION ALL?",
    source: "manual",
    status: "active",
    timesServed: 0,
    createdAt: Date.now(),
  },

  // -----------------------------------------------------------------------
  // GO × 5  (IDs 41–45)
  // -----------------------------------------------------------------------

  // 41. Go — defer in loop
  {
    bugId: uuidv4(),
    language: "go",
    category: "defer in loop",
    difficulty: 4,
    buggyCode: `func processFiles(paths []string) error {
    for _, path := range paths {
        f, err := os.Open(path)
        if err != nil {
            return err
        }
        defer f.Close()
        // process f...
    }
    return nil
}`,
    correctCode: `func processFiles(paths []string) error {
    for _, path := range paths {
        if err := processOne(path); err != nil {
            return err
        }
    }
    return nil
}

func processOne(path string) error {
    f, err := os.Open(path)
    if err != nil {
        return err
    }
    defer f.Close()
    // process f...
    return nil
}`,
    bugLine: 6,
    options: [
      "defer cannot be used inside a for loop in Go",
      "defer runs when the enclosing function returns, not at the end of each loop iteration; all file handles accumulate open until processFiles exits",
      "os.Open requires the defer to specify the error from f.Close()",
      "range loops in Go do not support defer because the loop variable is reused",
    ],
    correctAnswer: 1,
    explanation:
      "defer is function-scoped, not block-scoped. Every defer f.Close() in the loop registers a deferred call that runs when processFiles() returns — not at the end of each iteration. For 1000 files, 1000 file handles are opened before any are closed, potentially exhausting OS file descriptors. The fix is to extract the per-file work into a separate function where defer runs at end of each call.",
    hint: "When exactly does a deferred function call execute in Go?",
    source: "manual",
    status: "active",
    timesServed: 0,
    createdAt: Date.now(),
  },

  // 42. Go — map concurrent read/write race
  {
    bugId: uuidv4(),
    language: "go",
    category: "map race condition",
    difficulty: 5,
    buggyCode: `var cache = make(map[string]int)

func increment(key string) {
    go func() {
        cache[key]++
    }()
}`,
    correctCode: `var (
    cache = make(map[string]int)
    mu    sync.Mutex
)

func increment(key string) {
    go func() {
        mu.Lock()
        cache[key]++
        mu.Unlock()
    }()
}`,
    bugLine: 4,
    options: [
      "Maps in Go must be initialised with a capacity hint to be goroutine-safe",
      "Concurrent reads and writes to a Go map without synchronisation cause a fatal runtime panic ('concurrent map read and map write')",
      "The goroutine captures key by value, causing all goroutines to use the same key",
      "make(map[string]int) without a size hint is not safe for concurrent use",
    ],
    correctAnswer: 1,
    explanation:
      "Go maps are explicitly not safe for concurrent use. Simultaneous reads and writes (or two concurrent writes) trigger a fatal runtime error: 'concurrent map read and map write'. This is not a data race that silently returns wrong results — it crashes the program. Use a sync.Mutex (or sync.RWMutex for read-heavy workloads) or a sync.Map for concurrent access.",
    hint: "Are Go maps safe to read and write from multiple goroutines simultaneously?",
    source: "manual",
    status: "active",
    timesServed: 0,
    createdAt: Date.now(),
  },

  // 43. Go — interface nil trap
  {
    bugId: uuidv4(),
    language: "go",
    category: "interface nil trap",
    difficulty: 5,
    buggyCode: `type MyError struct{ msg string }
func (e *MyError) Error() string { return e.msg }

func mayFail() error {
    var err *MyError = nil
    // ... some logic that might set err ...
    return err
}

func main() {
    if mayFail() != nil {
        fmt.Println("got error")
    }
}`,
    correctCode: `func mayFail() error {
    // Return nil directly, not a typed nil pointer
    return nil
}`,
    bugLine: 7,
    options: [
      "Returning a pointer type from an error function always causes a panic",
      "A nil *MyError is wrapped in an error interface with a non-nil type descriptor; the interface value is not nil even though the pointer is nil",
      "error must be returned as a concrete type, not an interface",
      "The comparison != nil should use errors.Is(err, nil) instead",
    ],
    correctAnswer: 1,
    explanation:
      "In Go, an interface value is nil only when both its type and value are nil. Returning 'err' (a *MyError nil pointer) wraps it in an error interface: the type descriptor is *MyError (non-nil), so the interface itself is not nil. 'mayFail() != nil' is true even though err is nil. Always return the untyped nil directly from functions returning interfaces.",
    hint: "When is an interface value equal to nil in Go?",
    source: "manual",
    status: "active",
    timesServed: 0,
    createdAt: Date.now(),
  },

  // 44. Go — slice append aliasing
  {
    bugId: uuidv4(),
    language: "go",
    category: "slice append gotcha",
    difficulty: 4,
    buggyCode: `func addElement(s []int, v int) []int {
    s = append(s, v)
    return s
}

base := make([]int, 3, 10) // len=3, cap=10
base[0], base[1], base[2] = 1, 2, 3

a := addElement(base, 4)
b := addElement(base, 5)
fmt.Println(a) // [1 2 3 4] or [1 2 3 5]?`,
    correctCode: `func addElement(s []int, v int) []int {
    // Make a copy to avoid aliasing the underlying array
    fresh := make([]int, len(s), len(s)+1)
    copy(fresh, s)
    return append(fresh, v)
}`,
    bugLine: 8,
    options: [
      "append() always allocates a new backing array, so a and b are independent",
      "Both calls pass base which has spare capacity; append writes into the same backing array without allocating, so 'b := addElement(base, 5)' overwrites a[3]",
      "make([]int, 3, 10) must use len == cap to be safe with append",
      "Passing a slice by value creates a copy of the backing array",
    ],
    correctAnswer: 1,
    explanation:
      "append only allocates a new backing array when len == cap. base has cap=10, so both appends write into the same underlying array at index 3. After 'a := addElement(base, 4)', a[3] is 4. Then 'b := addElement(base, 5)' writes 5 at index 3 of the same array, overwriting a[3]. Printing a gives [1 2 3 5], not [1 2 3 4]. Always copy the slice before appending if you need independent slices.",
    hint: "When does Go's append function allocate a new backing array for the slice?",
    source: "manual",
    status: "active",
    timesServed: 0,
    createdAt: Date.now(),
  },

  // 45. Go — channel direction in function signature
  {
    bugId: uuidv4(),
    language: "go",
    category: "channel direction",
    difficulty: 3,
    buggyCode: `func producer(ch chan int) {
    for i := 0; i < 5; i++ {
        ch <- i
    }
    close(ch)
}

func consumer(ch chan int) {
    ch <- 99  // Bug: consumer is reading but can also accidentally send
}`,
    correctCode: `func producer(ch chan<- int) {
    for i := 0; i < 5; i++ {
        ch <- i
    }
    close(ch)
}

func consumer(ch <-chan int) {
    for v := range ch {
        fmt.Println(v)
    }
}`,
    bugLine: 1,
    options: [
      "Bidirectional channels cannot be passed to functions in Go",
      "Using chan int instead of chan<- int or <-chan int allows consumer to accidentally send on a receive-only channel and producer to receive — directional types catch these bugs at compile time",
      "close() can only be called on chan<- int channels",
      "Channel direction annotations are only valid for buffered channels",
    ],
    correctAnswer: 1,
    explanation:
      "Go supports directional channel types: chan<- T (send-only) and <-chan T (receive-only). Using the undirected chan int in both producer and consumer signatures means either function can both send and receive, and the type system won't catch mistakes like consumer accidentally sending. Directional types make intent explicit and let the compiler reject direction violations. Also, close() can only be called on a bidirectional or send-only channel — it's a compile error on <-chan.",
    hint: "What is the difference between chan int, chan<- int, and <-chan int in Go?",
    source: "manual",
    status: "active",
    timesServed: 0,
    createdAt: Date.now(),
  },

  // -----------------------------------------------------------------------
  // PYTHON × 5  (IDs 46–50)
  // -----------------------------------------------------------------------

  // 46. Python — generator exhaustion
  {
    bugId: uuidv4(),
    language: "python",
    category: "generator exhaustion",
    difficulty: 3,
    buggyCode: `def evens(n):
    for i in range(n):
        if i % 2 == 0:
            yield i

gen = evens(10)
print(list(gen))   # [0, 2, 4, 6, 8]
print(list(gen))   # Expected: [0, 2, 4, 6, 8] again?`,
    correctCode: `def evens(n):
    for i in range(n):
        if i % 2 == 0:
            yield i

# Call evens() again to get a fresh generator
print(list(evens(10)))
print(list(evens(10)))`,
    bugLine: 8,
    options: [
      "list() consumes a generator and raises StopIteration on the second call",
      "A generator can only be iterated once; after the first list(gen) the generator is exhausted and the second list(gen) returns []",
      "yield requires a send() call to reset the generator state",
      "Generators automatically reset when converted to a list",
    ],
    correctAnswer: 1,
    explanation:
      "A Python generator object maintains its position in the sequence. After list(gen) drains all values, the generator is in an exhausted state — there is no rewind mechanism. The second list(gen) returns [] because calling next() on an exhausted generator immediately raises StopIteration. To iterate multiple times, either store the result in a list, or call evens(10) again to create a fresh generator.",
    hint: "Can you iterate over a Python generator more than once?",
    source: "manual",
    status: "active",
    timesServed: 0,
    createdAt: Date.now(),
  },

  // 47. Python — walrus operator scope
  {
    bugId: uuidv4(),
    language: "python",
    category: "walrus operator",
    difficulty: 4,
    buggyCode: `import re

patterns = [r"\\d+", r"[a-z]+", r"[A-Z]+"]
text = "Hello123"

results = [m.group() for p in patterns if (m := re.search(p, text))]
print(m)  # Is 'm' defined here?`,
    correctCode: `import re

patterns = [r"\\d+", r"[a-z]+", r"[A-Z]+"]
text = "Hello123"

results = [m.group() for p in patterns if (m := re.search(p, text))]
# 'm' leaks into the enclosing scope — it holds the last match object
# This is intentional for walrus but can cause surprising behaviour`,
    bugLine: 7,
    options: [
      "The walrus operator := is not allowed inside list comprehensions",
      "Unlike regular comprehension variables, := leaks the bound name into the enclosing scope; 'm' at line 7 is the last match object (or undefined if no pattern matched), which may be surprising",
      "re.search returns a bytes object that cannot call .group()",
      "m.group() raises AttributeError when the match fails",
    ],
    correctAnswer: 1,
    explanation:
      "In Python 3.8+, the walrus operator := in a comprehension deliberately leaks its binding into the enclosing scope (unlike the iteration variable which is local). After the comprehension, 'm' refers to the last value it was assigned — the match object from the last pattern that matched, or potentially an older value if the last pattern didn't match. This is by design but often surprises developers who expect comprehension-local scope.",
    hint: "Does the walrus operator := inside a list comprehension create a scope-local variable?",
    source: "manual",
    status: "active",
    timesServed: 0,
    createdAt: Date.now(),
  },

  // 48. Python — f-string expression evaluated at call site
  {
    bugId: uuidv4(),
    language: "python",
    category: "f-string edge case",
    difficulty: 3,
    buggyCode: `class User:
    def __init__(self, name):
        self.name = name
        self.greeting = f"Hello, {self.name}!"

    def rename(self, new_name):
        self.name = new_name

u = User("Alice")
u.rename("Bob")
print(u.greeting)  # What does this print?`,
    correctCode: `class User:
    def __init__(self, name):
        self.name = name

    @property
    def greeting(self):
        return f"Hello, {self.name}!"`,
    bugLine: 3,
    options: [
      "f-strings inside __init__ cannot reference self",
      "The f-string is evaluated immediately when __init__ runs, capturing 'Alice'; renaming later does not update greeting because it is a plain string, not a live expression",
      "greeting should be a class variable, not an instance variable",
      "f-strings with self.name raise AttributeError during __init__",
    ],
    correctAnswer: 1,
    explanation:
      "An f-string is evaluated eagerly at the point it is written — not lazily. When __init__ runs, self.name is 'Alice', so greeting becomes the string 'Hello, Alice!'. This string object is stored as self.greeting. Calling rename('Bob') changes self.name but does not re-evaluate the f-string stored in self.greeting. To make greeting always reflect the current name, define it as a property that builds the f-string on access.",
    hint: "When exactly is an f-string expression evaluated in Python?",
    source: "manual",
    status: "active",
    timesServed: 0,
    createdAt: Date.now(),
  },

  // 49. Python — tuple unpacking count mismatch
  {
    bugId: uuidv4(),
    language: "python",
    category: "unpacking error",
    difficulty: 2,
    buggyCode: `def get_coords():
    return 1, 2, 3  # x, y, z

x, y = get_coords()
print(x, y)`,
    correctCode: `def get_coords():
    return 1, 2, 3

x, y, z = get_coords()
print(x, y, z)

# Or use starred assignment to discard extras:
x, y, *_ = get_coords()`,
    bugLine: 4,
    options: [
      "Functions cannot return more than two values in Python",
      "get_coords() returns 3 values but only 2 targets are on the left side; Python raises ValueError: too many values to unpack",
      "Tuple unpacking requires the right side to be wrapped in list()",
      "The function should return a tuple explicitly with (1, 2, 3) not a bare comma-separated list",
    ],
    correctAnswer: 1,
    explanation:
      "Python's tuple unpacking requires the number of targets on the left to exactly match the number of values on the right (unless starred assignment is used). 'x, y = get_coords()' unpacks a 3-tuple into 2 variables, raising 'ValueError: too many values to unpack (expected 2)'. Fix by adding a third variable, using a starred catch-all, or changing the function to return 2 values.",
    hint: "What happens when the number of unpacking targets doesn't match the number of values?",
    source: "manual",
    status: "active",
    timesServed: 0,
    createdAt: Date.now(),
  },

  // 50. Python — class variable vs instance variable
  {
    bugId: uuidv4(),
    language: "python",
    category: "class vs instance variable",
    difficulty: 3,
    buggyCode: `class BankAccount:
    balance = 0

    def deposit(self, amount):
        self.balance += amount

a = BankAccount()
b = BankAccount()
a.deposit(100)
print(b.balance)  # What does this print?`,
    correctCode: `class BankAccount:
    def __init__(self):
        self.balance = 0

    def deposit(self, amount):
        self.balance += amount`,
    bugLine: 2,
    options: [
      "Class variables and instance variables behave identically for numeric types",
      "balance = 0 is a class variable; the first self.balance += amount on instance 'a' creates an instance variable on 'a' only — b.balance still reads the class variable 0",
      "Both a and b share the same balance because integers are immutable in Python",
      "self.balance += amount modifies the class variable in place for all instances",
    ],
    correctAnswer: 1,
    explanation:
      "Class variables are shared across all instances until an instance assignment shadows them. self.balance += amount is equivalent to self.balance = self.balance + amount. On the first call for 'a', Python reads the class variable (0), adds 100, and stores the result as an instance variable on 'a'. The class variable BankAccount.balance remains 0. b.balance still finds only the class variable: 0. To give each instance its own balance, initialise it in __init__.",
    hint: "What happens to a class variable when you do self.variable += value on an instance for the first time?",
    source: "manual",
    status: "active",
    timesServed: 0,
    createdAt: Date.now(),
  },
]

// ---------------------------------------------------------------------------
// Index helpers
// ---------------------------------------------------------------------------

function buildIndex(bugList: BugDef[]): {
  bugIds: string[]
  byDifficulty: Record<string, string[]>
} {
  const byDifficulty: Record<string, string[]> = {
    "1": [],
    "2": [],
    "3": [],
    "4": [],
    "5": [],
  }
  for (const bug of bugList) {
    if (bug.status === "active") {
      byDifficulty[String(bug.difficulty)].push(bug.bugId)
    }
  }
  return {
    bugIds: bugList.filter((b) => b.status === "active").map((b) => b.bugId),
    byDifficulty,
  }
}

// ---------------------------------------------------------------------------
// DynamoDB write helpers
// ---------------------------------------------------------------------------

async function indexExists(): Promise<boolean> {
  const result = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { pk: "BUG#INDEX", sk: "META" },
    })
  )
  return !!result.Item
}

/** Write bugs in batches of 25 (DynamoDB BatchWrite limit). */
async function writeBugs(bugList: BugDef[]): Promise<void> {
  const BATCH_SIZE = 25
  for (let i = 0; i < bugList.length; i += BATCH_SIZE) {
    const slice = bugList.slice(i, i + BATCH_SIZE)
    const requestItems = slice.map((bug) => ({
      PutRequest: {
        Item: {
          pk: `BUG#${bug.bugId}`,
          sk: "META",
          ...bug,
        },
      },
    }))
    await ddb.send(
      new BatchWriteCommand({
        RequestItems: {
          [TABLE_NAME]: requestItems,
        },
      })
    )
    console.log(`  Wrote bugs ${i + 1}–${i + slice.length}`)
  }
}

async function writeIndex(index: {
  bugIds: string[]
  byDifficulty: Record<string, string[]>
}): Promise<void> {
  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        pk: "BUG#INDEX",
        sk: "META",
        bugIds: index.bugIds,
        byDifficulty: index.byDifficulty,
      },
    })
  )
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const force = process.argv.includes("--force")

  console.log(`\nBugHunt seed script — table: ${TABLE_NAME} (${REGION})\n`)

  if (!force && (await indexExists())) {
    console.log("BUG#INDEX already exists — bugs already seeded. Exiting.")
    console.log("Tip: run with --force to re-seed all bugs.")
    return
  }

  if (force) {
    console.log("--force flag detected: re-seeding all bugs…")
  }

  console.log(`Seeding ${bugs.length} bugs…`)
  await writeBugs(bugs)

  const index = buildIndex(bugs)
  console.log("\nWriting BUG#INDEX…")
  await writeIndex(index)

  // Summary
  const counts: Record<string, number> = {}
  for (const bug of bugs) {
    counts[bug.language] = (counts[bug.language] ?? 0) + 1
  }

  console.log("\nDone! Bugs seeded per language:")
  for (const [lang, count] of Object.entries(counts).sort()) {
    console.log(`  ${lang}: ${count}`)
  }
  console.log(`\nTotal: ${bugs.length} bugs`)
}

main().catch((err) => {
  console.error("Seed error:", err)
  process.exit(1)
})
