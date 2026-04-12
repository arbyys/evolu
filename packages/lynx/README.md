# @evolu/lynx

Evolu platform adapter for Lynx.

## Usage

```ts
import { createEvoluDeps } from "@evolu/lynx";
```

`createEvoluDeps` supports two modes:

- Web mode (default): uses worker files from this package and WASM SQLite.
- Native mode: pass `native` deps with your native SQLite driver.

For hybrid apps, use `nativeFallback` so web keeps OPFS/WASM and native runtime
uses custom SQLite driver automatically.

`isNativeRuntime` can override runtime detection if your host requires custom
logic.

```ts
import { createEvoluDeps, createNativeSqliteDriver } from "@evolu/lynx";

const nativeSqliteDriver = createNativeSqliteDriver({
  openSync: (name, options) => {
    const connection = nativeSqliteModule.openSync(name, options);
    return {
      execSync: (sql, parameters) => connection.execSync(sql, parameters),
      exportSync: () => connection.exportSync(),
      closeSync: () => connection.closeSync(),
    };
  },
});

const nativeOnlyDeps = createEvoluDeps({
  native: {
    createSqliteDriver: nativeSqliteDriver,
    reloadApp: () => nativeReload(),
    createWebSocket,
    randomBytes,
  },
});

const hybridDeps = createEvoluDeps({
  isNativeRuntime: () => detectNativeRuntime(),
  nativeFallback: {
    createSqliteDriver: nativeSqliteDriver,
    reloadApp: () => nativeReload(),
    createWebSocket,
    randomBytes,
  },
});
```
