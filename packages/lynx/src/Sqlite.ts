import type { CreateSqliteDriver, SqliteRow } from "@evolu/common";
import { bytesToHex, createPreparedStatementsCache, ok } from "@evolu/common";
import sqlite3InitModule, {
  type Database,
  type PreparedStatement,
} from "@evolu/sqlite-wasm";

type Sqlite3Module = Awaited<ReturnType<typeof sqlite3InitModule>>;

const createPersistentStorageError = (
  message: string,
  cause?: unknown,
): Error => {
  const error = new Error(message);
  if (cause !== undefined) {
    (error as Error & { cause?: unknown }).cause = cause;
  }
  return error;
};

const getMissingOpfsApis = (): Array<string> => {
  const globalScope = globalThis as typeof globalThis & {
    navigator?: { storage?: { getDirectory?: () => Promise<unknown> } };
    FileSystemHandle?: unknown;
    FileSystemDirectoryHandle?: unknown;
    FileSystemFileHandle?: { prototype?: { createSyncAccessHandle?: unknown } };
  };

  const missing = [] as Array<string>;
  if (globalScope.FileSystemHandle == null) missing.push("FileSystemHandle");
  if (globalScope.FileSystemDirectoryHandle == null)
    missing.push("FileSystemDirectoryHandle");
  if (globalScope.FileSystemFileHandle == null)
    missing.push("FileSystemFileHandle");

  if (
    typeof globalScope.FileSystemFileHandle?.prototype?.createSyncAccessHandle !==
    "function"
  ) {
    missing.push("FileSystemFileHandle.prototype.createSyncAccessHandle");
  }

  if (typeof globalScope.navigator?.storage?.getDirectory !== "function") {
    missing.push("navigator.storage.getDirectory");
  }

  return missing;
};

const supportsOpfsApis = (): boolean => {
  return getMissingOpfsApis().length === 0;
};

const ensureFetchForSqliteWasm = (): boolean => {
  const globalScope = globalThis as typeof globalThis & {
    lynx?: { fetch?: (...args: Array<unknown>) => Promise<unknown> };
  };

  if (typeof globalScope.fetch === "function") return true;

  const lynxFetch = globalScope.lynx?.fetch;
  if (typeof lynxFetch !== "function") return false;

  (globalThis as { fetch?: (...args: Array<unknown>) => Promise<unknown> }).fetch =
    (...args: Array<unknown>) => lynxFetch.apply(globalScope.lynx, args);

  return true;
};

let sqlite3Promise: Promise<Sqlite3Module> | undefined;

const getSqlite3 = async (): Promise<Sqlite3Module> => {
  // Lynx may expose `lynx.fetch` after startup, so bridge fetch right before
  // first module init instead of doing eager init at import time.
  if (!ensureFetchForSqliteWasm()) {
    await Promise.resolve();
    if (!ensureFetchForSqliteWasm()) {
      throw createPersistentStorageError(
        "SQLite WASM cannot be initialized because fetch is unavailable in this Lynx runtime.",
      );
    }
  }

  if (!sqlite3Promise) {
    sqlite3Promise = sqlite3InitModule().catch((error) => {
      sqlite3Promise = undefined;
      throw createPersistentStorageError(
        "Failed to initialize sqlite-wasm in Lynx runtime. For native targets, use createEvoluDeps({ native: { createSqliteDriver, ... } }) or createEvoluDeps({ nativeFallback: { createSqliteDriver, ... } }).",
        error,
      );
    });
  }

  return sqlite3Promise;
};

const createMemoryDb = (sqlite3: Sqlite3Module): Database =>
  new sqlite3.oo1.DB(":memory:");

const createPersistentDbWithWasmfs = (
  sqlite3: Sqlite3Module,
  name: string,
  options?: { readonly mode: "encrypted"; readonly encryptionKey: Uint8Array },
): Database | null => {
  const sqlite3Capi = sqlite3.capi as typeof sqlite3.capi & {
    sqlite3_wasmfs_opfs_dir?: () => string;
  };

  const wasmfsOpfsDir = sqlite3Capi.sqlite3_wasmfs_opfs_dir?.();
  if (!wasmfsOpfsDir) return null;

  const db = new sqlite3.oo1.DB(`${wasmfsOpfsDir}/${name}.sqlite3`);

  if (options?.mode === "encrypted") {
    db.exec(`
      PRAGMA cipher = 'sqlcipher';
      PRAGMA key = "x'${bytesToHex(options.encryptionKey)}'";
    `);
  }

  return db;
};

const createOpfsDb = async (
  sqlite3: Sqlite3Module,
  name: string,
  options?: { readonly mode: "encrypted"; readonly encryptionKey: Uint8Array },
): Promise<Database> => {
  const hasOpfsApis = supportsOpfsApis();
  let opfsError: unknown;

  if (hasOpfsApis) {
    try {
      const pool = await sqlite3.installOpfsSAHPoolVfs(
        options?.mode === "encrypted" ? { directory: `.${name}` } : { name },
      );

      if (options?.mode === "encrypted") {
        const db = new pool.OpfsSAHPoolDb(
          "file:evolu1.db?vfs=multipleciphers-opfs-sahpool",
        );
        db.exec(`
          PRAGMA cipher = 'sqlcipher';
          PRAGMA key = "x'${bytesToHex(options.encryptionKey)}'";
        `);
        return db;
      }

      return new pool.OpfsSAHPoolDb("file:evolu1.db");
    } catch (error) {
      opfsError = error;
    }
  }

  const wasmfsDb = createPersistentDbWithWasmfs(sqlite3, name, options);
  if (wasmfsDb) return wasmfsDb;

  if (!hasOpfsApis) {
    const missingApis = getMissingOpfsApis();
    throw createPersistentStorageError(
      `Missing required OPFS APIs in this Lynx runtime (${missingApis.join(", ")}). This sqlite-wasm build requires SyncAccessHandle-based OPFS support for OPFS VFS and no WASMFS/OPFS persistent directory is available. Web target requires OPFS-capable browser worker context; native target should use createEvoluDeps({ native: { createSqliteDriver, ... } }) or createEvoluDeps({ nativeFallback: { createSqliteDriver, ... } }).`,
    );
  }

  throw createPersistentStorageError(
    "Failed to initialize OPFS SQLite storage in Lynx runtime.",
    opfsError,
  );
};

// @ts-expect-error Missing types.
globalThis.sqlite3ApiConfig = {
  warn: (arg: unknown) => {
    // Ignore irrelevant warning.
    // https://github.com/sqlite/sqlite-wasm/issues/62
    if (
      typeof arg === "string" &&
      arg.startsWith("Ignoring inability to install OPFS sqlite3_vfs")
    )
      return;
    // eslint-disable-next-line no-console
    console.warn(arg);
  },
};

/** Creates SQLite WASM driver with OPFS support for web runtimes. */
export const createWasmSqliteDriver: CreateSqliteDriver =
  (name, options) => async () => {
    const sqlite3 = await getSqlite3();
    // This is used to make OPFS default vfs for multipleciphers.
    const sqlite3Capi = sqlite3.capi as typeof sqlite3.capi & {
      sqlite3mc_vfs_create?: (name: string, makeDefault: number) => void;
    };

    try {
      sqlite3Capi.sqlite3mc_vfs_create?.("opfs", 1);
    } catch {
      // Ignore and continue. We enforce OPFS support in createOpfsDb.
    }

    const stack = new globalThis.DisposableStack();
    let db: Database;
    switch (options?.mode) {
      case "memory":
        db = createMemoryDb(sqlite3);
        break;
      case "encrypted": {
        db = await createOpfsDb(sqlite3, name, options);
        break;
      }
      default: {
        db = await createOpfsDb(sqlite3, name);
      }
    }

    db = stack.adopt(db, (db) => {
      db.close();
    });

    const cache = stack.use(
      createPreparedStatementsCache<PreparedStatement>(
        (sql) => db.prepare(sql),
        (statement) => {
          statement.finalize();
        },
      ),
    );

    return ok({
      exec: (query) => {
        const prepared = cache.get(query);

        if (prepared) {
          if (query.parameters.length > 0) prepared.bind(query.parameters);

          const rows = [];
          while (prepared.step()) {
            rows.push(prepared.get({}));
          }
          prepared.reset();

          return {
            rows: rows as ReadonlyArray<SqliteRow>,
            changes: db.changes(),
          };
        }

        const rows = db.exec(query.sql, {
          returnValue: "resultRows",
          rowMode: "object",
          bind: query.parameters,
        }) as ReadonlyArray<SqliteRow>;

        const changes = db.changes();

        return { rows, changes };
      },

      export: () => sqlite3.capi.sqlite3_js_db_export(db),

      [Symbol.dispose]: () => {
        stack.dispose();
      },
    });
  };

/**
 * Result returned from native SQLite sync execution.
 */
export interface LynxNativeSqliteExecResult {
  readonly rows?: ReadonlyArray<SqliteRow>;
  readonly changes?: number;
  readonly rowsAffected?: number;
}

/**
 * A single native SQLite connection used by `createNativeSqliteDriver`.
 */
export interface LynxNativeSqliteConnection {
  readonly execSync: (
    sql: string,
    parameters: ReadonlyArray<unknown>,
  ) => LynxNativeSqliteExecResult;
  readonly exportSync?: () => Uint8Array | ArrayBuffer;
  readonly closeSync: () => void;
}

/**
 * Native SQLite adapter used to build a Evolu-compatible driver.
 */
export interface LynxNativeSqliteAdapter {
  readonly openSync: (
    name: string,
    options?: {
      readonly mode?: "memory" | "encrypted";
      readonly encryptionKeyHex?: string;
    },
  ) => LynxNativeSqliteConnection;
}

const toTransferableBytes = (
  data: Uint8Array | ArrayBuffer,
): Uint8Array<ArrayBuffer> => {
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }

  if (
    data.byteOffset === 0 &&
    data.byteLength === data.buffer.byteLength &&
    data.buffer instanceof ArrayBuffer
  ) {
    return data as Uint8Array<ArrayBuffer>;
  }

  return new Uint8Array(data);
};

/**
 * Creates SQLite driver from native sync adapter (for Lynx native runtimes).
 */
export const createNativeSqliteDriver = (
  adapter: LynxNativeSqliteAdapter,
): CreateSqliteDriver =>
  (name, options) => () => {
    const stack = new globalThis.DisposableStack();

    const connectionOptions =
      options?.mode === "encrypted"
        ? {
            mode: "encrypted" as const,
            encryptionKeyHex: bytesToHex(options.encryptionKey),
          }
        : options?.mode === "memory"
          ? { mode: "memory" as const }
          : undefined;

    const connection = stack.adopt(
      adapter.openSync(name, connectionOptions),
      (connection) => {
        connection.closeSync();
      },
    );

    return ok({
      exec: (query) => {
        const result = connection.execSync(query.sql, query.parameters);
        const rows = result.rows ?? [];
        const changes = result.changes ?? result.rowsAffected ?? 0;
        return { rows, changes };
      },

      export: () => {
        const data = connection.exportSync?.();
        if (!data) {
          throw new Error(
            "Native SQLite driver does not implement exportSync().",
          );
        }
        return toTransferableBytes(data);
      },

      [Symbol.dispose]: () => {
        stack.dispose();
      },
    });
  };
