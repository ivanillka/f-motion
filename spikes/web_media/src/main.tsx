import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { bounded, defaultDraft, median, nextUpload, p95, parseDraft, reorder, scenes, shouldLoop, slowThreshold } from "./logic.js";
import "./style.css";

type Draft = typeof defaultDraft;
type Metrics = { startup: number; input: number[]; seek: number[]; cadence: number[]; slow: number; frames: number; threshold: number; restore: number };
declare global { interface Window { __fmotion: { metrics: Metrics; interact(): void; seek(): void; snapshot(): unknown } } }

function App() {
  const restoreStart = performance.now();
  const [draft, setDraft] = useState<Draft>(() => parseDraft(localStorage.getItem("fmotion-draft") ?? ""));
  const [playing, setPlaying] = useState(false);
  const [upload, setUpload] = useState({ progress: 0, failed: false, retried: false });
  const [display, setDisplay] = useState("");
  const video = useRef<HTMLVideoElement>(null);
  const started = useRef(false);
  const metrics = useRef<Metrics>({ startup: 0, input: [], seek: [], cadence: [], slow: 0, frames: 0, threshold: 20, restore: performance.now() - restoreStart });
  const selected = scenes.find(scene => scene.id === draft.selected)!;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const measureInput = (action: () => void) => { const start = performance.now(); action(); requestAnimationFrame(() => metrics.current.input = bounded(metrics.current.input, performance.now() - start)); };
  const measureSeek = (target = Math.random() * 2.8) => { const start = performance.now(); if (!video.current) return; video.current.addEventListener("seeked", () => metrics.current.seek = bounded(metrics.current.seek, performance.now() - start), { once: true }); video.current.currentTime = target; };
  useEffect(() => { localStorage.setItem("fmotion-draft", JSON.stringify(draft)); }, [draft]);
  useEffect(() => {
    let previous = performance.now(), warm = 0, raf = 0;
    const tick = (now: number) => {
      const interval = now - previous; previous = now;
      if (warm < 120) { metrics.current.cadence.push(interval); warm++; if (warm === 120) metrics.current.threshold = slowThreshold(metrics.current.cadence); }
      else { metrics.current.frames++; if (interval > metrics.current.threshold) metrics.current.slow++; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const refresh = setInterval(() => setDisplay(JSON.stringify(metrics.current)), 400);
    window.__fmotion = { metrics: metrics.current, interact: () => measureInput(() => setDraft(value => ({ ...value, focalX: Math.random() * 2 - 1 }))), seek: measureSeek, snapshot: () => ({ draft, upload, visibility: document.visibilityState }) };
    return () => { cancelAnimationFrame(raf); clearInterval(refresh); };
  }, [draft, upload]);
  useEffect(() => { if (!playing || upload.failed || upload.progress === 100) return; const timer = setTimeout(() => setUpload(state => nextUpload(state)), 80); return () => clearTimeout(timer); }, [playing, upload]);
  const update = (patch: Partial<Draft>) => measureInput(() => setDraft(value => ({ ...value, ...patch })));
  return <main>
    <header><span className="mark">F</span><strong>F-Motion</strong><small>WEB-NATIVE BOUNDARY SPIKE</small></header>
    <section className="workspace">
      <div className="stage">
        <div className="phone">
          <video key={selected.id} ref={video} src={selected.src} playsInline controls loop={shouldLoop(reduced)}
            style={{ objectPosition: `${(draft.focalX + 1) * 50}% ${(draft.focalY + 1) * 50}%` }}
            onLoadedData={() => { if (!started.current) { started.current = true; metrics.current.startup = performance.now(); } }}
            onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} />
          <div className="safe-caption">{draft.caption}</div>
        </div>
        <button onClick={() => video.current?.paused ? video.current.play() : video.current?.pause()}>{playing ? "Pause" : "Play once"}</button>
        <button onClick={() => measureSeek()}>Seek</button>
      </div>
      <aside>
        <h1>Shape the frame</h1>
        <p>Native playback, focused controls, no production services.</p>
        <label>Scene<select value={draft.selected} onChange={e => update({ selected: e.target.value })}>{draft.order.map(id => { const scene = scenes.find(item => item.id === id)!; return <option key={id} value={id}>{scene.label}</option>; })}</select></label>
        <button onClick={() => update({ order: reorder(draft.order, draft.order[1]), selected: draft.order[1] })}>Move second scene first</button>
        <label>Focal X<input aria-label="Focal X" type="range" min="-1" max="1" step=".01" value={draft.focalX} onChange={e => update({ focalX: +e.target.value })}/></label>
        <label>Focal Y<input aria-label="Focal Y" type="range" min="-1" max="1" step=".01" value={draft.focalY} onChange={e => update({ focalY: +e.target.value })}/></label>
        <label>Caption<textarea maxLength={80} value={draft.caption} onChange={e => update({ caption: e.target.value })}/></label>
        <label>Embedded audio<input type="range" min="0" max="1" step=".01" value={draft.volume} onChange={e => { update({ volume: +e.target.value }); if (video.current) video.current.volume = +e.target.value * (draft.ducking ? .7 : 1); }}/></label>
        <label className="check"><input type="checkbox" checked={draft.ducking} onChange={e => update({ ducking: e.target.checked })}/>30% ducking</label>
        <button onClick={() => { setUpload({ progress: 0, failed: false, retried: false }); setPlaying(true); }}>Mock upload</button>
        {upload.failed && <button onClick={() => setUpload(value => ({ ...value, failed: false, retried: true }))}>Retry from 40%</button>}
        <output>Upload {upload.progress}% {upload.failed ? "failed as designed" : ""}</output>
        <details><summary>Diagnostics</summary><pre>{display}</pre></details>
      </aside>
    </section>
  </main>;
}
createRoot(document.getElementById("root")!).render(<App />);
