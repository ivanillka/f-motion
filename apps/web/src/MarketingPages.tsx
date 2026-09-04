import { useEffect, useRef, useState } from "react";
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
    <a href={href} aria-current={current ? "page" : undefined}>{label}</a>
  );
  return (
    <nav className="mkt-splash-features" aria-label="Features">
      <a className="is-studio" href={studio}>Studio</a>
      {item("/how-it-works", "How it works", page === "how-it-works")}
      <a href={SKILL_REPO} target="_blank" rel="noreferrer">GitHub</a>
      {item("/self-host", "Self-host", page === "self-host")}
    </nav>
  );
}

function Headline({ text }: { text: string }) {
  const long = text.includes(" ");
  if (text !== "F-Motion") {
    return <h1 id="splash-title" className={long ? "is-long" : undefined}>{text}</h1>;
  }
  return (
    <h1 id="splash-title">
      F<span className="mkt-hyphen">-</span>Motion
    </h1>
  );
}

type SkyStar = {
  x: number;
  y: number;
  r: number;
  a: number;
  speed: number;
  tw: number;
  tint: "white" | "cyan" | "rose";
};

function seedStars(count: number): SkyStar[] {
  return Array.from({ length: count }, () => {
    const left = Math.random() < 0.5;
    const roll = Math.random();
    return {
      x: left ? Math.random() * 0.34 : 0.66 + Math.random() * 0.34,
      y: Math.random(),
      r: 0.35 + Math.random() * 1.15,
      a: 0.28 + Math.random() * 0.5,
      speed: 0.012 + Math.random() * 0.018,
      tw: Math.random() * Math.PI * 2,
      tint: roll < 0.1 ? "cyan" : roll < 0.2 ? "rose" : "white"
    };
  });
}

function SplashSky() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;
    const reduced = typeof matchMedia === "function"
      && matchMedia("(prefers-reduced-motion: reduce)").matches;
      const stars = seedStars(110);
    let width = 0;
    let height = 0;
    let frame = 0;

    const size = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const paint = (ms: number) => {
      const t = ms / 1000;
      ctx.clearRect(0, 0, width, height);
      const clouds = [
        { x: 0.16 + Math.sin(t * 0.11) * 0.035, y: 0.46 + Math.cos(t * 0.09) * 0.03, rose: true },
        { x: 0.84 + Math.cos(t * 0.1) * 0.035, y: 0.52 + Math.sin(t * 0.08) * 0.03, rose: false }
      ];
      for (const cloud of clouds) {
        const gx = cloud.x * width;
        const gy = cloud.y * height;
        const reach = Math.max(width, height) * 0.42;
        const fog = ctx.createRadialGradient(gx, gy, 0, gx, gy, reach);
        if (cloud.rose) {
          fog.addColorStop(0, "rgba(165, 77, 103, 0.36)");
          fog.addColorStop(0.42, "rgba(180, 40, 70, 0.12)");
        } else {
          fog.addColorStop(0, "rgba(70, 88, 110, 0.32)");
          fog.addColorStop(0.42, "rgba(0, 180, 210, 0.07)");
        }
        fog.addColorStop(1, "rgba(0, 0, 0, 0)");
        ctx.fillStyle = fog;
        ctx.fillRect(0, 0, width, height);
      }
      for (const star of stars) {
        const y = ((star.y + t * star.speed) % 1 + 1) % 1;
        const twinkle = reduced ? 1 : 0.72 + 0.28 * Math.sin(t * 0.55 + star.tw);
        const alpha = star.a * twinkle;
        ctx.beginPath();
        ctx.arc(star.x * width, y * height, star.r, 0, Math.PI * 2);
        ctx.fillStyle = star.tint === "cyan"
          ? `rgba(0, 229, 255, ${alpha})`
          : star.tint === "rose"
            ? `rgba(255, 177, 196, ${alpha})`
            : `rgba(241, 242, 243, ${alpha})`;
        ctx.fill();
      }
    };

    size();
    const watch = new ResizeObserver(() => {
      size();
      if (reduced) paint(0);
    });
    watch.observe(canvas);
    if (reduced) {
      paint(0);
      return () => watch.disconnect();
    }
    const tick = (ms: number) => {
      if (!document.hidden) paint(ms);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      watch.disconnect();
    };
  }, []);
  return <canvas className="mkt-sky" ref={ref} aria-hidden="true" />;
}

function Splash({ page }: { page: MarketingRoute }) {
  const studio = studioHref();
  const headline = HEADLINES[page];
  const lede = LEDES[page];
  return (
    <section className="mkt-splash" aria-labelledby="splash-title">
      {page !== "home" ? <a className="mkt-splash-brand" href="/">F-Motion</a> : null}
      <Headline text={headline} />
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
    }, 200);
    return () => window.clearTimeout(timer);
  }, [page, shown]);

  return (
    <div className="mkt mkt-is-splash">
      <SplashSky />
      <div className="mkt-main mkt-main-splash">
        <div className={`mkt-page is-${phase}`} key={shown}>
          <Splash page={shown} />
        </div>
      </div>
    </div>
  );
}
