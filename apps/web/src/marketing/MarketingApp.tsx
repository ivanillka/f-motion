import "../marketing.css";

const GITHUB = "https://github.com/ivanillka/f-motion";
const LICENSE = `${GITHUB}/blob/advisor/133-design-contract/LICENSE`;

export function MarketingApp({ path }: { path: string }) {
  const page = path === "/self-host" ? "self-host" : path === "/hosted" ? "hosted" : "home";

  return (
    <div className="mkt">
      <a className="mkt-skip" href="#main">Skip to content</a>
      <header className="mkt-nav">
        <a className="mkt-brand" href="/">F-MOTION</a>
        <nav className="mkt-nav-links" aria-label="Marketing">
          <a href="/" aria-current={page === "home" ? "page" : undefined}>Home</a>
          <a href="/self-host" aria-current={page === "self-host" ? "page" : undefined}>Self-host</a>
          <a href="/hosted" aria-current={page === "hosted" ? "page" : undefined}>Hosted</a>
          <a href={GITHUB} target="_blank" rel="noreferrer">GitHub</a>
        </nav>
        <a className="mkt-btn mkt-btn-primary" href="/studio">Open studio</a>
      </header>

      <main id="main" className="mkt-main">
        {page === "home" && <HomePage />}
        {page === "self-host" && <SelfHostPage />}
        {page === "hosted" && <HostedPage />}
      </main>

      <footer className="mkt-footer">
        <strong className="mkt-brand" style={{ fontSize: "1rem" }}>F-MOTION</strong>
        <nav>
          <a href="/">Home</a>
          <a href="/self-host">Self-host</a>
          <a href="/hosted">Hosted</a>
          <a href="/studio">Studio</a>
          <a href={GITHUB} target="_blank" rel="noreferrer">GitHub</a>
          <a href={LICENSE} target="_blank" rel="noreferrer">License</a>
          <a href="/web/terms.html">Terms</a>
          <a href="/web/privacy.html">Privacy</a>
        </nav>
        <span>Apache-2.0 · © {new Date().getFullYear()} F-Motion</span>
      </footer>
    </div>
  );
}

function HomePage() {
  return (
    <div className="mkt-fade">
      <section className="mkt-hero">
        <img className="mkt-hero-logo" src="/marketing/logo.png" alt="" width={192} height={192} />
        <h1>Vertical reels from your own media.</h1>
        <p className="mkt-chip">brief → storyboard → preview</p>
        <div className="mkt-hero-actions">
          <a className="mkt-btn mkt-btn-primary mkt-btn-lg" href="/studio">Open studio</a>
          <a className="mkt-btn mkt-btn-ghost mkt-btn-lg" href="/self-host">Self-host</a>
        </div>
        <div className="mkt-hero-media">
          <picture>
            <source type="image/webp" srcSet="/web/assets/hero-reel.webp" />
            <img src="/web/assets/hero-reel.jpg" alt="Cinematic editing desk with a vertical-reel preview on the monitor" />
          </picture>
        </div>
      </section>

      <section className="mkt-section" aria-labelledby="paths-heading">
        <h2 id="paths-heading">Use it your way</h2>
        <div className="mkt-recipes">
          <article className="mkt-recipe">
            <span>01 Self-host</span>
            <h3>One image on your VPS</h3>
            <p>Run the studio, API, worker, Postgres, and object storage from a single container. Your uploads stay on your machine.</p>
            <a href="/self-host">Self-host guide</a>
          </article>
          <article className="mkt-recipe">
            <span>02 Hosted</span>
            <h3>Use f-motion.com</h3>
            <p>Upload your own media for free. Pexels stock is included. FAL generation is billed by F-Motion — no prices listed here.</p>
            <a href="/hosted">Hosted studio</a>
          </article>
          <article className="mkt-recipe">
            <span>03 Source</span>
            <h3>Read the GitHub repo</h3>
            <p>Apache-2.0 source, issues, and docs. Fork it, file a bug, or pin a release on your own host.</p>
            <a href={GITHUB} target="_blank" rel="noreferrer">Open GitHub</a>
          </article>
        </div>
      </section>

      <section className="mkt-section">
        <h2>The Pipeline</h2>
        <div className="mkt-steps">
          <div className="mkt-step">
            <div className="mkt-step-num">01 Describe</div>
            <p>Draft a short brief. F-Motion offers three story concepts — you pick one.</p>
          </div>
          <div className="mkt-step">
            <div className="mkt-step-num">02 Choose media</div>
            <p>Upload your clips, search Pexels when a key is available, or generate a still with FAL using a key you control.</p>
          </div>
          <div className="mkt-step">
            <div className="mkt-step-num">03 Preview reel</div>
            <p>Edit the storyboard, then download an accurate 720p vertical preview. Nothing publishes itself.</p>
          </div>
        </div>
      </section>

      <section className="mkt-band">
        <div className="mkt-split">
          <div className="mkt-split-visual">
            <picture>
              <source type="image/webp" srcSet="/web/assets/studio-ui.webp" />
              <img src="/web/assets/studio-ui.jpg" alt="Guided storyboard editor with a vertical preview" />
            </picture>
          </div>
          <div>
            <h2>Your media stays yours.</h2>
            <p>Uploads you send to a self-hosted image never leave that VPS. Hosted studio files stay in F-Motion storage you can delete. Pexels clips keep their creator attribution. FAL output is charged to the account that owns the key.</p>
          </div>
        </div>
      </section>

      <section className="mkt-section">
        <h2>From draft to download.</h2>
        <p style={{ textAlign: "center", color: "var(--mkt-muted)", maxWidth: "36rem", margin: "-1.5rem auto 2rem" }}>
          A guided storyboard for vertical video — calm, precise, private. Not a multitrack editor.
        </p>
        <div className="mkt-frame">
          <div className="mkt-frame-bar" aria-hidden="true"><i /><i /><i /></div>
          <picture>
            <source type="image/webp" srcSet="/web/assets/studio-ui.webp" />
            <img src="/web/assets/studio-ui.jpg" alt="F-Motion storyboard with a 9:16 preview" />
          </picture>
        </div>
      </section>

      <section className="mkt-cta">
        <h2>Ready to compile?</h2>
        <a className="mkt-btn mkt-btn-primary mkt-btn-lg" href="/studio">Open studio</a>
      </section>
    </div>
  );
}

function SelfHostPage() {
  return (
    <div className="mkt-fade">
      <section className="mkt-int-hero">
        <div className="mkt-live">One image</div>
        <h1>Install F-Motion on your VPS.</h1>
        <p>
          One published image runs the marketing site, studio, API, FFmpeg worker,
          Postgres, and object storage. Own-media uploads work with no provider key.
          Add your Pexels or FAL key only if you want those features.
        </p>
        <div className="mkt-hero-actions">
          <a className="mkt-btn mkt-btn-primary mkt-btn-lg" href={GITHUB} target="_blank" rel="noreferrer">Get the image</a>
          <a className="mkt-btn mkt-btn-ghost mkt-btn-lg" href="/studio">Open studio</a>
        </div>
      </section>

      <section className="mkt-section">
        <h2>VPS paste</h2>
        <div className="mkt-code">
          <div className="mkt-frame-bar" aria-hidden="true"><i /><i /><i /></div>
          <pre><code>{`docker compose up
# or
docker build -f deploy/Dockerfile -t f-motion .
docker run --rm -p 8080:8080 -v fmotion-data:/data f-motion`}</code></pre>
        </div>
        <p className="mkt-note">
          On first boot the container prints an operator token. Sign in at
          {" "}/studio with that token. Details live in docs/runbooks/self-host.md.
        </p>
      </section>

      <section className="mkt-section">
        <h2>What the image includes</h2>
        <div className="mkt-recipes">
          <article className="mkt-recipe">
            <span>Studio</span>
            <h3>Web + API + worker</h3>
            <p>The same brief → storyboard → 720p preview path as the hosted studio.</p>
          </article>
          <article className="mkt-recipe">
            <span>Data</span>
            <h3>Postgres + MinIO</h3>
            <p>Embedded in the image. Persist <code>/data</code> with a volume.</p>
          </article>
          <article className="mkt-recipe">
            <span>Keys</span>
            <h3>Optional providers</h3>
            <p>Pexels and FAL stay your keys. The image never ships a shared provider credential.</p>
          </article>
        </div>
      </section>
    </div>
  );
}

function HostedPage() {
  return (
    <div className="mkt-fade">
      <section className="mkt-int-hero">
        <div className="mkt-live">f-motion.com</div>
        <h1>Use the hosted studio.</h1>
        <p>
          Sign in on f-motion.com, upload your own media for free, and search
          Pexels on the hosted key. FAL stills and animation are billed by
          F-Motion. This page does not list prices, packs, or wait times.
        </p>
        <div className="mkt-hero-actions">
          <a className="mkt-btn mkt-btn-primary mkt-btn-lg" href="/studio">Open studio</a>
          <a className="mkt-btn mkt-btn-ghost mkt-btn-lg" href="/self-host">Prefer self-host</a>
        </div>
      </section>

      <section className="mkt-section">
        <h2>What you pay for</h2>
        <div className="mkt-recipes">
          <article className="mkt-recipe">
            <span>Free</span>
            <h3>Your own media</h3>
            <p>Upload clips or stills you already have. Preview and download stay available without a provider key.</p>
          </article>
          <article className="mkt-recipe">
            <span>Free</span>
            <h3>Pexels stock</h3>
            <p>Licensed Pexels search on the hosted studio. Attribution stays on the clip. Pexels is not public domain.</p>
          </article>
          <article className="mkt-recipe">
            <span>Billed</span>
            <h3>FAL generation</h3>
            <p>Hosted FAL is charged by F-Motion after you confirm the job. Self-host uses your own FAL key instead.</p>
          </article>
        </div>
      </section>
    </div>
  );
}
