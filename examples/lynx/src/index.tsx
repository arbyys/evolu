import "@lynx-js/react/debug";
import { root } from "@lynx-js/react";
import { App } from "./App.js";

const lynxApi = (globalThis as { lynx?: { getDevtool?: unknown } }).lynx;
if (typeof lynxApi?.getDevtool === "function") {
	void import("@lynx-js/preact-devtools");
}

root.render(<App />);
