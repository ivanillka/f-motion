import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
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

const FACE_YAW: Record<MarketingRoute, number> = {
  home: 0,
  "how-it-works": -90,
  "self-host": -180,
  login: 90
};

const FACE_SIDE: Record<MarketingRoute, "front" | "right" | "back" | "left"> = {
  home: "front",
  "how-it-works": "right",
  "self-host": "back",
  login: "left"
};

const FACE_PATH: Record<MarketingRoute, string> = {
  home: "/",
  "how-it-works": "/how-it-works",
  "self-host": "/self-host",
  login: "/login"
};

const FACE_ORDER: MarketingRoute[] = ["home", "how-it-works", "self-host", "login"];

function towardYaw(from: number, to: number): number {
  const raw = ((to - from) % 360 + 360) % 360;
  return from + (raw > 180 ? raw - 360 : raw);
}

function neighborFace(page: MarketingRoute, step: number): MarketingRoute {
  const index = FACE_ORDER.indexOf(page);
  return FACE_ORDER[(index + step + FACE_ORDER.length) % FACE_ORDER.length] ?? page;
}

function FeatureNav({ page, studio }: { page: MarketingRoute; studio: string }) {
  const item = (href: string, label: string, current: boolean, className?: string) => (
    <a className={className} href={href} aria-current={current ? "page" : undefined}>{label}</a>
  );
  return (
    <nav className="mkt-splash-features" aria-label="Features">
      {item("/", "Home", page === "home")}
      {item(studio, "Studio", page === "login", "is-studio")}
      {item("/how-it-works", "How it works", page === "how-it-works")}
      <a href={SKILL_REPO} target="_blank" rel="noreferrer">GitHub</a>
      {item("/self-host", "Self-host", page === "self-host")}
    </nav>
  );
}

function Headline({ text, active }: { text: string; active: boolean }) {
  const long = text.includes(" ");
  const className = long ? "mkt-face-title is-long" : "mkt-face-title";
  const mark = text === "F-Motion"
    ? <>F<span className="mkt-hyphen">-</span>Motion</>
    : text;
  if (active) return <h1 id="splash-title" className={className}>{mark}</h1>;
  return <p className={className}>{mark}</p>;
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

function FaceCopy({ page, active }: { page: MarketingRoute; active: boolean }) {
  const lede = LEDES[page];
  return (
    <>
      <Headline text={HEADLINES[page]} active={active} />
      {lede ? <p className="mkt-splash-lede">{lede}</p> : null}
      {active && page === "self-host"
        ? <a className="mkt-splash-lede" href={SELFHOST_DOCS} target="_blank" rel="noreferrer">Guide</a>
        : null}
    </>
  );
}

function WordCube({ page, onTurn }: { page: MarketingRoute; onTurn: (next: MarketingRoute) => void }) {
  const faces = (kind: "outer" | "inner") => CUBE_FACES.map((side) => (
    <span
      key={`${kind}-${side}`}
      className={kind === "inner" ? "mkt-cube-face is-inner" : "mkt-cube-face"}
      data-side={side}
      aria-hidden="true"
    />
  ));
  const start = useRef<{ x: number; y: number } | null>(null);
  const dragged = useRef(false);
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    start.current = { x: event.clientX, y: event.clientY };
    dragged.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const origin = start.current;
    start.current = null;
    if (!origin) return;
    const dx = event.clientX - origin.x;
    const dy = event.clientY - origin.y;
    if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy)) return;
    dragged.current = true;
    onTurn(neighborFace(page, dx < 0 ? 1 : -1));
  };
  const onClickCapture = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!dragged.current) return;
    dragged.current = false;
    event.preventDefault();
    event.stopPropagation();
  };
  return (
    <div
      className="mkt-cube-scene"
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onClickCapture={onClickCapture}
    >
      <div className="mkt-cube-rig">
        <div className="mkt-cube">
          {faces("outer")}
          <div className="mkt-cube-shell" aria-hidden="true">{faces("inner")}</div>
          {FACE_ORDER.map((face) => {
            const active = face === page;
            const side = FACE_SIDE[face];
            const copy = <FaceCopy page={face} active={active} />;
            if (active) {
              return <div key={face} className="mkt-cube-core" data-side={side}>{copy}</div>;
            }
            return (
              <a
                key={face}
                className="mkt-cube-core"
                data-side={side}
                href={FACE_PATH[face]}
                aria-hidden="true"
                tabIndex={-1}
              >
                {copy}
              </a>
            );
          })}
        </div>
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

function goFace(next: MarketingRoute): void {
  const path = FACE_PATH[next];
  const here = window.location.pathname.replace(/\/$/, "") || "/";
  if (path === here) return;
  history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function Splash({ page, onTurn }: { page: MarketingRoute; onTurn: (next: MarketingRoute) => void }) {
  return (
    <section className="mkt-splash" aria-labelledby="splash-title">
      <WordCube page={page} onTurn={onTurn} />
      <FeatureNav page={page} studio={studioHref()} />
    </section>
  );
}

export function MarketingSite({ path }: { path: string }) {
  const page = marketingRoute(path);
  const [yaw, setYaw] = useState(() => FACE_YAW[page]);
  const [busy, setBusy] = useState(true);
  const [turning, setTurning] = useState(false);
  const pace = busy ? 3.4 : turning ? 2.2 : 1;
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
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && event.target.closest("input, textarea, a, button")) return;
      if (event.key === "ArrowRight") {
        event.preventDefault();
        goFace(neighborFace(page, 1));
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        goFace(neighborFace(page, -1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [page]);

  useEffect(() => {
    setYaw((from) => towardYaw(from, FACE_YAW[page]));
    const reduced = typeof matchMedia === "function"
      && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setTurning(false);
      return;
    }
    setTurning(true);
    const timer = window.setTimeout(() => setTurning(false), 800);
    return () => window.clearTimeout(timer);
  }, [page]);

  return (
    <div
      className="mkt mkt-is-splash"
      style={{
        ["--mkt-pace" as string]: String(pace),
        ["--mkt-yaw" as string]: `${yaw}deg`
      }}
    >
      <SplashSky paceRef={paceRef} />
      <div className="mkt-main mkt-main-splash">
        <div className="mkt-page">
          <Splash page={page} onTurn={goFace} />
        </div>
      </div>
    </div>
  );
}
