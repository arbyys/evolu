# Lynx + Evolu Minimal Example

Minimal ReactLynx todo app that uses @evolu/lynx as the platform adapter.

## Runtime behavior

- Web runtime: uses `@evolu/lynx` web sqlite pipeline with persistent storage.
	- First choice: OPFS SAH pool VFS.
	- Fallback: WASMFS OPFS directory (if available in runtime).
- Native runtime: uses custom native sqlite driver resolved from runtime globals.
	- First choice: `globalThis.__evoluNativeSqliteAdapter`.
	- Fallback: `globalThis.NativeModules.EvoluSqlite`.

If native runtime is detected and no native binding is provided, app startup
fails with an explicit configuration error.

## What it verifies

- Evolu initialization via @evolu/lynx
- Local-first CRUD flow (insert, toggle complete, rename, soft delete)
- Persistence across reloads (same test owner)
- Basic owner access (mnemonic display)

Relay sync is intentionally disabled (`transports: []`) to keep this example local-only.

## Native sqlite binding contract

`globalThis.__evoluNativeSqliteAdapter` must provide:

```ts
{
	openSync(name, options?) => {
		execSync(sql, parameters) => { rows?: Array<Record<string, unknown>>; changes?: number; rowsAffected?: number }
		exportSync?() => Uint8Array | ArrayBuffer
		closeSync() => void
	}
}
```

`options` for `openSync`:

```ts
{
	mode?: "memory" | "encrypted";
	encryptionKeyHex?: string;
}
```

Alternative handle-based module is also supported via
`globalThis.NativeModules.EvoluSqlite`:

```ts
{
	openSync(name, options?) => handle
	execSync(handle, sql, parameters) => { rows?: Array<Record<string, unknown>>; changes?: number; rowsAffected?: number }
	exportSync?(handle) => Uint8Array | ArrayBuffer
	closeSync(handle) => void
}
```

## Run

```bash
pnpm --filter @example/lynx install
pnpm --filter @example/lynx dev
```

## Test matrix

1. Web OPFS test:
	- Run `pnpm --filter @example/lynx dev`.
	- Open Lynx Web preview URL.
	- Add/update todos, reload preview, verify data persistence.

2. Native sqlite test:
	- Provide one of the native bindings above before app bootstrap.
	- Run Lynx in native runtime.
	- Add/update todos, restart app/runtime, verify data persistence.

## Build and typecheck

```bash
pnpm --filter @example/lynx typecheck
pnpm --filter @example/lynx build
```
