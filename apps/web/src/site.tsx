import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  MarketingSite,
  isStudioPath,
  pageTitle,
  studioComingSoon
} from "./MarketingPages";
import { App } from "./main";

function normalizePath(pathname: string): string {
  if (!pathname || pathname === "/") return "/";
  return pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

function redirectStudioAuth(): void {
  const url = new URL(window.location.href);
  const params = url.searchParams;
  const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
  const project = params.get("project") ?? "";
  const code = params.get("code") ?? "";
  const error = params.get("error_code") ?? params.get("error")
    ?? hash.get("error_code") ?? hash.get("error") ?? "";
  const onHome = normalizePath(url.pathname) === "/";
  const legacyApp = url.pathname === "/app" || url.pathname.startsWith("/app/");
  if (!onHome && !legacyApp) return;
  if (!/^[0-9a-f-]{36}$/i.test(project) && !code && !error) return;

  const next = new URL("/studio", url.origin);
  if (/^[0-9a-f-]{36}$/i.test(project)) next.searchParams.set("project", project);
  if (code) next.searchParams.set("code", code);
  if (error) next.searchParams.set("error_code", error);
  history.replaceState(null, "", `${next.pathname}${next.search}${url.hash}`);
}

function SiteRoot() {
  const [path, setPath] = useState(() => normalizePath(window.location.pathname));

  useEffect(() => {
    redirectStudioAuth();
    setPath(normalizePath(window.location.pathname));
    const onPop = () => setPath(normalizePath(window.location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    document.title = pageTitle(path);
  }, [path]);

  if (import.meta.env.VITE_SELFHOST_AUTH === "1") {
    return <App />;
  }

  if (isStudioPath(path) && !studioComingSoon()) {
    return <App />;
  }

  if (isStudioPath(path) && studioComingSoon()) {
    return <MarketingSite path="/login" />;
  }

  return <MarketingSite path={path} />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode><SiteRoot /></StrictMode>
);
