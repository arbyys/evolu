import { Suspense, createApp, h } from "vue";
import App from "./App.vue";
import "./style.css";

createApp({
	setup: () =>
		() =>
			h(
				Suspense,
				null,
				{
					default: () => h(App),
					fallback: () => h("div", "Loading Evolu app..."),
				},
			),
}).mount("#app");
