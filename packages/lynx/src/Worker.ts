import {
  createMessageChannel as createCommonMessageChannel,
  createMessagePort as createCommonMessagePort,
  createSharedWorker as createCommonSharedWorker,
  createWorker as createCommonWorker,
  type CreateMessagePort,
  type MessageChannel,
  type MessagePort,
  type NativeMessagePort,
  type SharedWorker,
  type SharedWorkerSelf,
  type Transferable,
  type Worker,
  type WorkerDeps,
  type WorkerSelf,
} from "@evolu/common";
import { assert, createConsole, createConsoleStoreOutput } from "@evolu/common";

interface DedicatedWorkerScopeLike {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage: (message: unknown, transfer?: unknown) => void;
  close: () => void;
}

interface SharedWorkerScopeLike {
  onconnect: ((event: MessageEvent) => void) | null;
  close: () => void;
}

/** Creates a {@link Worker} from a native Worker instance. */
export const createWorker = <Input, Output>(
  nativeWorker: globalThis.Worker,
): Worker<Input, Output> => wrap(nativeWorker);

/** Creates a {@link SharedWorker} from a native SharedWorker instance. */
export const createSharedWorker = <Input, Output = never>(
  nativeSharedWorker: globalThis.SharedWorker,
): SharedWorker<Input, Output> => {
  const port = wrap<Input, Output>(nativeSharedWorker.port);
  return {
    port,
    [Symbol.dispose]: port[Symbol.dispose],
  };
};

/**
 * Creates a {@link MessageChannel} from native MessageChannel when available,
 * otherwise falls back to an in-memory channel.
 */
export const createMessageChannel = <Input, Output = never>(): MessageChannel<
  Input,
  Output
> => {
  if (typeof globalThis.MessageChannel !== "function") {
    return createCommonMessageChannel<Input, Output>();
  }

  const channel = new globalThis.MessageChannel();
  const stack = new DisposableStack();

  return {
    port1: stack.use(wrap<Input, Output>(channel.port1)),
    port2: stack.use(wrap<Output, Input>(channel.port2)),
    [Symbol.dispose]: () => {
      stack.dispose();
    },
  };
};

/**
 * Creates an Evolu {@link MessagePort} from a native MessagePort.
 *
 * In-memory fallback tokens from `@evolu/common` are also supported.
 */
export const createMessagePort: CreateMessagePort = (nativePort) =>
  isNativeMessagePort(nativePort)
    ? wrap(nativePort)
    : createCommonMessagePort(nativePort);

/** Creates a {@link WorkerSelf} wrapper for dedicated worker scope. */
export const createWorkerSelf = <Input, Output = never>(
  nativeSelf: DedicatedWorkerScopeLike,
): WorkerSelf<Input, Output> => wrap<Output, Input>(nativeSelf);

/** Creates a {@link SharedWorkerSelf} wrapper for shared worker scope. */
export const createSharedWorkerSelf = <Input, Output = never>(
  nativeSelf: SharedWorkerScopeLike,
): SharedWorkerSelf<Input, Output> => {
  const self: SharedWorkerSelf<Input, Output> = {
    onConnect: null,
    [Symbol.dispose]: () => {
      nativeSelf.onconnect = null;
      nativeSelf.close();
    },
  };

  nativeSelf.onconnect = (event: MessageEvent) => {
    assert(
      self.onConnect != null,
      "onConnect must be set before receiving connections",
    );
    self.onConnect(wrap<Output, Input>(event.ports[0]));
  };

  return self;
};

/** Creates deps shared by worker entry points. */
export const createWorkerDeps = (): WorkerDeps => {
  const consoleStoreOutput = createConsoleStoreOutput();
  const console = createConsole({ output: consoleStoreOutput });

  return {
    console,
    consoleStoreOutputEntry: consoleStoreOutput.entry,
    createMessagePort,
  };
};

/** Creates an in-memory {@link Worker}. */
export const createInMemoryWorker = <Input, Output>(
  initWorker: (self: WorkerSelf<Input, Output>) => void,
): Worker<Input, Output> => createCommonWorker(initWorker);

/** Creates an in-memory {@link SharedWorker}. */
export const createInMemorySharedWorker = <Input, Output = never>(
  initWorker: (self: SharedWorkerSelf<Input, Output>) => void,
): SharedWorker<Input, Output> => createCommonSharedWorker(initWorker);

const wrap = <Input, Output>(
  native:
    | DedicatedWorkerScopeLike
    | globalThis.MessagePort
    | globalThis.Worker,
): MessagePort<Input, Output> => {
  let onMessageHandler: ((message: Output) => void) | null = null;

  return {
    postMessage: (message: Input, transfer?: ReadonlyArray<Transferable>) => {
      if (transfer == null) native.postMessage(message);
      else native.postMessage(message, [...transfer]);
    },

    get onMessage() {
      return onMessageHandler;
    },
    set onMessage(fn) {
      onMessageHandler = fn;
      if (fn) {
        native.onmessage = (event: MessageEvent<Output>) => {
          fn(event.data);
        };
      } else {
        native.onmessage = null;
      }
    },

    native: native as unknown as NativeMessagePort<Input, Output>,

    [Symbol.dispose]: () => {
      native.onmessage = null;
      if (native instanceof globalThis.Worker) native.terminate();
      else native.close();
    },
  };
};

const isNativeMessagePort = (
  value: unknown,
): value is globalThis.MessagePort => {
  if (typeof value !== "object" || value == null) return false;

  return (
    "postMessage" in value &&
    "close" in value &&
    "addEventListener" in value
  );
};
