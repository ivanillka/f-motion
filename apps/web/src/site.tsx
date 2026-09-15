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

function studioComingSoon(): boolean {
  return import.meta.env.VITE_STUDIO_COMING_SOON === "1";
}

function ComingSoon() {
  return (
    <div style={{
      minHeight: "100dvh",
      background: "#111213",
      color: "#f1f2f3",
      display: "grid",
      placeItems: "center",
      padding: "2rem",
      textAlign: "center"
    }}
    >
      <div>
        <p>Coming soon on f-motion.com.</p>
        <p><a href="/" style={{ color: "#a54d67" }}>Home</a></p>
      </div>
    </div>
  );
}

function SiteRoot() {
  if (import.meta.env.VITE_SELFHOST_AUTH === "1") return <Studio />;
  if (studioComingSoon()) return <ComingSoon />;
  return <Studio />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode><SiteRoot /></StrictMode>
);
