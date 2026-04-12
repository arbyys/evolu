import { createWebSocket } from "@evolu/common";
import { initSharedWorker } from "@evolu/common/local-first";
import { installPolyfills } from "@evolu/common/polyfills";
import { createRun } from "../Task.js";
import { createSharedWorkerSelf, createWorkerDeps } from "../Worker.js";

installPolyfills();

const run = createRun({
  ...createWorkerDeps(),
  createWebSocket,
});

void run(
  initSharedWorker(
    createSharedWorkerSelf(
      self as unknown as Parameters<typeof createSharedWorkerSelf>[0],
    ),
  ),
);
