import "../marketing.css";

const GITHUB = "https://github.com/ivanillka/f-motion";
const LICENSE = `${GITHUB}/blob/HEAD/LICENSE`;
const INSTALL = `${GITHUB}/blob/HEAD/docs/runbooks/self-host.md`;

function NavLinks({ page }: { page: string }) {
  return (
    <>
      <a href="/" aria-current={page === "home" ? "page" : undefined}>Home</a>
      <a href="/#how">How it works</a>
      <a href="/hosted" aria-current={page === "hosted" ? "page" : undefined}>Hosted</a>
      <a href="/self-host" aria-current={page === "self-host" ? "page" : undefined}>Self-host</a>
    </>
  );
}

export function MarketingApp({ path }: { path: string }) {
  const page = path === "/self-host" ? "self-host" : path === "/hosted" ? "hosted" : "home";

  return (
    <div className="mkt">
      <a className="mkt-skip" href="#main">Skip to content</a>
      <header className="mkt-nav">
        <a className="mkt-brand" href="/">F-MOTION</a>
        <details className="mkt-menu">
          <summary>Menu</summary>
          <nav aria-label="Marketing">
            <NavLinks page={page} />
            <a href={GITHUB} target="_blank" rel="noreferrer">GitHub</a>
          </nav>
        </details>
        <nav className="mkt-nav-links" aria-label="Marketing">
          <NavLinks page={page} />
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
          <a href="/#how">How it works</a>
          <a href="/hosted">Hosted</a>
          <a href="/self-host">Self-host</a>
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
        <h1>Vertical reels from your own media.</h1>
        <p className="mkt-lead">
          Write a short brief, pick a story, drop in your clips, download a 720p vertical preview.
        </p>
        <p className="mkt-chip">brief → storyboard → preview</p>
        <div className="mkt-hero-actions">
          <a className="mkt-btn mkt-btn-primary mkt-btn-lg" href="/studio">Open studio</a>
          <a className="mkt-text-link" href="/self-host">Self-host on your VPS</a>
        </div>
        <div className="mkt-hero-media">
          <picture>
            <source type="image/webp" srcSet="/web/assets/studio-ui.webp" />
            <img src="/web/assets/studio-ui.jpg" alt="Guided storyboard editor with a vertical 9:16 preview" />
          </picture>
        </div>
      </section>

      <section className="mkt-section" id="how" aria-labelledby="how-heading">
        <h2 id="how-heading">How a reel gets made</h2>
        <p className="mkt-section-lead">Not a multitrack editor. A guided storyboard that stays on this path.</p>
        <div className="mkt-steps">
          <div className="mkt-step">
            <div className="mkt-step-num">01 Describe</div>
            <p>Write a short brief. F-Motion offers three story concepts — you pick one.</p>
          </div>
          <div className="mkt-step">
            <div className="mkt-step-num">02 Choose pictures</div>
            <p>Upload clips you already have. On the hosted studio you can also search licensed Pexels stock, or add optional AI stills.</p>
          </div>
          <div className="mkt-step">
            <div className="mkt-step-num">03 Download preview</div>
            <p>Edit the storyboard, then download an accurate 720p vertical preview. Nothing publishes itself.</p>
          </div>
        </div>
      </section>

      <section className="mkt-section" aria-labelledby="paths-heading">
        <h2 id="paths-heading">Three ways to use it</h2>
        <div className="mkt-recipes">
          <article className="mkt-recipe">
            <span>01 Hosted</span>
            <h3>Use it here</h3>
            <p>Open the studio on f-motion.com. Your uploads and Pexels search are free. Optional AI is billed when you confirm a job.</p>
            <a href="/hosted">Hosted studio</a>
          </article>
          <article className="mkt-recipe">
            <span>02 Self-host</span>
            <h3>One image on your VPS</h3>
            <p>Run the same studio on a machine you control. Your uploads stay there. Stock search and AI stay optional.</p>
            <a href="/self-host">Self-host guide</a>
          </article>
          <article className="mkt-recipe">
            <span>03 Source</span>
            <h3>Read the GitHub repo</h3>
            <p>Apache-2.0 source, issues, and docs. Fork it, file a bug, or pin a release on your own host.</p>
            <a href={GITHUB} target="_blank" rel="noreferrer">Open GitHub</a>
          </article>
        </div>
      </section>

      <section className="mkt-band">
        <div className="mkt-split">
          <div className="mkt-split-visual">
            <picture>
              <source type="image/webp" srcSet="/web/assets/hero-reel.webp" />
              <img src="/web/assets/hero-reel.jpg" alt="A vertical reel preview on an editing desk" />
            </picture>
          </div>
          <div>
            <h2>Your media stays yours.</h2>
            <p>
              Uploads on a self-hosted image stay on that VPS. Hosted files stay in F-Motion storage you can delete.
              Pexels clips keep their creator attribution. Pexels is not public domain.
            </p>
          </div>
        </div>
      </section>

      <section className="mkt-cta">
        <h2>Make a preview</h2>
        <p className="mkt-section-lead">Start on f-motion.com. Self-host if you want the same app on your server.</p>
        <a className="mkt-btn mkt-btn-primary mkt-btn-lg" href="/studio">Open studio</a>
      </section>
    </div>
  );
}

function SelfHostPage() {
  return (
    <div className="mkt-fade">
      <section className="mkt-int-hero">
        <div className="mkt-live">For operators</div>
        <h1>Install F-Motion on your VPS.</h1>
        <p>
          If you want the same studio on a machine you control, run one image.
          It serves the site, studio, API, preview worker, Postgres, and object storage.
          Own-media uploads work with no provider key. Add a Pexels or AI key only if you want those features.
        </p>
        <div className="mkt-hero-actions">
          <a className="mkt-btn mkt-btn-primary mkt-btn-lg" href={INSTALL} target="_blank" rel="noreferrer">Read the install guide</a>
          <a className="mkt-text-link" href="/studio">Open studio</a>
        </div>
      </section>

      <section className="mkt-section">
        <h2>Run it</h2>
        <div className="mkt-code">
          <div className="mkt-frame-bar" aria-hidden="true"><i /><i /><i /></div>
          <pre><code>{`docker compose up
# or
docker build -f deploy/Dockerfile -t f-motion .
docker run --rm -p 8080:8080 -v fmotion-data:/data f-motion`}</code></pre>
        </div>
        <p className="mkt-note">
          On first boot the container prints an operator token. Sign in at
          {" "}/studio with that token. The published container registry is not
          the install path yet — build from the repo. Details live in docs/runbooks/self-host.md.
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
            <h3>Postgres + object storage</h3>
            <p>Embedded in the image. Persist <code>/data</code> with a volume.</p>
          </article>
          <article className="mkt-recipe">
            <span>Keys</span>
            <h3>Optional providers</h3>
            <p>Stock search and AI stay your keys. The image never ships a shared provider credential.</p>
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
          Sign in, write a brief, and download a 720p vertical preview.
          Your own uploads are free. Licensed Pexels search is included.
          Optional AI stills and short animation are charged when you run a job — you confirm before it starts.
        </p>
        <div className="mkt-hero-actions">
          <a className="mkt-btn mkt-btn-primary mkt-btn-lg" href="/studio">Open studio</a>
          <a className="mkt-text-link" href="/self-host">Prefer self-host</a>
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
            <span>Billed on confirm</span>
            <h3>Optional AI</h3>
            <p>Stills and short animation are charged by F-Motion after you confirm the job. You see that charge before it starts.</p>
          </article>
        </div>
        <p className="mkt-note">
          This is not a timeline editor. You get a guided storyboard and an accurate 720p preview.
          Want the same app on a machine you control? Self-host.
        </p>
      </section>
    </div>
  );
}
