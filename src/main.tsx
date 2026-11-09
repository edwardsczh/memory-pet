import React, { Suspense, lazy } from "react";
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

const preview = import.meta.env.DEV
  ? new URLSearchParams(window.location.search).get("preview")
  : null;
const CompliancePreview = import.meta.env.DEV
  ? lazy(() => import("./compliance/preview/CompliancePreview"))
  : null;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {CompliancePreview && preview === "compliance" ? (
      <Suspense>
        <CompliancePreview />
      </Suspense>
    ) : isSettings ? (
      <SettingsApp />
    ) : (
      <App />
    )}
  </React.StrictMode>,
);
