import { Injectable, OnDestroy, inject, signal } from "@angular/core";
import * as Evolu from "@evolu/common";
import { EVOLU, EVOLU_ERROR } from "./app.config";
import { formatTypeError } from "./error-formatter";
import { Schema, TodoId } from "./schema";

const createAppQuery = Evolu.createQueryBuilder(Schema);

const todosQuery = createAppQuery((db) =>
  db
    .selectFrom("todo")
    .select(["id", "title", "isCompleted"])
    .where("isDeleted", "is not", Evolu.sqliteTrue)
    .where("title", "is not", null)
    .orderBy("createdAt"),
);

type TodoRow = typeof todosQuery.Row;

const parseTodoTitle = (value: string) =>
  Evolu.NonEmptyString100.from(value.trim());

@Injectable({ providedIn: "root" })
export class AppService implements OnDestroy {
  private readonly evolu = inject(EVOLU);
  private readonly evoluError = inject(EVOLU_ERROR);
  private readonly unsubscribes: Array<() => void> = [];

  readonly todos = signal<Array<TodoRow>>([]);

  readonly mnemonic = signal<string | null>(null);

  readonly isLoading = signal(true);

  constructor() {
    this.initializeData();
    this.initializeAppOwner();
    this.initializeGlobalErrorHandling();
  }

  ngOnDestroy(): void {
    this.unsubscribes.forEach((unsubscribe) => unsubscribe());
  }

  /** Todos */

  addTodo(title: string) {
    const parsedTitle = parseTodoTitle(title);
    if (!parsedTitle.ok) {
      alert(formatTypeError(parsedTitle.error));
      return;
    }

    this.evolu.insert("todo", {
      title: parsedTitle.value,
    });
  }

  renameTodo(id: string, title: string) {
    const parsedTitle = parseTodoTitle(title);
    if (!parsedTitle.ok) {
      alert(formatTypeError(parsedTitle.error));
      return;
    }

    this.evolu.update("todo", {
      id: id as TodoId,
      title: parsedTitle.value,
    });
  }

  toggleTodo(id: string, isCompleted: boolean) {
    this.evolu.update("todo", {
      id: id as TodoId,
      isCompleted: Evolu.booleanToSqliteBoolean(isCompleted),
    });
  }

  deleteTodo(id: string) {
    this.evolu.update("todo", {
      id: id as TodoId,
      isDeleted: Evolu.sqliteTrue,
    });
  }

  /** App owner */

  async restoreFromMnemonic(mnemonic: string): Promise<void> {
    const trimmedMnemonic = mnemonic.trim();
    if (!trimmedMnemonic) {
      return;
    }

    const mnemonicResult = Evolu.Mnemonic.from(trimmedMnemonic);
    if (!mnemonicResult.ok) {
      alert(formatTypeError(mnemonicResult.error));
      return;
    }

    alert("Restore AppOwner is not implemented in this example yet.");
  }

  async resetAppOwner(): Promise<void> {
    alert("Reset AppOwner is not implemented in this example yet.");
  }

  /** Database */

  async downloadDatabase(): Promise<void> {
    try {
      const array = await this.evolu.exportDatabase();
      const blob = new Blob([array.slice()], {
        type: "application/x-sqlite3",
      });
      const element = document.createElement("a");
      document.body.appendChild(element);
      element.href = window.URL.createObjectURL(blob);
      element.download = "db.sqlite3";
      element.addEventListener("click", () => {
        setTimeout(() => {
          window.URL.revokeObjectURL(element.href);
          element.remove();
        }, 1000);
      });
      element.click();
    } catch (error) {
      console.error("Failed to download database:", error);
    }
  }

  /** App lifecycle */

  private initializeData(): void {
    const unsubscribe = this.evolu.subscribeQuery(todosQuery)(() => {
      this.todos.set([...this.evolu.getQueryRows(todosQuery)]);
    });
    this.unsubscribes.push(unsubscribe);

    this.evolu
      .loadQuery(todosQuery)
      .then((rows) => {
        this.todos.set([...rows]);
      })
      .catch((error) => {
        console.error("Failed to load data:", error);
      })
      .finally(() => this.isLoading.set(false));
  }

  private initializeAppOwner(): void {
    this.mnemonic.set(this.evolu.appOwner.mnemonic ?? null);
  }

  private initializeGlobalErrorHandling(): void {
    // Subscribe to global Evolu errors
    const unsubscribeError = this.evoluError.subscribe(() => {
      const error = this.evoluError.get();
      if (!error) return;

      console.error("Evolu error:", error);
      alert("🚨 Evolu error occurred! Check the console.");
    });

    this.unsubscribes.push(unsubscribeError);
  }
}
