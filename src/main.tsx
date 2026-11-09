import React from "react";
import ReactDOM from "react-dom/client";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App";
import SettingsApp from "./settings/SettingsApp";

// All windows share this entry; the window label (or `?view=` in a plain browser) picks the page.
const view = isTauri()
  ? getCurrentWindow().label
  : new URLSearchParams(location.search).get("view");
const isSettings = view === "settings";
if (isSettings) document.documentElement.classList.add("settings-view");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>{isSettings ? <SettingsApp /> : <App />}</React.StrictMode>,
);
