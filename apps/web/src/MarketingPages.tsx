import { useEffect, useRef, useState, type ReactNode } from "react";
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

const CUBE_FACES = ["front", "back", "right", "left", "top", "bottom"] as const;

function WordCube({ children }: { children: ReactNode }) {
  return (
    <div className="mkt-cube-scene">
      <div className="mkt-cube">
        {CUBE_FACES.map((side) => (
          <span key={side} className="mkt-cube-face" data-side={side} aria-hidden="true" />
        ))}
        <div className="mkt-cube-core">{children}</div>
      </div>
    </div>
  );
}

function SplashSky({ paceRef }: { paceRef: { current: number } }) {
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
    let clock = 0;
    let last = performance.now();
    let current = paceRef.current;

    const size = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const paint = (t: number) => {
      ctx.clearRect(0, 0, width, height);
      const clouds = [
        { x: 0.04 + Math.sin(t * 0.07) * 0.02, y: 0.38 + Math.cos(t * 0.05) * 0.02, rose: true },
        { x: 0.96 + Math.cos(t * 0.06) * 0.02, y: 0.62 + Math.sin(t * 0.05) * 0.02, rose: false }
      ];
      for (const cloud of clouds) {
        const gx = cloud.x * width;
        const gy = cloud.y * height;
        const reach = Math.max(width, height) * 0.55;
        const fog = ctx.createRadialGradient(gx, gy, reach * 0.12, gx, gy, reach);
        if (cloud.rose) {
          fog.addColorStop(0, "rgba(165, 77, 103, 0.14)");
          fog.addColorStop(0.55, "rgba(180, 40, 70, 0.04)");
        } else {
          fog.addColorStop(0, "rgba(70, 88, 110, 0.12)");
          fog.addColorStop(0.55, "rgba(0, 180, 210, 0.03)");
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
      const dt = Math.min(0.05, (ms - last) / 1000);
      last = ms;
      if (!document.hidden) {
        const target = paceRef.current;
        current += (target - current) * Math.min(1, dt * 2.6);
        clock += dt * current;
        paint(clock);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      watch.disconnect();
    };
  }, [paceRef]);
  return <canvas className="mkt-sky" ref={ref} aria-hidden="true" />;
}

function Splash({ page }: { page: MarketingRoute }) {
  const studio = studioHref();
  const headline = HEADLINES[page];
  const lede = LEDES[page];
  const cube = (
    <WordCube>
      <Headline text={headline} />
      {lede ? <p className="mkt-splash-lede">{lede}</p> : null}
    </WordCube>
  );
  return (
    <section className="mkt-splash" aria-labelledby="splash-title">
      {page === "home" ? cube : <a className="mkt-cube-home" href="/" aria-label="F-Motion">{cube}</a>}
      {page === "self-host" ? <a className="mkt-splash-lede" href={SELFHOST_DOCS} target="_blank" rel="noreferrer">Guide</a> : null}
      <FeatureNav page={page} studio={studio} />
    </section>
  );
}

export function MarketingSite({ path }: { path: string }) {
  const page = marketingRoute(path);
  const [shown, setShown] = useState(page);
  const [phase, setPhase] = useState<"in" | "out">("in");
  const [busy, setBusy] = useState(true);
  const pace = busy ? 3.4 : phase === "out" ? 2.2 : 1;
  const paceRef = useRef(pace);
  paceRef.current = pace;

  useEffect(() => {
    let gone = false;
    const finish = () => { if (!gone) setBusy(false); };
    const onLoad = () => {
      const fonts = document.fonts?.ready ?? Promise.resolve();
      void fonts.then(finish);
    };
    if (document.readyState === "complete") onLoad();
    else window.addEventListener("load", onLoad);
    const fallback = window.setTimeout(finish, 2200);
    return () => {
      gone = true;
      window.removeEventListener("load", onLoad);
      window.clearTimeout(fallback);
    };
  }, []);

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
    <div className="mkt mkt-is-splash" style={{ ["--mkt-pace" as string]: String(pace) }}>
      <SplashSky paceRef={paceRef} />
      <div className="mkt-main mkt-main-splash">
        <div className={`mkt-page is-${phase}`} key={shown}>
          <Splash page={shown} />
        </div>
      </div>
    </div>
  );
}
