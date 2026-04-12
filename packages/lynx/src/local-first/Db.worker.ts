import { startDbWorker } from "@evolu/common/local-first";
import { installPolyfills } from "@evolu/common/polyfills";
import { createWasmSqliteDriver } from "../Sqlite.js";
import { createLeaderLock, createRun } from "../Task.js";
import { createWorkerDeps, createWorkerSelf } from "../Worker.js";

installPolyfills();

const run = createRun({
  ...createWorkerDeps(),
  createSqliteDriver: createWasmSqliteDriver,
  leaderLock: createLeaderLock(),
});

void run(
  startDbWorker(
    createWorkerSelf(self as unknown as Parameters<typeof createWorkerSelf>[0]),
  ),
);
