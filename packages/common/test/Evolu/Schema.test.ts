import { describe, expect, expectTypeOf, test } from "vitest";
import {
  evoluSchemaToDbSchema,
  insertable,
  updateable,
  upsertable,
  OmitGeneratedColumns,
} from "../../src/Evolu/Schema.js";
import { SqliteBoolean } from "../../src/Sqlite.js";
import {
  generatedAs,
  id,
  InferInput,
  Int,
  NonEmptyString,
  nullOr,
  String,
} from "../../src/Type.js";

const DocumentId = id("Document");

describe("generated columns", () => {
  const SchemaWithGeneratedColumns = {
    document: {
      id: DocumentId,
      payload: String,
      // Generated column: extracts 'type' from JSON for indexing/filtering
      docType: generatedAs(nullOr(String), "json_extract(payload, '$.type')"),
      // Generated column: extracts 'priority' for efficient queries
      priority: generatedAs(nullOr(Int), "json_extract(payload, '$.priority')"),
      // Generated column with STORED option
      storedValue: generatedAs(String, "upper(payload)", { stored: true }),
    },
  };

  test("evoluSchemaToDbSchema separates regular and generated columns", () => {
    const dbSchema = evoluSchemaToDbSchema(SchemaWithGeneratedColumns);

    expect(dbSchema.tables).toHaveLength(1);
    const table = dbSchema.tables[0];

    // Regular columns should not include generated columns
    expect(table.columns).toEqual(["payload"]);

    // Generated columns should be properly extracted
    expect(table.generatedColumns).toEqual([
      {
        name: "docType",
        expression: "json_extract(payload, '$.type')",
        isVirtual: true,
      },
      {
        name: "priority",
        expression: "json_extract(payload, '$.priority')",
        isVirtual: true,
      },
      {
        name: "storedValue",
        expression: "upper(payload)",
        isVirtual: false,
      },
    ]);
  });

  test("insertable excludes generated columns at type level", () => {
    const Insertable = insertable(SchemaWithGeneratedColumns.document);

    // Type-level test: generated columns should not be in the input type
    type InsertInput = InferInput<typeof Insertable>;

    // These should be available
    expectTypeOf<InsertInput>().toHaveProperty("payload");

    // These should NOT be available (generated columns)
    expectTypeOf<InsertInput>().not.toHaveProperty("docType");
    expectTypeOf<InsertInput>().not.toHaveProperty("priority");
    expectTypeOf<InsertInput>().not.toHaveProperty("storedValue");
  });

  test("updateable excludes generated columns at type level", () => {
    const Updateable = updateable(SchemaWithGeneratedColumns.document);

    type UpdateInput = InferInput<typeof Updateable>;

    // id and payload should be available
    expectTypeOf<UpdateInput>().toHaveProperty("id");
    expectTypeOf<UpdateInput>().toHaveProperty("payload");

    // Generated columns should NOT be available
    expectTypeOf<UpdateInput>().not.toHaveProperty("docType");
    expectTypeOf<UpdateInput>().not.toHaveProperty("priority");
    expectTypeOf<UpdateInput>().not.toHaveProperty("storedValue");
  });

  test("upsertable excludes generated columns at type level", () => {
    const Upsertable = upsertable(SchemaWithGeneratedColumns.document);

    type UpsertInput = InferInput<typeof Upsertable>;

    // id and payload should be available
    expectTypeOf<UpsertInput>().toHaveProperty("id");
    expectTypeOf<UpsertInput>().toHaveProperty("payload");

    // Generated columns should NOT be available
    expectTypeOf<UpsertInput>().not.toHaveProperty("docType");
    expectTypeOf<UpsertInput>().not.toHaveProperty("priority");
    expectTypeOf<UpsertInput>().not.toHaveProperty("storedValue");
  });

  test("OmitGeneratedColumns type utility works correctly", () => {
    type Props = typeof SchemaWithGeneratedColumns.document;
    type FilteredProps = OmitGeneratedColumns<Props>;

    // Should have regular columns
    expectTypeOf<FilteredProps>().toHaveProperty("id");
    expectTypeOf<FilteredProps>().toHaveProperty("payload");

    // Should NOT have generated columns
    expectTypeOf<FilteredProps>().not.toHaveProperty("docType");
    expectTypeOf<FilteredProps>().not.toHaveProperty("priority");
    expectTypeOf<FilteredProps>().not.toHaveProperty("storedValue");
  });
});

describe("schema without generated columns", () => {
  const SimpleSchema = {
    todo: {
      id: id("Todo"),
      title: NonEmptyString,
      isCompleted: nullOr(SqliteBoolean),
    },
  };

  test("evoluSchemaToDbSchema works normally without generated columns", () => {
    const dbSchema = evoluSchemaToDbSchema(SimpleSchema);

    expect(dbSchema.tables).toHaveLength(1);
    const table = dbSchema.tables[0];

    expect(table.columns).toEqual(["title", "isCompleted"]);
    expect(table.generatedColumns).toBeUndefined();
  });

  test("insertable works normally without generated columns", () => {
    const Insertable = insertable(SimpleSchema.todo);

    type InsertInput = InferInput<typeof Insertable>;

    expectTypeOf<InsertInput>().toHaveProperty("title");
    expectTypeOf<InsertInput>().not.toHaveProperty("id");
  });
});
