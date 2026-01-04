/**
 * Example demonstrating SQLite Generated Columns with Evolu
 *
 * Generated columns (SQLite's GENERATED ALWAYS AS) are computed automatically
 * from other columns. They're useful for:
 * - Extracting JSON fields for efficient indexing and querying
 * - Computing derived values (e.g., full name from first + last name)
 * - Data validation via constraints on generated columns
 *
 * This example shows the "document database" pattern where JSON payloads
 * are stored in a single column while specific fields are extracted into
 * generated columns for efficient querying.
 */

import * as Evolu from "@evolu/common";
import { createUseEvolu, EvoluProvider, useQuery } from "@evolu/react";
import { evoluReactWebDeps } from "@evolu/react-web";
import { FC, Suspense, useState } from "react";

// =============================================================================
// Schema Definition with Generated Columns
// =============================================================================

const NoteId = Evolu.id("Note");
type NoteId = typeof NoteId.Type;

// Define the JSON structure for validation
const NotePayload = Evolu.object({
  type: Evolu.String, // "idea", "task", "reference"
  priority: Evolu.optional(Evolu.Int), // 1-5, optional
  content: Evolu.String,
  tags: Evolu.optional(Evolu.array(Evolu.String)),
});
type NotePayload = typeof NotePayload.Type;

// Create JSON type for the payload column
const [NotePayloadJson] = Evolu.json(NotePayload);

/**
 * Schema with generated columns.
 *
 * The `payload` column stores the full JSON document, while generated columns
 * extract specific fields for efficient querying and indexing.
 *
 * Key concepts:
 * - `generatedAs(type, expression)` creates a VIRTUAL column (computed on read)
 * - `generatedAs(type, expression, { stored: true })` creates a STORED column
 * - Generated columns cannot be mutated - they're excluded from insert/update
 * - Use `json_extract()` to extract values from JSON columns
 */
const Schema = {
  note: {
    id: NoteId,
    // The full JSON payload - this is the only column we write to
    payload: NotePayloadJson,

    // Generated column: extracts 'type' from JSON for filtering
    // VIRTUAL by default - computed on read, no storage overhead
    noteType: Evolu.generatedAs(
      Evolu.nullOr(Evolu.String),
      "json_extract(payload, '$.type')",
    ),

    // Generated column: extracts 'priority' for sorting/filtering
    notePriority: Evolu.generatedAs(
      Evolu.nullOr(Evolu.Int),
      "json_extract(payload, '$.priority')",
    ),

    // Generated column: extracts 'content' for full-text search potential
    noteContent: Evolu.generatedAs(
      Evolu.nullOr(Evolu.String),
      "json_extract(payload, '$.content')",
    ),
  },
};

// =============================================================================
// Evolu Setup
// =============================================================================

const evolu = Evolu.createEvolu(evoluReactWebDeps)(Schema, {
  name: Evolu.SimpleName.orThrow("generated-columns-example"),
  reloadUrl: "/",
  ...(process.env.NODE_ENV === "development" && {
    transports: [{ type: "WebSocket", url: "ws://localhost:4000" }],
  }),
  // Create index on generated columns for efficient queries
  indexes: (create) => [
    create("note_type_idx").on("note").column("noteType"),
    create("note_priority_idx").on("note").column("notePriority"),
  ],
});

const useEvolu = createUseEvolu(evolu);

evolu.subscribeError(() => {
  const error = evolu.getError();
  if (!error) return;
  console.error("Evolu error:", error);
});

// =============================================================================
// Queries using Generated Columns
// =============================================================================

// Query all notes, using generated columns for display
const allNotesQuery = evolu.createQuery((db) =>
  db
    .selectFrom("note")
    .select(["id", "payload", "noteType", "notePriority", "noteContent"])
    .where("isDeleted", "is not", Evolu.sqliteTrue)
    .orderBy("notePriority", "desc")
    .orderBy("createdAt", "desc"),
);

// Query only high-priority notes (priority >= 4)
// This query is efficient because notePriority is a generated column that can be indexed
const highPriorityQuery = evolu.createQuery((db) =>
  db
    .selectFrom("note")
    .select(["id", "payload", "noteType", "notePriority"])
    .where("isDeleted", "is not", Evolu.sqliteTrue)
    .where("notePriority", ">=", 4)
    .orderBy("notePriority", "desc"),
);

// Query notes by type
const taskNotesQuery = evolu.createQuery((db) =>
  db
    .selectFrom("note")
    .select(["id", "payload", "noteType", "notePriority"])
    .where("isDeleted", "is not", Evolu.sqliteTrue)
    .where("noteType", "=", "task")
    .orderBy("notePriority", "desc"),
);

// =============================================================================
// Components
// =============================================================================

export const GeneratedColumnsExample: FC = () => {
  return (
    <div className="min-h-screen px-8 py-8">
      <div className="mx-auto max-w-2xl">
        <h1 className="mb-2 text-2xl font-bold">
          Generated Columns Example (Document Database Pattern)
        </h1>
        <p className="mb-6 text-gray-600">
          Store JSON documents and extract fields into generated columns for
          efficient querying.
        </p>

        <EvoluProvider value={evolu}>
          <Suspense fallback={<div>Loading...</div>}>
            <AddNote />
            <div className="mt-8 space-y-8">
              <NotesSection title="All Notes" query={allNotesQuery} />
              <NotesSection
                title="High Priority (≥4)"
                query={highPriorityQuery}
              />
              <NotesSection title="Tasks Only" query={taskNotesQuery} />
            </div>
          </Suspense>
        </EvoluProvider>
      </div>
    </div>
  );
};

const AddNote: FC = () => {
  const { insert } = useEvolu();
  const [type, setType] = useState<"idea" | "task" | "reference">("idea");
  const [priority, setPriority] = useState(3);
  const [content, setContent] = useState("");

  const handleAdd = () => {
    if (!content.trim()) return;

    // We only insert into the `payload` column
    // The generated columns (noteType, notePriority, noteContent) are
    // automatically computed by SQLite
    const payload: NotePayload = {
      type,
      priority,
      content: content.trim(),
    };

    const result = insert("note", {
      payload: JSON.stringify(payload),
    });

    if (result.ok) {
      setContent("");
    } else {
      console.error("Insert error:", result.error);
    }
  };

  return (
    <div className="rounded-lg bg-white p-4 shadow-sm ring-1 ring-gray-200">
      <h2 className="mb-4 font-semibold">Add New Note</h2>

      <div className="space-y-4">
        <div className="flex gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Type
            </label>
            <select
              value={type}
              onChange={(e) =>
                setType(e.target.value as "idea" | "task" | "reference")
              }
              className="mt-1 rounded-md border-gray-300 shadow-sm"
            >
              <option value="idea">💡 Idea</option>
              <option value="task">✅ Task</option>
              <option value="reference">📚 Reference</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">
              Priority (1-5)
            </label>
            <input
              type="number"
              min={1}
              max={5}
              value={priority}
              onChange={(e) => setPriority(Number(e.target.value))}
              className="mt-1 w-20 rounded-md border-gray-300 shadow-sm"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">
            Content
          </label>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Note content..."
            className="mt-1 w-full rounded-md border-gray-300 shadow-sm"
            rows={3}
          />
        </div>

        <button
          onClick={handleAdd}
          className="rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
        >
          Add Note
        </button>
      </div>
    </div>
  );
};

type NotesRow = typeof allNotesQuery.Row;

const NotesSection: FC<{
  title: string;
  query: Evolu.Query<NotesRow>;
}> = ({ title, query }) => {
  const notes = useQuery(query);

  return (
    <div>
      <h2 className="mb-3 text-lg font-semibold">
        {title} ({notes.length})
      </h2>

      {notes.length === 0 ? (
        <p className="text-gray-500">No notes found</p>
      ) : (
        <div className="space-y-2">
          {notes.map((note) => (
            <NoteCard key={note.id} note={note} />
          ))}
        </div>
      )}
    </div>
  );
};

const NoteCard: FC<{ note: NotesRow }> = ({ note }) => {
  const { update } = useEvolu();

  const typeEmoji =
    note.noteType === "idea"
      ? "💡"
      : note.noteType === "task"
        ? "✅"
        : note.noteType === "reference"
          ? "📚"
          : "📝";

  return (
    <div className="rounded-lg bg-white p-4 shadow-sm ring-1 ring-gray-200">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="mb-1 flex items-center gap-2">
            <span>{typeEmoji}</span>
            <span className="text-sm font-medium text-gray-500">
              {note.noteType}
            </span>
            {note.notePriority && (
              <span className="rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-700">
                Priority: {note.notePriority}
              </span>
            )}
          </div>
          <p className="text-gray-900">{note.noteContent}</p>
        </div>

        <button
          onClick={() => update("note", { id: note.id, isDeleted: 1 })}
          className="text-gray-400 hover:text-red-500"
        >
          Delete
        </button>
      </div>

      {/* Show the raw JSON payload for demonstration */}
      <details className="mt-2">
        <summary className="cursor-pointer text-xs text-gray-400">
          Raw JSON payload
        </summary>
        <pre className="mt-1 overflow-auto rounded bg-gray-100 p-2 text-xs">
          {JSON.stringify(JSON.parse(note.payload ?? "{}"), null, 2)}
        </pre>
      </details>
    </div>
  );
};

export default GeneratedColumnsExample;
