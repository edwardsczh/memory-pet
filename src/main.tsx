import React, { Suspense, lazy } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

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
    ) : (
      <App />
    )}
  </React.StrictMode>,
);
