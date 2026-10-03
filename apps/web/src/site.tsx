import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";

const App = lazy(() => import("./main").then((mod) => ({ default: mod.App })));

function Studio() {
  return (
    <Suspense fallback={<div style={{ minHeight: "100dvh", background: "#111213" }} aria-busy="true" />}>
      <App />
    </Suspense>
  );
}

function SiteRoot() {
  return <Studio />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode><SiteRoot /></StrictMode>
);
