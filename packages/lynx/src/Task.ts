/**
 * Lynx platform-specific Task utilities.
 *
 * @module
 */

import {
  createInMemoryLeaderLock,
  createRun as createCommonRun,
  createUnknownError,
  ok,
  type CreateRun,
  type LeaderLock,
  type Run,
  type RunDeps,
} from "@evolu/common";

const inMemoryLeaderLock = createInMemoryLeaderLock();

/**
 * Creates a {@link LeaderLock} backed by Web Locks API when available.
 *
 * Falls back to an in-memory lock when `navigator.locks` is not available.
 */
export const createLeaderLock = (): LeaderLock => {
  const locks = globalThis.navigator?.locks;

  if (!locks?.request) {
    return inMemoryLeaderLock;
  }

  return {
    lock: (name) => async () => {
      const acquired = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();

      void locks.request(`evolu-leaderlock-${name}`, { mode: "exclusive" }, async () => {
        acquired.resolve();
        await release.promise;
      });

      await acquired.promise;

      return ok({
        [Symbol.asyncDispose]: async () => {
          release.resolve();
          return Promise.resolve();
        },
      });
    },
  };
};

interface GlobalErrorUtils {
  readonly getGlobalHandler: () =>
    | ((error: unknown, isFatal?: boolean) => void)
    | undefined;
  readonly setGlobalHandler: (
    handler: (error: unknown, isFatal?: boolean) => void,
  ) => void;
}

/**
 * Creates {@link Run} with browser and React Native global error handling.
 */
export const createRun: CreateRun<RunDeps> = <D>(
  deps?: D,
): Run<RunDeps & D> => {
  const run = createCommonRun(deps);
  const console = run.deps.console.child("global");

  if (typeof globalThis.addEventListener === "function") {
    globalThis.addEventListener(
      "error",
      (event) => {
        console.error("error", createUnknownError(event.error));
      },
      { signal: run.signal },
    );

    globalThis.addEventListener(
      "unhandledrejection",
      (event) => {
        console.error("unhandledrejection", createUnknownError(event.reason));
      },
      { signal: run.signal },
    );
  }

  const errorUtils = (globalThis as { ErrorUtils?: GlobalErrorUtils }).ErrorUtils;
  const previousHandler = errorUtils?.getGlobalHandler();

  if (errorUtils) {
    errorUtils.setGlobalHandler((error, isFatal) => {
      console.error(
        isFatal ? "fatalError" : "uncaughtError",
        createUnknownError(error),
      );

      previousHandler?.(error, isFatal);
    });

    run.onAbort(() => {
      if (previousHandler) {
        errorUtils.setGlobalHandler(previousHandler);
      }
    });
  }

  return run;
};
