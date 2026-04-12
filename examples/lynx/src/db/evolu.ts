import * as Evolu from "@evolu/common";
import type {
  Evolu as EvoluInstance,
  Query,
  QueryRows,
  Row,
} from "@evolu/common/local-first";
import { createEvoluDeps, createRun } from "@evolu/lynx";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "@lynx-js/react";
import { resolveNativeSqliteDriver } from "./nativeSqliteDriver.js";
import { AppSchema } from "./schema.js";

const console = Evolu.createConsole({
  formatter: Evolu.createConsoleFormatter()({ timestampFormat: "relative" }),
});

const getRuntimeCapabilities = () => {
  const globalScope = globalThis as typeof globalThis & {
    navigator?: { storage?: { getDirectory?: () => Promise<unknown> } };
    FileSystemFileHandle?: { prototype?: { createSyncAccessHandle?: unknown } };
    location?: { href?: string };
  };

  return {
    hasWorker: typeof globalThis.Worker === "function",
    hasSharedWorker: typeof globalThis.SharedWorker === "function",
    hasMessageChannel: typeof globalThis.MessageChannel === "function",
    hasNavigatorStorageGetDirectory:
      typeof globalScope.navigator?.storage?.getDirectory === "function",
    hasFileSystemFileHandle: globalScope.FileSystemFileHandle != null,
    hasCreateSyncAccessHandle:
      typeof globalScope.FileSystemFileHandle?.prototype?.createSyncAccessHandle ===
      "function",
    hasLocationHref:
      typeof globalScope.location?.href === "string" &&
      globalScope.location.href.length > 0,
  };
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

const isNativeRuntime = detectNativeRuntime();
const nativeSqliteDriver = resolveNativeSqliteDriver();
const runtimeCapabilities = getRuntimeCapabilities();

console.info("Lynx runtime capabilities", runtimeCapabilities);
console.info("Lynx runtime mode", {
  isNativeRuntime,
  hasNativeSqliteDriver: nativeSqliteDriver != null,
});

if (isNativeRuntime && !nativeSqliteDriver) {
  throw new Error(
    "Native Lynx runtime detected but no native sqlite binding was found. Provide globalThis.__evoluNativeSqliteAdapter or globalThis.NativeModules.EvoluSqlite.",
  );
}

const deps = createEvoluDeps({
  console,
  isNativeRuntime: () => isNativeRuntime,
  ...(nativeSqliteDriver && {
    nativeFallback: {
      createSqliteDriver: nativeSqliteDriver,
    },
  }),
});

deps.evoluError.subscribe(() => {
  const error = deps.evoluError.get();
  if (!error) return;

  console.error("Evolu error", error);
});

const run = createRun(deps);

export const createEvoluFiber = () =>
  run.orThrow(
    Evolu.createEvolu(AppSchema, {
      appName: Evolu.AppName.orThrow("lynx-minimal"),
      appOwner: Evolu.testAppOwner,
      transports: [],
    }),
  );

export type EvoluFiber = ReturnType<typeof createEvoluFiber>;
export type AppEvolu = EvoluInstance<typeof AppSchema>;

export const EvoluContext = createContext<AppEvolu | null>(null);

export const useEvolu = (): AppEvolu => {
  const evolu = useContext(EvoluContext);
  if (!evolu) throw new Error("EvoluContext is missing.");
  return evolu;
};

export const useQuery = <R extends Row>(query: Query<typeof AppSchema, R>): QueryRows<R> => {
  const evolu = useEvolu();
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    let isDisposed = false;

    void evolu.loadQuery(query).then(() => {
      if (!isDisposed) setIsLoaded(true);
    });

    return () => {
      isDisposed = true;
    };
  }, [evolu, query]);

  const rows = useSyncExternalStore(
    useMemo(() => evolu.subscribeQuery(query), [evolu, query]),
    useMemo(() => () => evolu.getQueryRows(query), [evolu, query]),
    () => [] as QueryRows<R>,
  );

  return isLoaded ? rows : ([] as QueryRows<R>);
};

export const parseTodoTitle = (value: string) =>
  Evolu.NonEmptyTrimmedString100.from(value.trim());

export const formatTypeError = Evolu.createFormatTypeError<
  Evolu.MinLengthError | Evolu.MaxLengthError
>((error): string => {
  switch (error.type) {
    case "MinLength":
      return `Title must be at least ${error.min} character${error.min === 1 ? "" : "s"}.`;
    case "MaxLength":
      return `Title is too long (max ${error.max} characters).`;
  }
});
