import { useState } from "react";
import "./marketing.css";

export type MarketingTab = "web" | "integrate";

interface MarketingLandingProps {
  onOpenStudio: () => void;
  docsHref?: string;
}

export function MarketingLanding({
  onOpenStudio,
  docsHref = "https://github.com/ivanillka/f-motion/blob/advisor/133-design-contract/docs/agents/host-recipes.md"
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
              <h1>Brief to vertical reel.</h1>
              <p className="mkt-chip">plan → storyboard → preview → export</p>
              <div className="mkt-hero-actions">
                <button type="button" className="mkt-btn mkt-btn-primary mkt-btn-lg" onClick={onOpenStudio}>Open studio</button>
                <button type="button" className="mkt-btn mkt-btn-ghost mkt-btn-lg" onClick={() => setTab("integrate")}>See integration</button>
              </div>
              <div className="mkt-hero-media">
                <img src="/marketing/hero-reel.png" alt="Cinematic vertical reel atmosphere" />
              </div>
            </section>

            <section className="mkt-section">
              <h2>How a reel gets made</h2>
              <div className="mkt-steps">
                <div className="mkt-step">
                  <div className="mkt-step-num">01 Plan</div>
                  <p>Describe the subject and mood. Get a recommended video plan and three story concepts to accept or edit.</p>
                </div>
                <div className="mkt-step">
                  <div className="mkt-step-num">02 Assemble</div>
                  <p>Own uploads or Pexels BYOK stock, Mixkit music, then record, upload, or generate Kokoro voice-over.</p>
                </div>
                <div className="mkt-step">
                  <div className="mkt-step-num">03 Preview &amp; export</div>
                  <p>Play the storyboard live with captions and motion, then render an accurate preview or final export.</p>
                </div>
              </div>
            </section>

            <section className="mkt-section">
              <h2>Built for this workflow</h2>
              <div className="mkt-steps mkt-features">
                <div className="mkt-step">
                  <div className="mkt-step-num">Storyboard</div>
                  <p>Reorder scenes, edit captions and cues, set crop and motion, scrub a live playhead.</p>
                </div>
                <div className="mkt-step">
                  <div className="mkt-step-num">Media</div>
                  <p>JPEG, PNG, WebP, or MP4 uploads — or licensed Pexels search with your own key.</p>
                </div>
                <div className="mkt-step">
                  <div className="mkt-step-num">Audio</div>
                  <p>Mixkit beds or uploads, ducking under recorded, uploaded, or Kokoro FAL voice-over.</p>
                </div>
                <div className="mkt-step">
                  <div className="mkt-step-num">FAL</div>
                  <p>Flux Schnell stills and Hailuo six-second motion, quoted then confirmed on your FAL account.</p>
                </div>
                <div className="mkt-step">
                  <div className="mkt-step-num">Metering</div>
                  <p>Host render units for preview and export. Provider spend stays on your Pexels and FAL bills.</p>
                </div>
                <div className="mkt-step">
                  <div className="mkt-step-num">Seats</div>
                  <p>Open-source self-host is single seat. Multi-user is the corporate product.</p>
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
                  <p>Pexels and FAL stay BYOK — validated, encrypted, never shown again. F-Motion meters host render units, not provider credits.</p>
                </div>
              </div>
            </section>

            <section className="mkt-section">
              <h2>From draft to download.</h2>
              <p style={{ textAlign: "center", color: "var(--mkt-muted)", maxWidth: "36rem", margin: "-1.5rem auto 2rem" }}>
                Live storyboard preview with soundtrack and voice-over — then an accurate vertical MP4.
              </p>
              <div className="mkt-frame">
                <div className="mkt-frame-bar" aria-hidden="true"><i /><i /><i /></div>
                <img src="/marketing/studio-editor.png" alt="F-Motion editor preview" />
              </div>
            </section>

            <section className="mkt-cta">
              <h2>Open the studio.</h2>
              <button type="button" className="mkt-btn mkt-btn-primary mkt-btn-lg" onClick={onOpenStudio}>Open studio</button>
            </section>
          </div>
        ) : (
          <div key="integrate" className="mkt-fade">
            <section className="mkt-int-hero">
              <div className="mkt-live">API v1 is live</div>
              <h1>Embed vertical reel creation in your product.</h1>
              <p>
                Keep your upload, auth, and publishing. Call F-Motion for plan → storyboard → render —
                then publish the finished reel back to your gallery, feed, or stories.
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
                  <p>OpenClaw, Cursor, or Hermes drive create → command → render → wait with machine keys.</p>
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
    "external_id": "host:gallery:weekend",
    "title": "Weekend portraits",
    "caption": "Quiet frames from the session.",
    "call_to_action": "Open the full gallery.",
    "media_urls": ["https://cdn.example.com/galleries/weekend/1.jpg"]
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
