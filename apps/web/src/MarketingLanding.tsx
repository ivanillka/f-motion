import { useState } from "react";
import "./marketing.css";
import { githubBlobUrl } from "./repo";

export type MarketingTab = "web" | "integrate";

interface MarketingLandingProps {
  onOpenStudio: () => void;
  docsHref?: string;
}

export function MarketingLanding({
  onOpenStudio,
  docsHref = githubBlobUrl("docs/agents/host-recipes.md")
}: MarketingLandingProps) {
  const [tab, setTab] = useState<MarketingTab>("web");

  return (
    <div className="mkt">
      <header className="mkt-nav">
        <button type="button" className="mkt-brand" onClick={() => setTab("web")} style={{ background: "none", border: 0, padding: 0, minHeight: 0, cursor: "pointer", color: "inherit" }}>
          F-MOTION
        </button>
        <nav className="mkt-nav-links" aria-label="Marketing">
          <button type="button" aria-current={tab === "web" ? "true" : undefined} onClick={() => setTab("web")}>Web</button>
          <button type="button" aria-current={tab === "integrate" ? "true" : undefined} onClick={() => setTab("integrate")}>Integrate</button>
          <a href={docsHref} target="_blank" rel="noreferrer">Docs</a>
        </nav>
        <button type="button" className="mkt-btn mkt-btn-primary" onClick={onOpenStudio}>Open studio</button>
      </header>

      <div className="mkt-main">
        {tab === "web" ? (
          <div key="web" className="mkt-fade">
            <section className="mkt-hero">
              <img className="mkt-hero-logo" src="/marketing/logo.png" alt="" width={192} height={192} />
              <h1>Vertical reels from your own media.</h1>
              <p className="mkt-chip">brief → storyboard → preview</p>
              <div className="mkt-hero-actions">
                <button type="button" className="mkt-btn mkt-btn-primary mkt-btn-lg" onClick={onOpenStudio}>Open studio</button>
                <button type="button" className="mkt-btn mkt-btn-ghost mkt-btn-lg" onClick={() => setTab("integrate")}>See integration</button>
              </div>
              <div className="mkt-hero-media">
                <img src="/marketing/hero-reel.png" alt="Cinematic vertical reel atmosphere" />
              </div>
            </section>

            <section className="mkt-section">
              <h2>The Pipeline</h2>
              <div className="mkt-steps">
                <div className="mkt-step">
                  <div className="mkt-step-num">01 Describe</div>
                  <p>Draft your creative brief. Define mood, pacing, and the core message of the reel.</p>
                </div>
                <div className="mkt-step">
                  <div className="mkt-step-num">02 Choose media</div>
                  <p>Upload your own clips or connect BYOK stock. You keep the keys and the masters.</p>
                </div>
                <div className="mkt-step">
                  <div className="mkt-step-num">03 Preview reel</div>
                  <p>Review the storyboard and download an accurate vertical preview when it is ready.</p>
                </div>
              </div>
            </section>

            <section className="mkt-band">
              <div className="mkt-split">
                <div className="mkt-split-visual">
                  <img src="/marketing/studio-editor.png" alt="Dark storyboard studio interface" />
                </div>
                <div>
                  <h2>Your media, your keys.</h2>
                  <p>Pexels and FAL stay BYOK. F-Motion meters host render units — not provider credits — so your creative stack stays under your control.</p>
                </div>
              </div>
            </section>

            <section className="mkt-section">
              <h2>From draft to download.</h2>
              <p style={{ textAlign: "center", color: "var(--mkt-muted)", maxWidth: "36rem", margin: "-1.5rem auto 2rem" }}>
                A timeline built for vertical storytelling — calm, precise, private.
              </p>
              <div className="mkt-frame">
                <div className="mkt-frame-bar" aria-hidden="true"><i /><i /><i /></div>
                <img src="/marketing/studio-editor.png" alt="F-Motion editor preview" />
              </div>
            </section>

            <section className="mkt-cta">
              <h2>Ready to compile?</h2>
              <button type="button" className="mkt-btn mkt-btn-primary mkt-btn-lg" onClick={onOpenStudio}>Open studio</button>
            </section>
          </div>
        ) : (
          <div key="integrate" className="mkt-fade">
            <section className="mkt-int-hero">
              <div className="mkt-live">API v1 is live</div>
              <h1>Embed cinematic creation in your product.</h1>
              <p>
                Keep your upload, auth, Immich/faces, and publishing. Call F-Motion for the reel —
                then publish back to your gallery, feed, or stories.
              </p>
              <div className="mkt-hero-actions">
                <button type="button" className="mkt-btn mkt-btn-primary mkt-btn-lg" onClick={onOpenStudio}>Get API access</button>
                <a className="mkt-btn mkt-btn-ghost mkt-btn-lg" href={docsHref} target="_blank" rel="noreferrer">Read partner recipes</a>
              </div>
            </section>

            <section className="mkt-section">
              <h2>Integration recipes</h2>
              <div className="mkt-recipes">
                <article className="mkt-recipe">
                  <span>01</span>
                  <h3>Import &amp; open</h3>
                  <p>Host POSTs a draft + media URLs. Open <code>projectUrl</code> so creators finish in the studio.</p>
                </article>
                <article className="mkt-recipe">
                  <span>02</span>
                  <h3>Render pipeline</h3>
                  <p>API key → project → render → download. Your backend publishes the finished file.</p>
                </article>
                <article className="mkt-recipe">
                  <span>03</span>
                  <h3>MCP agent loop</h3>
                  <p>OpenClaw, Cursor, or Hermes: drop media or chat, ask a few questions, return a preview plus a draft link.</p>
                </article>
              </div>
            </section>

            <section className="mkt-section">
              <h2>Architecture flow</h2>
              <div className="mkt-frame">
                <img src="/marketing/architecture.png" alt="Host platform connecting to F-Motion and publishing outputs" style={{ aspectRatio: "16 / 9", objectFit: "contain", background: "#0d0e0f" }} />
              </div>
            </section>

            <section className="mkt-section mkt-split">
              <div>
                <h2 style={{ textAlign: "left" }}>Developer experience.</h2>
                <p>
                  Trusted import with a host Bearer token, or owner API keys (<code>fm_…</code>).
                  Idempotent on <code>external_id</code>. Preview and final renders are metered in host units.
                </p>
              </div>
              <div className="mkt-code">
                <div className="mkt-frame-bar" aria-hidden="true"><i /><i /><i /></div>
                <pre><code>{`curl -X POST https://api.f-motion.com/v1/integrations/project-imports \\
  -H "Authorization: Bearer $FENGINE_IMPORT_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "external_id": "fotium:gallery:weekend",
    "title": "Weekend portraits",
    "caption": "Quiet frames from the session.",
    "call_to_action": "Open the full gallery.",
    "media_urls": ["https://media.example.com/galleries/weekend/1.jpg"]
  }'`}</code></pre>
              </div>
            </section>

            <section className="mkt-cta">
              <h2>Ship the reel. Keep the host.</h2>
              <button type="button" className="mkt-btn mkt-btn-primary mkt-btn-lg" onClick={onOpenStudio}>Open studio</button>
            </section>
          </div>
        )}
      </div>

      <footer className="mkt-footer">
        <strong className="mkt-brand" style={{ fontSize: "1rem" }}>F-MOTION</strong>
        <nav>
          <button type="button" onClick={() => setTab("web")}>Web</button>
          <button type="button" onClick={() => setTab("integrate")}>Integrate</button>
          <button type="button" onClick={onOpenStudio}>Studio</button>
          <a href={docsHref} target="_blank" rel="noreferrer">Docs</a>
        </nav>
        <span>© {new Date().getFullYear()} F-Motion</span>
      </footer>
    </div>
  );
}
