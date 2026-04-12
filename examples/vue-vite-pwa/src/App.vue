<script setup lang="ts">
import * as Evolu from "@evolu/common";
import { createEvoluDeps, createRun } from "@evolu/web";
import { createUseEvolu, provideEvolu, useQuery } from "@evolu/vue";
import { ref } from "vue";

const Schema = {
  todo: {
    id: Evolu.id("Todo"),
    title: Evolu.NonEmptyTrimmedString100,
    isCompleted: Evolu.nullOr(Evolu.SqliteBoolean),
  },
} satisfies Evolu.EvoluSchema;

const createAppQuery = Evolu.createQueryBuilder(Schema);

const todosQuery = createAppQuery((db) =>
  db
    .selectFrom("todo")
    .select(["id", "title", "isCompleted"])
    .where("isDeleted", "is not", Evolu.sqliteTrue)
    .where("title", "is not", null)
    .$narrowType<{ title: Evolu.KyselyNotNull }>()
    .orderBy("createdAt"),
);

type TodoRow = typeof todosQuery.Row;

const deps = createEvoluDeps();

deps.evoluError.subscribe(() => {
  const error = deps.evoluError.get();
  if (!error) return;

  alert("Evolu error occurred. Check the console.");
});

const run = createRun(deps);

const evolu = await run.orThrow(
  Evolu.createEvolu(Schema, {
    appName: Evolu.AppName.orThrow("vue-vite-pwa-minimal"),
    appOwner: Evolu.testAppOwner,

    ...(import.meta.env.DEV && {
      transports: [{ type: "WebSocket", url: "ws://localhost:4000" }],
    }),
  }),
);

provideEvolu(evolu);

const useAppEvolu = createUseEvolu(evolu);
const appEvolu = useAppEvolu();

const todos = useQuery(todosQuery);

const newTodoTitle = ref("");
const showMnemonic = ref(false);

const parseTodoTitle = (value: string) =>
  Evolu.NonEmptyTrimmedString100.from(value.trim());

const addTodo = () => {
  const result = parseTodoTitle(newTodoTitle.value);
  if (!result.ok) {
    alert(formatTypeError(result.error));
    return;
  }

  appEvolu.insert(
    "todo",
    {
      title: result.value,
    },
    {
      onComplete: () => {
        newTodoTitle.value = "";
      },
    },
  );
};

const toggleTodo = (id: TodoRow["id"], isCompleted: TodoRow["isCompleted"]) => {
  appEvolu.update("todo", {
    id,
    isCompleted: Evolu.booleanToSqliteBoolean(!(isCompleted === 1)),
  });
};

const renameTodo = (id: TodoRow["id"], title: TodoRow["title"]) => {
  const nextTitle = window.prompt("Edit todo", title);
  if (nextTitle == null) return;

  const result = parseTodoTitle(nextTitle);
  if (!result.ok) {
    alert(formatTypeError(result.error));
    return;
  }

  appEvolu.update("todo", { id, title: result.value });
};

const deleteTodo = (id: TodoRow["id"]) => {
  appEvolu.update("todo", {
    id,
    isDeleted: Evolu.sqliteTrue,
  });
};

const restoreFromMnemonic = () => {
  const mnemonic = window.prompt("Enter your mnemonic to restore your data:");
  if (mnemonic == null) return;

  const result = Evolu.Mnemonic.from(mnemonic.trim());
  if (!result.ok) {
    alert(formatTypeError(result.error));
    return;
  }

  alert("Restore AppOwner is not implemented in this example yet.");
};

const resetAppOwner = () => {
  alert("Reset AppOwner is not implemented in this example yet.");
};

const downloadDatabase = () => {
  void appEvolu.exportDatabase().then((data) => {
    const objectUrl = URL.createObjectURL(
      new Blob([data], { type: "application/x-sqlite3" }),
    );
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = `${appEvolu.name}.sqlite3`;
    link.click();

    setTimeout(() => {
      URL.revokeObjectURL(objectUrl);
    }, 1000);
  });
};

const formatTypeError = Evolu.createFormatTypeError<
  Evolu.MinLengthError | Evolu.MaxLengthError
>((error): string => {
  switch (error.type) {
    case "MinLength":
      return `Text must be at least ${error.min} character${error.min === 1 ? "" : "s"} long`;
    case "MaxLength":
      return `Text is too long (maximum ${error.max} characters)`;
  }
});
</script>

<template>
  <main class="page">
    <section class="card">
      <h1>Minimal Todo App (Evolu + Vue + Vite + PWA)</h1>

      <div class="add-row">
        <input
          v-model="newTodoTitle"
          type="text"
          placeholder="Add a new todo..."
          @keydown.enter="addTodo"
        />
        <button @click="addTodo">Add</button>
      </div>

      <ul>
        <li v-for="todo in todos" :key="todo.id">
          <label>
            <input
              type="checkbox"
              :checked="todo.isCompleted === 1"
              @change="toggleTodo(todo.id, todo.isCompleted)"
            />
            <span :class="{ completed: todo.isCompleted === 1 }">{{ todo.title }}</span>
          </label>

          <div class="actions">
            <button @click="renameTodo(todo.id, todo.title)">Rename</button>
            <button @click="deleteTodo(todo.id)">Delete</button>
          </div>
        </li>
      </ul>
    </section>

    <section class="card">
      <h2>Account</h2>

      <p>
        Todos are stored in local SQLite. When you sync across devices, your
        data is end-to-end encrypted using your mnemonic.
      </p>

      <div class="actions">
        <button @click="showMnemonic = !showMnemonic">
          {{ showMnemonic ? "Hide" : "Show" }} Mnemonic
        </button>
        <button @click="restoreFromMnemonic">Restore from Mnemonic</button>
        <button @click="resetAppOwner">Reset All Data</button>
        <button @click="downloadDatabase">Download Backup</button>
      </div>

      <textarea
        v-if="showMnemonic"
        :value="appEvolu.appOwner.mnemonic"
        readonly
        rows="3"
      />
    </section>
  </main>
</template>

<style>
.page {
  margin: 0 auto;
  max-width: 720px;
  padding: 1rem;
}

.card {
  margin-bottom: 1rem;
  border: 1px solid #ccc;
  border-radius: 8px;
  padding: 1rem;
  text-align: left;
}

.add-row {
  display: grid;
  gap: 0.5rem;
  grid-template-columns: 1fr auto;
  margin-bottom: 1rem;
}

ul {
  display: grid;
  gap: 0.5rem;
  list-style: none;
  margin: 0;
  padding: 0;
}

li {
  align-items: center;
  display: flex;
  justify-content: space-between;
}

label {
  align-items: center;
  display: flex;
  gap: 0.5rem;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.completed {
  text-decoration: line-through;
}

textarea {
  margin-top: 1rem;
  width: 100%;
}
</style>
