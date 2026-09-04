import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  MarketingSite,
  isMarketingPath,
  isStudioPath,
  pageTitle,
  studioComingSoon
} from "./MarketingPages";
import { App } from "./main";

function normalizePath(pathname: string): string {
  if (!pathname || pathname === "/") return "/";
  return pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

function canonicalPath(pathname: string): string {
  const path = normalizePath(pathname);
  return path === "/hosted" ? "/" : path;
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
  const [path, setPath] = useState(() => canonicalPath(window.location.pathname));

  useEffect(() => {
    redirectStudioAuth();
    if (normalizePath(window.location.pathname) === "/hosted") {
      history.replaceState(null, "", "/");
    }
    setPath(canonicalPath(window.location.pathname));
    const onPop = () => {
      if (normalizePath(window.location.pathname) === "/hosted") {
        history.replaceState(null, "", "/");
      }
      setPath(canonicalPath(window.location.pathname));
    };
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }
      const link = event.target instanceof Element ? event.target.closest("a") : null;
      if (!link || link.target === "_blank" || link.hasAttribute("download")) return;
      let url: URL;
      try { url = new URL(link.href, window.location.origin); } catch { return; }
      if (url.origin !== window.location.origin) return;
      const raw = normalizePath(url.pathname);
      if (!isMarketingPath(raw)) return;
      const next = canonicalPath(raw);
      event.preventDefault();
      if (next === canonicalPath(window.location.pathname) && url.search === window.location.search) return;
      history.pushState(null, "", `${next}${url.search}${url.hash}`);
      setPath(next);
    };
    window.addEventListener("popstate", onPop);
    document.addEventListener("click", onClick);
    return () => {
      window.removeEventListener("popstate", onPop);
      document.removeEventListener("click", onClick);
    };
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
