import { expect, test } from "vitest";
import { getExistingTimestamps } from "../src/Evolu/Sync.js";
import { ok } from "../src/Result.js";
import { sql } from "../src/Sqlite.js";
import {
  testCreateSqlite,
  testOwnerIdBytes,
  testOwnerIdBytes2,
  testTime,
} from "./_deps.js";
import { testTimestampsAsc } from "./Evolu/_fixtures.js";

test("getExistingTimestamps works correctly with CTE", async () => {
  const sqlite = await testCreateSqlite();

  // Create fake evolu_timestamp table for testing
  sqlite.exec(sql`
    create table evolu_timestamp (
      ownerId blob not null,
      t blob not null
    );
  `);

  const timestamp1Bytes = testTimestampsAsc[0];
  const timestamp2Bytes = testTimestampsAsc[1];
  const timestamp3Bytes = testTimestampsAsc[2];

  const allTimestamps = [
    timestamp1Bytes,
    timestamp2Bytes,
    timestamp3Bytes,
  ] as const;

  // Test 1: No existing timestamps - should return empty array
  const emptyResult = getExistingTimestamps({ sqlite })(
    testOwnerIdBytes,
    allTimestamps,
  );
  expect(emptyResult).toEqual(ok([]));

  // Test 2: Insert some timestamps and verify they are found
  sqlite.exec(sql`
    insert into evolu_timestamp (ownerId, t)
    values (${testOwnerIdBytes}, ${timestamp1Bytes});
  `);

  sqlite.exec(sql`
    insert into evolu_timestamp (ownerId, t)
    values (${testOwnerIdBytes}, ${timestamp2Bytes});
  `);

  // Check for all three timestamps - only first two should be found
  const result = getExistingTimestamps({ sqlite })(
    testOwnerIdBytes,
    allTimestamps,
  );
  expect(result).toEqual(
    ok([timestamp1Bytes, timestamp2Bytes].map((t) => Buffer.from(t))),
  );

  const resultOtherOwner = getExistingTimestamps({ sqlite })(
    testOwnerIdBytes2,
    allTimestamps,
  );
  expect(resultOtherOwner).toEqual(ok([]));

  // Test 4: Test with single timestamp
  const singleResult = getExistingTimestamps({ sqlite })(testOwnerIdBytes, [
    timestamp1Bytes,
  ]);

  expect(singleResult).toEqual(
    ok([timestamp1Bytes].map((t) => Buffer.from(t))),
  );
});

test("applyBulkUpdate updates rows matching WHERE clause", async () => {
  const { applyBulkUpdate } = await import("../src/Evolu/Sync.js");
  const sqlite = await testCreateSqlite();

  // Create a local-only table
  sqlite.exec(sql`
    create table "_localTable" (
      "id" text primary key,
      "value" text,
      "status" text,
      "createdAt" text,
      "updatedAt" text
    );
  `);

  // Insert test data
  sqlite.exec(sql`
    insert into "_localTable" ("id", "value", "status", "createdAt", "updatedAt")
    values ('id1', 'val1', 'active', '2024-01-01', '2024-01-01');
  `);
  sqlite.exec(sql`
    insert into "_localTable" ("id", "value", "status", "createdAt", "updatedAt")
    values ('id2', 'val2', 'inactive', '2024-01-01', '2024-01-01');
  `);
  sqlite.exec(sql`
    insert into "_localTable" ("id", "value", "status", "createdAt", "updatedAt")
    values ('id3', 'val3', 'active', '2024-01-01', '2024-01-01');
  `);

  const deps = { sqlite, time: testTime };

  // Update all active rows
  const result = applyBulkUpdate(deps)({
    table: "_localTable",
    values: { value: "updated" },
    where: [{ column: "status", op: "=", value: "active" }],
  });

  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value).toBe(2); // Two rows match 'active'
  }

  // Verify the updates
  const queryResult = sqlite.exec(
    sql`select * from "_localTable" order by "id";`,
  );
  expect(queryResult.ok).toBe(true);
  if (queryResult.ok) {
    const rows = queryResult.value.rows;
    expect(rows[0]).toMatchObject({ id: "id1", value: "updated" });
    expect(rows[1]).toMatchObject({ id: "id2", value: "val2" }); // Unchanged
    expect(rows[2]).toMatchObject({ id: "id3", value: "updated" });
  }
});

test("applyBulkUpdate with multiple WHERE conditions", async () => {
  const { applyBulkUpdate } = await import("../src/Evolu/Sync.js");
  const sqlite = await testCreateSqlite();

  sqlite.exec(sql`
    create table "_test" (
      "id" text primary key,
      "category" text,
      "count" integer,
      "updatedAt" text
    );
  `);

  sqlite.exec(sql`
    insert into "_test" ("id", "category", "count", "updatedAt")
    values ('id1', 'A', 5, '2024-01-01');
  `);
  sqlite.exec(sql`
    insert into "_test" ("id", "category", "count", "updatedAt")
    values ('id2', 'A', 15, '2024-01-01');
  `);
  sqlite.exec(sql`
    insert into "_test" ("id", "category", "count", "updatedAt")
    values ('id3', 'B', 5, '2024-01-01');
  `);

  const deps = { sqlite, time: testTime };

  // Update rows where category = 'A' AND count < 10
  const result = applyBulkUpdate(deps)({
    table: "_test",
    values: { count: 100 },
    where: [
      { column: "category", op: "=", value: "A" },
      { column: "count", op: "<", value: 10 },
    ],
  });

  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value).toBe(1); // Only id1 matches both conditions
  }

  const queryResult = sqlite.exec(sql`select * from "_test" order by "id";`);
  if (queryResult.ok) {
    const rows = queryResult.value.rows;
    expect(rows[0]).toMatchObject({ id: "id1", count: 100 });
    expect(rows[1]).toMatchObject({ id: "id2", count: 15 }); // Unchanged
    expect(rows[2]).toMatchObject({ id: "id3", count: 5 }); // Unchanged
  }
});

test("applyBulkUpdate with empty WHERE clause updates all rows", async () => {
  const { applyBulkUpdate } = await import("../src/Evolu/Sync.js");
  const sqlite = await testCreateSqlite();

  sqlite.exec(sql`
    create table "_items" (
      "id" text primary key,
      "active" integer,
      "updatedAt" text
    );
  `);

  sqlite.exec(sql`
    insert into "_items" ("id", "active", "updatedAt")
    values ('id1', 1, '2024-01-01');
  `);
  sqlite.exec(sql`
    insert into "_items" ("id", "active", "updatedAt")
    values ('id2', 0, '2024-01-01');
  `);

  const deps = { sqlite, time: testTime };

  // Update all rows (empty WHERE clause)
  const result = applyBulkUpdate(deps)({
    table: "_items",
    values: { active: 0 },
    where: [],
  });

  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value).toBe(2); // All rows updated
  }

  const queryResult = sqlite.exec(sql`select * from "_items" order by "id";`);
  if (queryResult.ok) {
    const rows = queryResult.value.rows;
    expect(rows[0]).toMatchObject({ id: "id1", active: 0 });
    expect(rows[1]).toMatchObject({ id: "id2", active: 0 });
  }
});

// Sync is integration-tested in `Db.test.ts`.
