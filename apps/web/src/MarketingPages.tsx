import { useEffect, useState } from "react";
import "./marketing.css";

import { githubBlobUrl, githubTreeUrl } from "./repo";
const SELFHOST_DOCS = githubBlobUrl("docs/runbooks/vps-self-host.md");
const SKILL_REPO = githubTreeUrl("skills/fmotion");

export type MarketingRoute =
  | "home"
  | "self-host"
  | "how-it-works"
  | "login";

const MARKETING_PATHS = new Set(["/", "/how-it-works", "/hosted", "/self-host", "/login"]);

export function studioComingSoon(): boolean {
  return import.meta.env.VITE_STUDIO_COMING_SOON === "1"
    || (import.meta.env.PROD && import.meta.env.VITE_SELFHOST_AUTH !== "1");
}

export function studioHref(): string {
  return studioComingSoon() ? "/login" : "/studio";
}

export function isStudioPath(path: string): boolean {
  return path === "/studio" || path.startsWith("/studio/")
    || path === "/app" || path.startsWith("/app/");
}

export function isMarketingPath(path: string): boolean {
  return MARKETING_PATHS.has(path);
}

export function marketingRoute(path: string): MarketingRoute {
  if (path === "/self-host") return "self-host";
  if (path === "/how-it-works") return "how-it-works";
  if (path === "/login") return "login";
  return "home";
}

const TITLES: Record<MarketingRoute, string> = {
  home: "F-Motion",
  "self-host": "F-Motion — Self-host",
  "how-it-works": "F-Motion — How it works",
  login: "F-Motion — Login"
};

const HEADLINES: Record<MarketingRoute, string> = {
  home: "F-Motion",
  "how-it-works": "How it works",
  "self-host": "Self-host",
  login: "Login"
};

const LEDES: Record<MarketingRoute, string> = {
  home: "",
  "how-it-works": "Coming soon on f-motion.com.",
  "self-host": "The same studio, one image, on your VPS.",
  login: "Coming soon on f-motion.com."
};

export function pageTitle(path: string): string {
  if (isStudioPath(path) && !studioComingSoon()) return "F-Motion — Studio";
  return TITLES[marketingRoute(path)] ?? "F-Motion";
}

function FeatureNav({ page, studio }: { page: MarketingRoute; studio: string }) {
  const item = (href: string, label: string, current: boolean) => (
    <a
      className={`mkt-btn mkt-btn-lg ${current ? "mkt-btn-ghost is-current" : "mkt-btn-ghost"}`}
      href={href}
      aria-current={current ? "page" : undefined}
    >
      {label}
    </a>
  );
  return (
    <nav className="mkt-splash-features" aria-label="Features">
      <a className="mkt-btn mkt-btn-primary mkt-btn-lg" href={studio}>Studio</a>
      {item("/how-it-works", "How it works", page === "how-it-works")}
      <a className="mkt-btn mkt-btn-ghost mkt-btn-lg" href={SKILL_REPO} target="_blank" rel="noreferrer">GitHub</a>
      {item("/self-host", "Self-host", page === "self-host")}
    </nav>
  );
}

function Splash({ page }: { page: MarketingRoute }) {
  const studio = studioHref();
  const headline = HEADLINES[page];
  const lede = LEDES[page];
  return (
    <section className="mkt-splash" aria-labelledby="splash-title">
      {page !== "home" ? <a className="mkt-splash-brand" href="/">F-Motion</a> : null}
      <h1 id="splash-title" className={headline.includes(" ") ? "is-long" : undefined}>{headline}</h1>
      {lede ? <p className="mkt-splash-lede">{lede}{page === "self-host" ? <> <a href={SELFHOST_DOCS} target="_blank" rel="noreferrer">Guide</a></> : null}</p> : null}
      <FeatureNav page={page} studio={studio} />
    </section>
  );
}

export function MarketingSite({ path }: { path: string }) {
  const page = marketingRoute(path);
  const [shown, setShown] = useState(page);
  const [phase, setPhase] = useState<"in" | "out">("in");

  useEffect(() => {
    if (page === shown) return;
    const reduced = typeof matchMedia === "function"
      && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setShown(page);
      setPhase("in");
      return;
    }
    setPhase("out");
    const timer = window.setTimeout(() => {
      setShown(page);
      setPhase("in");
    }, 180);
    return () => window.clearTimeout(timer);
  }, [page, shown]);

  return (
    <div className="mkt mkt-is-splash">
      <div className="mkt-main mkt-main-splash">
        <div className={`mkt-page is-${phase}`} key={shown}>
          <Splash page={shown} />
        </div>
      </div>
    </div>
  );
}
