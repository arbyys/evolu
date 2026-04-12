import {
  createConsole,
  createConsoleStoreOutput,
  createInMemoryLeaderLock,
  createRandomBytes,
  createRun as createCommonRun,
  createWebSocket,
  type ConsoleDep,
  type CreateSqliteDriver,
  type CreateWebSocket,
  type RandomBytes,
  type ReloadApp,
} from "@evolu/common";
import type {
  CreateDbWorker,
  DbWorker,
  DbWorkerInit,
  EvoluDeps,
  SharedWorker as EvoluSharedWorker,
  SharedWorkerInput,
} from "@evolu/common/local-first";
import {
  createEvoluDeps as createCommonEvoluDeps,
  initSharedWorker,
  startDbWorker,
} from "@evolu/common/local-first";
import { reloadApp as webReloadApp } from "../Platform.js";
import {
  createInMemorySharedWorker,
  createInMemoryWorker,
  createMessageChannel,
  createMessagePort,
  createSharedWorker,
  createWorker,
} from "../Worker.js";
import { createWasmSqliteDriver } from "../Sqlite.js";

const inMemoryLeaderLock = createInMemoryLeaderLock();
const noopReloadApp: ReloadApp = () => {};

/**
 * Native runtime adapters required when Lynx cannot use web worker+WASM stack.
 */
export interface LynxNativeRuntimeDeps {
  readonly createSqliteDriver: CreateSqliteDriver;
  readonly reloadApp?: ReloadApp;
  readonly createWebSocket?: CreateWebSocket;
  readonly randomBytes?: RandomBytes;
}

/**
 * Options for Lynx {@link createEvoluDeps}.
 *
 * `native` switches to an in-memory worker pipeline and uses provided native
 * adapters.
 */
export interface CreateLynxEvoluDepsOptions extends Partial<ConsoleDep> {
  readonly native?: LynxNativeRuntimeDeps;

  /**
   * Native adapters used only when runtime is detected as native.
   *
   * This enables single-config apps where web uses OPFS/WASM and native uses
   * a custom SQLite driver (for example React Native-like integrations).
   */
  readonly nativeFallback?: LynxNativeRuntimeDeps;

  /**
   * Overrides default native-runtime detection used with `nativeFallback`.
   *
   * Return `true` for native runtime and `false` for web runtime.
   */
  readonly isNativeRuntime?: () => boolean;

  /** Forces in-memory workers even in web runtimes. */
  readonly forceInMemoryWorkers?: boolean;
}

interface InMemoryWorkerRuntimeDeps extends Partial<ConsoleDep> {
  readonly createSqliteDriver: CreateSqliteDriver;
  readonly createWebSocket: CreateWebSocket;
  readonly randomBytes: RandomBytes;
}

/** Creates Evolu dependencies for Lynx web and native runtimes. */
export const createEvoluDeps = (
  options: CreateLynxEvoluDepsOptions = {},
): EvoluDeps => {
  if (options.native) {
    return createNativeEvoluDeps({ ...options, native: options.native });
  }

  if (options.nativeFallback && resolveNativeRuntime(options)) {
    return createNativeEvoluDeps({
      ...options,
      native: options.nativeFallback,
    });
  }

  return createWebEvoluDeps(options);
};

const createWebEvoluDeps = (options: CreateLynxEvoluDepsOptions): EvoluDeps => {
  const useNativeDbWorker =
    !options.forceInMemoryWorkers && supportsDedicatedDbWorkerPipeline();
  const useNativeSharedWorker =
    !options.forceInMemoryWorkers && supportsSharedWorkerPipeline();

  const workerRuntimeDeps: InMemoryWorkerRuntimeDeps = {
    ...(options.console && { console: options.console }),
    createSqliteDriver: createWasmSqliteDriver,
    createWebSocket,
    randomBytes: createRandomBytes(),
  };

  const createDbWorker: CreateDbWorker = () => {
    if (!useNativeDbWorker) {
      return createInMemoryDbWorker(workerRuntimeDeps);
    }

    try {
      return createWorker<DbWorkerInit, never>(
        new Worker(new URL("Db.worker.js", import.meta.url), {
          type: "module",
        }),
      );
    } catch {
      return createInMemoryDbWorker(workerRuntimeDeps);
    }
  };

  const sharedWorker: EvoluSharedWorker = (() => {
    if (!useNativeSharedWorker) {
      return createInMemorySharedEvoluWorker(workerRuntimeDeps);
    }

    try {
      return createSharedWorker<SharedWorkerInput>(
        new SharedWorker(new URL("Shared.worker.js", import.meta.url), {
          type: "module",
        }),
      );
    } catch {
      return createInMemorySharedEvoluWorker(workerRuntimeDeps);
    }
  })();

  return createCommonEvoluDeps({
    ...(options.console && { console: options.console }),
    createDbWorker,
    createMessageChannel,
    reloadApp: webReloadApp,
    sharedWorker,
  });
};

const createNativeEvoluDeps = (
  options: CreateLynxEvoluDepsOptions & { native: LynxNativeRuntimeDeps },
): EvoluDeps => {
  const nativeWebSocket = options.native.createWebSocket ?? resolveWebSocket();
  const nativeRandomBytes = options.native.randomBytes ?? resolveRandomBytes();

  const workerRuntimeDeps: InMemoryWorkerRuntimeDeps = {
    ...(options.console && { console: options.console }),
    createSqliteDriver: options.native.createSqliteDriver,
    createWebSocket: nativeWebSocket,
    randomBytes: nativeRandomBytes,
  };

  const createDbWorker: CreateDbWorker = () =>
    createInMemoryDbWorker(workerRuntimeDeps);

  const sharedWorker = createInMemorySharedEvoluWorker(workerRuntimeDeps);

  return createCommonEvoluDeps({
    ...(options.console && { console: options.console }),
    createDbWorker,
    createMessageChannel,
    reloadApp: options.native.reloadApp ?? noopReloadApp,
    sharedWorker,
  });
};

const createInMemoryDbWorker = (deps: InMemoryWorkerRuntimeDeps): DbWorker =>
  createInMemoryWorker<DbWorkerInit, never>((self) => {
    const run = createWorkerRun(deps);
    void run(startDbWorker(self));
  });

const createInMemorySharedEvoluWorker = (
  deps: InMemoryWorkerRuntimeDeps,
): EvoluSharedWorker =>
  createInMemorySharedWorker<SharedWorkerInput, never>((self) => {
    const run = createWorkerRun(deps);
    void run(initSharedWorker(self));
  });

const createWorkerRun = (deps: InMemoryWorkerRuntimeDeps) => {
  const consoleStoreOutput = createConsoleStoreOutput();
  const workerConsole = createConsole({
    output: consoleStoreOutput,
    ...(deps.console && { level: deps.console.getLevel() }),
  });

  return createCommonRun({
    console: workerConsole,
    consoleStoreOutputEntry: consoleStoreOutput.entry,
    createMessagePort,
    createWebSocket: deps.createWebSocket,
    createSqliteDriver: deps.createSqliteDriver,
    leaderLock: inMemoryLeaderLock,
    randomBytes: deps.randomBytes,
  });
};

const supportsDedicatedDbWorkerPipeline = (): boolean =>
  typeof globalThis.Worker === "function";

const supportsSharedWorkerPipeline = (): boolean =>
  typeof globalThis.SharedWorker === "function";

const resolveNativeRuntime = (options: CreateLynxEvoluDepsOptions): boolean => {
  if (options.isNativeRuntime) {
    return options.isNativeRuntime();
  }

  return detectNativeRuntime();
};

const detectNativeRuntime = (): boolean => {
  const globalScope = globalThis as typeof globalThis & {
    navigator?: { storage?: { getDirectory?: () => Promise<unknown> } };
    FileSystemFileHandle?: unknown;
    location?: { href?: string };
  };

  const hasWebOpfsSurface =
    globalScope.FileSystemFileHandle != null &&
    typeof globalScope.navigator?.storage?.getDirectory === "function";

  if (hasWebOpfsSurface) return false;

  const hasBrowserLikeLocation =
    typeof globalScope.location?.href === "string" &&
    globalScope.location.href.length > 0;

  if (hasBrowserLikeLocation) return false;

  return true;
};

const resolveWebSocket = (): CreateWebSocket => {
  if (typeof globalThis.WebSocket === "function") {
    return createWebSocket;
  }

  return () => {
    throw new Error(
      "WebSocket is unavailable in this runtime. Provide native.createWebSocket when using WebSocket transports.",
    );
  };
};

const resolveRandomBytes = (): RandomBytes => {
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    return createRandomBytes();
  }

  return {
    create: () => {
      throw new Error(
        "crypto.getRandomValues is unavailable in this runtime. Provide native.randomBytes for secure randomness.",
      );
    },
  } as RandomBytes;
};
