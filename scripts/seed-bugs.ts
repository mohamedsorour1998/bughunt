/**
 * BugHunt — Seed Script
 *
 * Writes 20 hand-crafted bugs to DynamoDB and builds the BUG#INDEX item.
 * Idempotent: if the index already exists the script prints a message and
 * exits without re-writing the bugs.
 *
 * Run: npm run db:seed
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
// Bug definitions — 20 bugs across 5 languages
// ---------------------------------------------------------------------------

const bugs: BugDef[] = [
  // =========================================================================
  // PYTHON × 5
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
  // JAVASCRIPT × 5
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
  // TYPESCRIPT × 4
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
  // SQL × 3
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
  // GO × 3
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
      "int32 has a maximum value of 2,147,483,647. For moderate day counts (≤ 24 days) the result fits. But daysToSeconds(25) = 2,160,000 which fits, while daysToSeconds(50) = 4,320,000 silently overflows and wraps to a negative number. Using int64 (max ~9.2 × 10^18) avoids the overflow for any realistic input.",
    hint: "What is the maximum value of int32, and how many seconds are in 25+ days?",
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
  console.log(`\nBugHunt seed script — table: ${TABLE_NAME} (${REGION})\n`)

  if (await indexExists()) {
    console.log("BUG#INDEX already exists — bugs already seeded. Exiting.")
    return
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
