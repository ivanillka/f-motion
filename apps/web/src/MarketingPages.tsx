import "./marketing.css";

import { GITHUB_REPO_URL, githubBlobUrl } from "./repo";
const SELFHOST_DOCS = githubBlobUrl("docs/runbooks/self-host.md");

export type MarketingRoute =
  | "home"
  | "self-host"
  | "hosted"
  | "how-it-works"
  | "login";

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

export function marketingRoute(path: string): MarketingRoute {
  if (path === "/self-host") return "self-host";
  if (path === "/hosted") return "hosted";
  if (path === "/how-it-works") return "how-it-works";
  if (path === "/login") return "login";
  return "home";
}

const TITLES: Record<MarketingRoute, string> = {
  home: "F-Motion — Vertical reels from your own media",
  "self-host": "F-Motion — Self-host",
  hosted: "F-Motion — Hosted studio",
  "how-it-works": "F-Motion — How it works",
  login: "F-Motion — Login"
};

export function pageTitle(path: string): string {
  if (isStudioPath(path) && !studioComingSoon()) return "F-Motion — Studio";
  return TITLES[marketingRoute(path)] ?? "F-Motion";
}

function MarketingNav({ page }: { page: MarketingRoute }) {
  return (
    <>
      <a href="/" aria-current={page === "home" ? "page" : undefined}>Home</a>
      <a href="/how-it-works">How it works</a>
      <a href="/hosted" aria-current={page === "hosted" ? "page" : undefined}>Hosted</a>
      <a href="/self-host" aria-current={page === "self-host" ? "page" : undefined}>Self-host</a>
      <a href="/login" aria-current={page === "login" ? "page" : undefined}>Login</a>
    </>
  );
}

function ComingSoon({ title }: { title: string }) {
  return (
    <section className="mkt-section mkt-coming-soon" aria-labelledby="coming-heading">
      <p className="mkt-live">Coming soon</p>
      <h1 id="coming-heading">{title}</h1>
      <p className="mkt-lead">This part of f-motion.com is not open yet.</p>
      <p>We are finishing it. For now, read the <a href="/self-host">self-host guide</a> or browse <a href="/">home</a>.</p>
    </section>
  );
}

function HomePage() {
  const studio = studioHref();
  return (
    <section className="mkt-splash" aria-labelledby="splash-title">
      <h1 id="splash-title">F-Motion</h1>
      <nav className="mkt-splash-features" aria-label="Features">
        <a className="mkt-btn mkt-btn-primary mkt-btn-lg" href={studio}>Studio</a>
        <a className="mkt-btn mkt-btn-ghost mkt-btn-lg" href="/how-it-works">How it works</a>
        <a className="mkt-btn mkt-btn-ghost mkt-btn-lg" href="/hosted">Hosted</a>
        <a className="mkt-btn mkt-btn-ghost mkt-btn-lg" href="/self-host">Self-host</a>
      </nav>
    </section>
  );
}

function SelfHostPage() {
  const studio = studioHref();
  return (
    <div className="mkt-fade">
      <section className="mkt-int-hero">
        <div className="mkt-live">For operators</div>
        <h1>Install F-Motion on your VPS.</h1>
        <p>One Docker image runs the studio, API, worker, Postgres, MinIO, and Caddy. Your uploads stay on that machine. Stock search and AI stay BYOK.</p>
        <div className="mkt-hero-actions">
          <a className="mkt-btn mkt-btn-primary mkt-btn-lg" href={SELFHOST_DOCS} target="_blank" rel="noreferrer">Self-host guide</a>
          <a className="mkt-btn mkt-btn-ghost mkt-btn-lg" href={GITHUB_REPO_URL} target="_blank" rel="noreferrer">GitHub repo</a>
        </div>
      </section>
      <section className="mkt-section">
        <h2>What you get</h2>
        <div className="mkt-recipes">
          <article className="mkt-recipe">
            <span>01</span>
            <h3>Web + API + worker</h3>
            <p>Same brief → storyboard → preview flow as the hosted studio, without shipping media to us.</p>
          </article>
          <article className="mkt-recipe">
            <span>02</span>
            <h3>Owner password</h3>
            <p>First open creates a single owner. The container prints an operator token. Sign in at /studio with that email and password.</p>
          </article>
          <article className="mkt-recipe">
            <span>03</span>
            <h3>BYOK providers</h3>
            <p>Pexels and FAL keys stay in your database. No platform fallback keys.</p>
          </article>
        </div>
      </section>
      <section className="mkt-cta">
        <h2>Run it yourself</h2>
        <a className="mkt-btn mkt-btn-primary mkt-btn-lg" href={SELFHOST_DOCS} target="_blank" rel="noreferrer">Read self-host.md</a>
        <a className="mkt-text-link" href="/hosted">Prefer hosted</a>
      </section>
    </div>
  );
}

function HostedPage() {
  const studio = studioHref();
  return (
    <div className="mkt-fade">
      <section className="mkt-int-hero">
        <div className="mkt-live">f-motion.com</div>
        <h1>Use the hosted studio.</h1>
        <p>Sign in, write a brief, and download a 720p vertical preview. Your own uploads are free. Licensed Pexels search is included. Optional AI stills and short animation are charged when you run a job — you confirm before it starts.</p>
        <div className="mkt-hero-actions">
          <a className="mkt-btn mkt-btn-primary mkt-btn-lg" href={studio}>Open studio</a>
          <a className="mkt-btn mkt-btn-ghost mkt-btn-lg" href="/self-host">Prefer self-host</a>
        </div>
      </section>
      <section className="mkt-section">
        <h2>Hosted studio</h2>
        <div className="mkt-recipes">
          <article className="mkt-recipe">
            <span>Free</span>
            <h3>Your own media</h3>
            <p>Upload clips or stills you already have. Preview and download stay available without a provider key.</p>
          </article>
          <article className="mkt-recipe">
            <span>Included</span>
            <h3>Pexels stock</h3>
            <p>Search licensed footage with your connected Pexels key. Attribution stays on the clip.</p>
          </article>
          <article className="mkt-recipe">
            <span>BYOK</span>
            <h3>Optional AI</h3>
            <p>FAL stills and speech are optional. You see the quote before a job runs.</p>
          </article>
        </div>
      </section>
      <section className="mkt-cta">
        <h2>Open the studio</h2>
        <a className="mkt-btn mkt-btn-primary mkt-btn-lg" href={studio}>Open studio</a>
      </section>
    </div>
  );
}

export function MarketingSite({ path }: { path: string }) {
  const page = marketingRoute(path);
  const studio = studioHref();
  const splash = page === "home";

  return (
    <div className={splash ? "mkt mkt-is-splash" : "mkt"}>
      {!splash && (
        <header className="mkt-nav">
          <a className="mkt-brand" href="/">F-MOTION</a>
          <nav className="mkt-nav-links" aria-label="Marketing">
            <MarketingNav page={page} />
          </nav>
          <a className="mkt-btn mkt-btn-primary" href={studio}>Open studio</a>
        </header>
      )}

      <div className={splash ? "mkt-main mkt-main-splash" : "mkt-main"}>
        {page === "home" && <HomePage />}
        {page === "self-host" && <SelfHostPage />}
        {page === "hosted" && <HostedPage />}
        {page === "how-it-works" && <ComingSoon title="How it works" />}
        {page === "login" && <ComingSoon title="Login" />}
      </div>

      {!splash && (
        <footer className="mkt-footer">
          <strong className="mkt-brand" style={{ fontSize: "1rem" }}>F-MOTION</strong>
          <nav>
            <MarketingNav page={page} />
            <a href={studio}>Studio</a>
            <a href={GITHUB_REPO_URL} target="_blank" rel="noreferrer">GitHub</a>
          </nav>
          <span>© {new Date().getFullYear()} F-Motion</span>
        </footer>
      )}
    </div>
  );
}
