import {
  ApplicationConfig,
  InjectionToken,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from "@angular/core";
import type { ReadonlyStore } from "@evolu/common";
import * as Evolu from "@evolu/common";
import { createEvoluDeps, createRun } from "@evolu/web";
import { Schema } from "./schema";

const deps = createEvoluDeps();
const run = createRun(deps);

const evolu = await run.orThrow(
  Evolu.createEvolu(Schema, {
    appName: Evolu.AppName.orThrow("angular-vite-pwa-minimal"),
    appOwner: Evolu.testAppOwner,

    ...(import.meta.env.DEV && {
      transports: [{ type: "WebSocket", url: "ws://localhost:4000" }],
    }),
  }),
);

// This injection token allows us to use Angular's dependency injection to get
// the Evolu instance above within Angular components and services.
export const EVOLU = new InjectionToken<Evolu.Evolu<typeof Schema>>("Evolu");

export const EVOLU_ERROR = new InjectionToken<
  ReadonlyStore<Evolu.EvoluError | null>
>("EvoluError");

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    { provide: EVOLU, useValue: evolu },
    { provide: EVOLU_ERROR, useValue: deps.evoluError },
  ],
};
