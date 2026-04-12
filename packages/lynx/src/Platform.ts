import type { ReloadApp } from "@evolu/common";

export const reloadApp: ReloadApp = (url) => {
  if (typeof globalThis.location === "undefined") {
    return;
  }

  globalThis.location.replace(url ?? "/");
};
