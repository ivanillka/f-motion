import { useEffect, useMemo, useRef, useState } from "react";
import {
  ApiClient,
  advanceBrief,
  briefPurposeFromChat,
  mediaNotesFromGlances,
  type BriefQuestion,
  type BriefQuestionId
} from "./api";
import { AuthConfigurationError, createAuthGateway, studioOrigin } from "./auth";
import { glanceLocalMedia } from "./local-media";
import { SplashSky } from "./MarketingPages";
import "./marketing.css";

const WALLS = ["front", "right", "back", "left"] as const;
const CUBE_FACES = ["front", "back", "right", "left", "top", "bottom"] as const;
const ASK_CHIPS: Record<string, readonly string[]> = {
  topic: ["Story", "Launch", "Lesson", "Mystery"],
  intent: ["Story", "Explain", "Promote", "Teach"],
  audience: ["Anyone", "Social", "Customers", "Team"],
  length: ["15s", "30s", "45s"],
  visuals: ["Stock", "Mine", "Mix"]
};
const CHIP_SEND: Record<string, string> = {
  Story: "A 30-second story",
  Launch: "A product launch reel",
  Lesson: "A how-to lesson",
  Mystery: "A quiet mystery",
  Explain: "Explain something",
  Promote: "Promote an idea or product",
  Teach: "Teach the viewer",
  Anyone: "General viewers",
  Social: "Social media audience",
  Customers: "Customers",
  Team: "Internal team",
  "15s": "About 15 seconds",
  "30s": "About 30 seconds",
  "45s": "About 45 seconds",
  Stock: "Pexels real stock video",
  Mine: "My own media",
  Mix: "Mix Pexels stock and my media"
};

function wrapIndex(index: number, n: number): number {
  return ((index % n) + n) % n;
}

function neighborIndex(index: number, wall: number): number {
  const slot = wrapIndex(index, 4);
  const offset = wrapIndex(wall - slot, 4);
  const step = offset === 3 ? -1 : offset;
  return index + step;
}

function askTitle(question?: BriefQuestion): string {
  if (!question || question.id === "topic") return "What to make?";
  if (question.id === "intent") return "What kind?";
  if (question.id === "audience") return "Who for?";
  if (question.id === "length") return "How long?";
  return "Pictures?";
}

function go(path: string): void {
  history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

type Phase = "ask" | "preview" | "bulk" | "progress" | "done";

export function StudioCube() {
  const authSetup = useMemo(() => {
    try {
      return {
        gateway: createAuthGateway({
          url: import.meta.env.VITE_SUPABASE_URL,
          publicKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          origin: studioOrigin(location.href),
          allowDemo: Boolean(import.meta.env.DEV) || import.meta.env.VITE_ALLOW_DEMO_AUTH === "1",
          allowSelfhost: import.meta.env.VITE_SELFHOST_AUTH === "1"
        })
      };
    } catch (error) {
      return { error: error instanceof Error ? error : new AuthConfigurationError() };
    }
  }, []);
  const tokenRef = useRef("");
  const [token, setToken] = useState("");
  const [authReady, setAuthReady] = useState(false);
  const api = useMemo(() => new ApiClient(() => tokenRef.current, () => go("/login")), []);
  const [conversation, setConversation] = useState("");
  const [asked, setAsked] = useState<BriefQuestionId[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [turn, setTurn] = useState(() => advanceBrief("", false, []));
  const [phase, setPhase] = useState<Phase>("ask");
  const [index, setIndex] = useState(0);
  const [yaw, setYaw] = useState(0);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const [projectId, setProjectId] = useState("");
  const [quantity, setQuantity] = useState(3);
  const [quote, setQuote] = useState<{ total: number; balance?: number; payable?: boolean }>();
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [downloads, setDownloads] = useState<string[]>([]);
  const upload = useRef<HTMLInputElement>(null);
  const paceRef = useRef(1);

  useEffect(() => {
    if (!authSetup.gateway) {
      setAuthReady(true);
      return;
    }
    return authSetup.gateway.subscribe((session) => {
      setAuthReady(true);
      tokenRef.current = session?.accessToken ?? "";
      setToken(session?.accessToken ?? "");
      if (!session) go("/login");
    });
  }, [authSetup.gateway]);

  function rotateBy(steps = 1) {
    setYaw((from) => from - 90 * steps);
    setIndex((from) => from + steps);
  }

  function applyTurn(nextConversation: string, nextAsked: BriefQuestionId[], hasMedia: boolean) {
    const next = advanceBrief(nextConversation, hasMedia, nextAsked);
    setConversation(nextConversation);
    setAsked(next.asked);
    setTurn(next);
    if (next.ready) {
      rotateBy(1);
      setPhase("preview");
      void makePreview(nextConversation, hasMedia);
      return;
    }
    rotateBy(1);
  }

  async function glanceAndAsk(list: File[]) {
    const accepted = list.filter((file) => /^(image\/(jpeg|png|webp)|video\/mp4)$/.test(file.type)).slice(0, 8);
    if (!accepted.length) {
      setStatus("JPEG, PNG, WebP, or MP4.");
      return;
    }
    setFiles(accepted);
    const glances = await Promise.all(accepted.slice(0, 8).map((file) => glanceLocalMedia(file)));
    const notes = mediaNotesFromGlances(glances);
    const line = conversation || `I added ${accepted.length} photo${accepted.length === 1 ? "" : "s"}.`;
    applyTurn([line, notes].filter(Boolean).join("\n").slice(0, 2000), asked, true);
  }

  function answer(text: string) {
    const said = CHIP_SEND[text] ?? text.trim();
    if (!said && !files.length) return;
    applyTurn([conversation, said || `I added ${files.length} photos.`].filter(Boolean).join("\n").slice(0, 2000), asked, files.length > 0);
  }

  async function makePreview(talk: string, hasMedia: boolean) {
    setBusy(true);
    setStatus("One preview…");
    try {
      const purpose = briefPurposeFromChat(talk, files.length) || talk.slice(0, 80) || "Untitled";
      const body = await api.compose({
        purpose,
        fill_stock: !hasMedia,
        render: "preview"
      });
      setProjectId(body.project_id);
      if (body.render?.download?.url) {
        setPreviewUrl(body.render.download.url);
        setStatus("");
      } else {
        setStatus(body.next === "needs_media" || body.next === "draft_only"
          ? "No cut yet. Edit to place media."
          : "Preview is not ready.");
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Preview failed.");
    } finally {
      setBusy(false);
    }
  }

  async function loadQuote(nextQty: number) {
    const qty = Math.min(20, Math.max(1, nextQty));
    setQuantity(qty);
    try {
      setQuote(await api.quoteBulk(qty, "final"));
    } catch {
      setQuote({ total: qty * 2 });
    }
  }

  async function runBulk() {
    const purpose = briefPurposeFromChat(conversation, files.length) || conversation.slice(0, 80) || "Untitled";
    rotateBy(1);
    setPhase("progress");
    setBusy(true);
    setDownloads([]);
    setProgress({ done: 0, total: quantity });
    const urls: string[] = [];
    try {
      for (let i = 0; i < quantity; i += 1) {
        setStatus(`Cut ${i + 1} of ${quantity}`);
        const body = await api.compose({
          purpose: quantity === 1 ? purpose : `${purpose} · ${i + 1}`,
          fill_stock: files.length === 0,
          render: "final"
        });
        if (body.render?.download?.url) urls.push(body.render.download.url);
        setProgress({ done: i + 1, total: quantity });
        setDownloads([...urls]);
      }
      rotateBy(1);
      setPhase("done");
      setStatus(urls.length ? "" : "No files came back.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Bulk failed.");
    } finally {
      setBusy(false);
    }
  }

  const question = turn.question;
  const chips = ASK_CHIPS[question?.id ?? "topic"] ?? ASK_CHIPS.topic;

  if (!authReady) {
    return <div className="mkt mkt-is-splash" aria-busy="true" />;
  }

  const face = (at: number) => {
    if (phase === "ask" && at === index) {
      return (
        <div className="cube-face-copy">
          <h1 className="mkt-face-title is-long">{askTitle(question)}</h1>
          <div className="brief-chat-choices cube-chips" role="group" aria-label="Suggested answers">
            {chips.map((choice) =>
              <button key={choice} type="button" className="secondary" onClick={() => answer(choice)}>{choice}</button>)}
          </div>
          <form className="cube-ask" onSubmit={(event) => { event.preventDefault(); const box = event.currentTarget.elements.namedItem("line") as HTMLInputElement; answer(box.value); box.value = ""; }}>
            <input name="line" maxLength={80} placeholder="Or type it" aria-label="Message F-Motion" />
            <button type="button" className="secondary" onClick={() => upload.current?.click()}>Drop</button>
          </form>
        </div>
      );
    }
    if (phase === "preview" && at === index) {
      return (
        <div className="cube-face-copy">
          <h1 className="mkt-face-title is-long">{busy ? "Making…" : "One cut"}</h1>
          {previewUrl ? <video className="cube-preview" src={previewUrl} controls playsInline /> : <p className="mkt-splash-lede">{status || "…"}</p>}
          <div className="cube-chips">
            <button type="button" disabled={busy} onClick={() => { void loadQuote(quantity); rotateBy(1); setPhase("bulk"); }}>Keep</button>
            <button type="button" className="secondary" onClick={() => go(projectId ? `/studio/edit?project=${projectId}` : "/studio/edit")}>Edit</button>
          </div>
        </div>
      );
    }
    if (phase === "bulk" && at === index) {
      return (
        <div className="cube-face-copy">
          <h1 className="mkt-face-title is-long">How many?</h1>
          <div className="cube-qty">
            <button type="button" className="secondary" onClick={() => void loadQuote(quantity - 1)}>-</button>
            <strong>{quantity}</strong>
            <button type="button" className="secondary" onClick={() => void loadQuote(quantity + 1)}>+</button>
          </div>
          <p className="mkt-splash-lede">{quote
            ? `${quote.total} units${quote.balance != null ? ` · ${quote.balance} left` : ""}`
            : "Final units = count × 2"}</p>
          <div className="cube-chips">
            <button type="button" disabled={busy || quote?.payable === false} onClick={() => void runBulk()}>Make</button>
            <button type="button" className="secondary" onClick={() => go(projectId ? `/studio/edit?project=${projectId}` : "/studio/edit")}>Edit</button>
          </div>
        </div>
      );
    }
    if (phase === "progress" && at === index) {
      const pct = progress.total ? Math.round(100 * progress.done / progress.total) : 0;
      return (
        <div className="cube-face-copy">
          <h1 className="mkt-face-title is-long">Making</h1>
          <p className="mkt-splash-lede">{progress.done} / {progress.total}</p>
          <div className="cube-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
            <span style={{ width: `${pct}%` }} />
          </div>
          <p className="mkt-splash-lede">{status}</p>
        </div>
      );
    }
    if (phase === "done" && at === index) {
      return (
        <div className="cube-face-copy">
          <h1 className="mkt-face-title is-long">Ready</h1>
          <div className="cube-chips">
            {downloads.map((url, item) =>
              <a key={url} className="mkt-splash-lede" href={url} download={`f-motion-${item + 1}.mp4`}>Get {item + 1}</a>)}
          </div>
          <div className="cube-chips">
            <button type="button" onClick={() => { setPhase("ask"); setConversation(""); setAsked([]); setTurn(advanceBrief("", false, [])); setFiles([]); setPreviewUrl(""); rotateBy(1); }}>Again</button>
            <button type="button" className="secondary" onClick={() => go("/studio/admin")}>Admin</button>
          </div>
        </div>
      );
    }
    return <p className="mkt-face-title is-long" aria-hidden="true">{at < index ? "·" : "·"}</p>;
  };

  return (
    <div className="mkt mkt-is-splash cube-studio">
      <SplashSky paceRef={paceRef} />
      <section className="mkt-splash" aria-label="Create slides">
        <div className="mkt-cube-scene">
          <div className="mkt-cube-rig" style={{ transform: `rotateX(8deg) rotateY(${yaw}deg)` }}>
            <div className="mkt-cube">
              {CUBE_FACES.map((side) => <span key={side} className="mkt-cube-face" data-side={side} aria-hidden="true" />)}
              <div className="mkt-cube-shell" aria-hidden="true">
                {CUBE_FACES.map((side) => <span key={`in-${side}`} className="mkt-cube-face is-inner" data-side={side} />)}
              </div>
              {WALLS.map((side, wall) => {
                const at = neighborIndex(index, wall);
                const facing = at === index;
                return (
                  <div key={side} className={facing ? "mkt-cube-core is-facing" : "mkt-cube-core is-away"} data-side={side} aria-hidden={facing ? undefined : true}>
                    {face(at)}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        <nav className="mkt-splash-features" aria-label="Studio">
          <a href="/">Home</a>
          <a href="/studio/admin">Admin</a>
          <a href="/studio/edit">Edit</a>
        </nav>
        <input ref={upload} hidden type="file" multiple accept="video/mp4,image/jpeg,image/png,image/webp" onChange={(event) => {
          if (event.target.files) void glanceAndAsk([...event.target.files]);
          event.target.value = "";
        }} />
        {token && status && phase === "ask" ? <p className="cube-status" role="status">{status}</p> : null}
      </section>
    </div>
  );
}
