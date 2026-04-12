import type { CreateSqliteDriver, SqliteRow } from "@evolu/common";
import {
  createNativeSqliteDriver,
  type LynxNativeSqliteAdapter,
  type LynxNativeSqliteConnection,
} from "@evolu/lynx";

type NativeHandle = string | number;

interface EvoluSqliteNativeModule {
  readonly openSync: (
    name: string,
    options?: {
      readonly mode?: "memory" | "encrypted";
      readonly encryptionKeyHex?: string;
    },
  ) => NativeHandle;

  readonly execSync: (
    handle: NativeHandle,
    sql: string,
    parameters: ReadonlyArray<unknown>,
  ) => {
    readonly rows?: ReadonlyArray<Record<string, unknown>>;
    readonly changes?: number;
    readonly rowsAffected?: number;
  };

  readonly exportSync?: (handle: NativeHandle) => Uint8Array | ArrayBuffer;
  readonly closeSync: (handle: NativeHandle) => void;
}

interface GlobalWithNativeSqlite {
  __evoluNativeSqliteAdapter?: LynxNativeSqliteAdapter;
  NativeModules?: {
    EvoluSqlite?: EvoluSqliteNativeModule;
  };
}

const createAdapterFromNativeModule = (
  nativeModule: EvoluSqliteNativeModule,
): LynxNativeSqliteAdapter => ({
  openSync: (name, options): LynxNativeSqliteConnection => {
    const handle = nativeModule.openSync(name, options);

    return {
      execSync: (sql, parameters) => {
        const result = nativeModule.execSync(handle, sql, parameters);
        return {
          rows: result.rows as ReadonlyArray<SqliteRow> | undefined,
          changes: result.changes,
          rowsAffected: result.rowsAffected,
        };
      },
      exportSync: nativeModule.exportSync
        ? () => {
            const exportSync = nativeModule.exportSync;
            if (!exportSync) throw new Error("exportSync is unavailable.");
            return exportSync(handle);
          }
        : undefined,
      closeSync: () => {
        nativeModule.closeSync(handle);
      },
    };
  },
});

/**
 * Resolves native sqlite driver from Lynx global runtime hooks.
 *
 * Supported hooks:
 * - globalThis.__evoluNativeSqliteAdapter
 * - globalThis.NativeModules.EvoluSqlite
 */
export const resolveNativeSqliteDriver = (): CreateSqliteDriver | null => {
  const globalScope = globalThis as typeof globalThis & GlobalWithNativeSqlite;

  if (globalScope.__evoluNativeSqliteAdapter) {
    return createNativeSqliteDriver(globalScope.__evoluNativeSqliteAdapter);
  }

  const nativeModule = globalScope.NativeModules?.EvoluSqlite;
  if (nativeModule) {
    return createNativeSqliteDriver(createAdapterFromNativeModule(nativeModule));
  }

  return null;
};
