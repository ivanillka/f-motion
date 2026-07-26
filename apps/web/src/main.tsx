import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

type Step = "sign-in" | "brief" | "concepts" | "editor" | "render";
const concepts = [
  ["Direct", "Lead with the result"],
  ["Story", "Establish, turn, resolve"],
  ["Rhythm", "Concise visual beats"]
] as const;

function App() {
  const [step, setStep] = useState<Step>(() => {
    const saved = localStorage.getItem("fmotion-step");
    return saved === "brief" || saved === "concepts" || saved === "editor" || saved === "render" ? saved : "sign-in";
  });
  const [selected, setSelected] = useState("");
  const [online, setOnline] = useState(navigator.onLine);
  const [draft, setDraft] = useState(() => localStorage.getItem("fmotion-draft") ?? "");
  const [conflict, setConflict] = useState(false);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => { window.removeEventListener("online", up); window.removeEventListener("offline", down); };
  }, []);
  useEffect(() => localStorage.setItem("fmotion-draft", draft), [draft]);
  useEffect(() => localStorage.setItem("fmotion-step", step), [step]);

  return <main>
    <header><strong>F‑Motion</strong><span role="status">{online ? "● Connected" : "○ Reconnecting — draft kept locally"}</span></header>
    {step === "sign-in" && <section>
      <h1>Shape a vertical video</h1>
      <p>Sign in to keep projects private.</p>
      <button onClick={() => setStep("brief")}>Email me a magic link</button>
      <button className="secondary" onClick={() => setStep("brief")}>Continue with Google</button>
    </section>}
    {step === "brief" && <section>
      <h1>What should this video achieve?</h1>
      <label>Brief<textarea value={draft} maxLength={500} onChange={(event) => setDraft(event.target.value)} placeholder="Launch a product for small teams…" /></label>
      <button disabled={!draft.trim()} onClick={() => setStep("concepts")}>Review brief</button>
    </section>}
    {step === "concepts" && <section>
      <h1>Choose one concept</h1>
      <div className="concepts">{concepts.map(([title, treatment]) =>
        <button key={title} aria-pressed={selected === title} className="card" onClick={() => setSelected(title)}>
          <strong>{title}</strong><span>{treatment}</span>
        </button>)}</div>
      <button disabled={!selected} onClick={() => setStep("editor")}>Use {selected || "concept"}</button>
    </section>}
    {step === "editor" && <section>
      <h1>Storyboard</h1>
      <p className="notice">Approximate preview — request an accurate render to verify timing and crop.</p>
      <div className="preview" aria-label="Approximate vertical preview"><span>{draft}</span></div>
      <label>Caption<input maxLength={180} value={draft} onChange={(event) => setDraft(event.target.value)} /></label>
      <label>Motion<select><option>None</option><option>Push</option><option>Zoom</option></select></label>
      <label>Duration<input type="range" min="0.5" max="15" step="0.1" defaultValue="3" /></label>
      <div><button>Upload media</button><button className="secondary">Search Pexels</button></div>
      <p role="status">✓ All changes saved</p>
      <button onClick={() => setStep("render")}>Render accurate 720p preview</button>
      <button className="secondary" onClick={() => setConflict(true)}>Simulate stale revision</button>
      {conflict && <dialog open><h2>Newer changes exist</h2><p>Your changes were not merged.</p><button onClick={() => setConflict(false)}>Reload latest</button><button onClick={() => setConflict(false)}>Save as new project</button></dialog>}
    </section>}
    {step === "render" && <section>
      <h1>Accurate preview</h1><p role="status">Rendering · 720p watermarked preview</p>
      <progress value="72" max="100">72%</progress>
      <div><button>Cancel render</button><button>Download preview</button></div>
      <button className="secondary" onClick={() => setStep("editor")}>Keep editing</button>
    </section>}
  </main>;
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
