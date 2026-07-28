import { StrictMode, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ApiClient, ApiResponseError, type Concept, type ProjectSnapshot, type ProjectSummary, type Scene } from "./api";
import "./style.css";

type Step = "sign-in" | "drafts" | "brief" | "concepts" | "editor" | "render" | "settings";

function demoAuthAllowed(): boolean {
  return Boolean(import.meta.env.DEV) || import.meta.env.VITE_ALLOW_DEMO_AUTH === "1";
}

function accessTokenFromLocation(): string {
  const token = new URLSearchParams(location.hash.slice(1)).get("access_token");
  if (token) {
    sessionStorage.setItem("fmotion-access-token", token);
    history.replaceState(null, "", location.pathname);
  }
  return token ?? sessionStorage.getItem("fmotion-access-token") ?? "";
}

function App() {
  const [token, setToken] = useState(accessTokenFromLocation);
  const api = useMemo(() => new ApiClient(() => token), [token]);
  const [step, setStep] = useState<Step>(() => token ? "drafts" : "sign-in");
  const [email, setEmail] = useState("");
  const [draft, setDraft] = useState(() => localStorage.getItem("fmotion-draft") ?? "");
  const [project, setProject] = useState<ProjectSnapshot>();
  const [drafts, setDrafts] = useState<ProjectSummary[]>([]);
  const [draftsLoading, setDraftsLoading] = useState(false);
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [selected, setSelected] = useState("");
  const [online, setOnline] = useState(navigator.onLine);
  const [status, setStatus] = useState("");
  const [conflict, setConflict] = useState<ProjectSnapshot>();
  const [pexelsQuery, setPexelsQuery] = useState("");
  const [pexelsResults, setPexelsResults] = useState<Array<{ id: number; creator: string; attributionUrl: string }>>([]);
  const [jobId, setJobId] = useState("");
  const [progress, setProgress] = useState({ phase: "queued", percent: 0 });
  const [downloadUrl, setDownloadUrl] = useState("");
  const upload = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  useEffect(() => localStorage.setItem("fmotion-draft", draft), [draft]);

  useEffect(() => {
    if (step !== "drafts" || !token) return;
    let cancelled = false;
    setDraftsLoading(true);
    void api.listProjects()
      .then(({ projects }) => {
        if (!cancelled) setDrafts(projects);
      })
      .catch(() => {
        if (!cancelled) setStatus("Drafts could not be loaded.");
      })
      .finally(() => {
        if (!cancelled) setDraftsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api, step, token]);

  async function magicLink() {
    const supabase = import.meta.env.VITE_SUPABASE_URL as string | undefined;
    if (!supabase) {
      if (!demoAuthAllowed()) {
        setStatus("Sign-in is not configured for this deployment.");
        return;
      }
      sessionStorage.setItem("fmotion-access-token", "e2e-test-token");
      setToken("e2e-test-token");
      setStep("drafts");
      return;
    }
    const response = await fetch(`${supabase}/auth/v1/otp`, {
      method: "POST",
      headers: { "content-type": "application/json", apikey: String(import.meta.env.VITE_SUPABASE_ANON_KEY ?? "") },
      body: JSON.stringify({ email, options: { emailRedirectTo: location.origin } })
    });
    setStatus(response.ok ? "Check your email for the sign-in link." : "Sign-in link could not be sent.");
  }

  function googleSignIn() {
    const supabase = import.meta.env.VITE_SUPABASE_URL as string | undefined;
    if (!supabase) {
      if (!demoAuthAllowed()) {
        setStatus("Sign-in is not configured for this deployment.");
        return;
      }
      sessionStorage.setItem("fmotion-access-token", "e2e-test-token");
      setToken("e2e-test-token");
      setStep("drafts");
      return;
    }
    location.assign(`${supabase}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(location.origin)}`);
  }

  async function createProject() {
    const body = await api.request<{ project: ProjectSnapshot; concepts: Concept[] }>("/api/projects", {
      method: "POST",
      body: JSON.stringify({ purpose: draft, audience: "Customers", tone: "Warm" })
    });
    setProject(body.project);
    setConcepts(body.concepts);
    localStorage.setItem("fmotion-project", body.project.id);
    setStep("concepts");
  }

  async function openDraft(projectId: string) {
    setStatus("Opening draft…");
    const { project: opened, concepts: draftConcepts } = await api.getProject(projectId);
    setProject(opened);
    localStorage.setItem("fmotion-project", opened.id);
    setDraft(opened.scenes[0]?.caption ?? opened.brief.purpose);
    setSelected(opened.selected_concept_id ?? "");
    if (opened.scenes.length > 0) {
      setStep("editor");
    } else {
      setConcepts(draftConcepts ?? []);
      setStep("concepts");
    }
    setStatus("");
  }

  function startCreate() {
    setProject(undefined);
    setConcepts([]);
    setSelected("");
    setDraft(localStorage.getItem("fmotion-draft") ?? "");
    setStep("brief");
  }

  async function chooseConcept() {
    if (!project) return;
    const updated = await api.command(project.id, project.revision, "select_concept", { concept_id: selected });
    setProject(updated);
    setStep("editor");
  }

  async function saveScene() {
    const scene = project?.scenes[0];
    if (!project || !scene) return;
    setStatus("Saving…");
    // Clear caption_cues on caption edits so the server re-derives the timed
    // schedule from the new caption instead of burning a stale one.
    const updated = await api.command(project.id, project.revision, "update_scene", {
      scene: { ...scene, caption: draft, caption_cues: undefined }
    });
    setProject(updated);
    setStatus("✓ All changes saved");
  }

  /** Polls until the worker marks the asset ready (or times out) and attaches it to scene 0. */
  async function attachMediaWhenReady(assetId: string): Promise<boolean> {
    if (!project) return false;
    const scene = project.scenes[0];
    if (!scene) return false;
    setStatus("Waiting for media inspection…");
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const media = await api.request<{ id: string; state: string }>(`/api/projects/${project.id}/media/${assetId}`);
      if (media.state === "ready") {
        const updated = await api.command(project.id, project.revision, "update_scene", {
          scene: { ...scene, caption: draft, media_id: assetId }
        });
        setProject(updated);
        return true;
      }
      if (media.state !== "admitted" && media.state !== "inspecting") return false;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    setStatus("Media is still inspecting — try again in a moment.");
    return false;
  }

  async function saveMotion(motion: Scene["motion"]) {
    const scene = project?.scenes[0];
    if (!project || !scene) return;
    setStatus("Saving…");
    try {
      const updated = await api.command(project.id, project.revision, "update_scene", {
        scene: { ...scene, motion }
      });
      setProject(updated);
      setStatus("✓ All changes saved");
    } catch (error) {
      if (error instanceof ApiResponseError && error.status === 409) {
        setConflict(error.body.authoritative_snapshot as unknown as ProjectSnapshot);
        return;
      }
      setStatus("Motion change could not be saved.");
    }
  }

  async function admitFile(file: File) {
    if (!project) return;
    const admission = await api.request<{ asset_id: string; upload_url: string }>(
      `/api/projects/${project.id}/media/uploads`,
      {
        method: "POST",
        body: JSON.stringify({ content_type: file.type, bytes: file.size })
      }
    );
    const uploaded = await fetch(admission.upload_url, {
      method: "PUT",
      headers: { "content-type": file.type },
      body: file
    });
    if (!uploaded.ok) throw new Error("Upload failed");
    await api.request(`/api/projects/${project.id}/media/${admission.asset_id}/complete`, { method: "POST" });
    setStatus("Media uploaded and queued for inspection.");
    if (await attachMediaWhenReady(admission.asset_id)) setStatus("Media attached.");
  }

  async function searchPexels() {
    const body = await api.request<{ results: Array<{ id: number; creator: string; attributionUrl: string }> }>(
      `/api/pexels/search?q=${encodeURIComponent(pexelsQuery)}`
    );
    setPexelsResults(body.results);
  }

  async function copyPexels(id: number) {
    if (!project) return;
    const body = await api.request<{ asset: { id: string } }>(`/api/projects/${project.id}/media/pexels`, {
      method: "POST",
      body: JSON.stringify({ query: pexelsQuery, pexels_id: id })
    });
    setStatus("Pexels media queued for inspection.");
    if (await attachMediaWhenReady(body.asset.id)) setStatus("Pexels media attached with attribution.");
  }

  async function proveConflict() {
    if (!project) return;
    try {
      await api.command(project.id, 0, "select_concept", { concept_id: selected || "direct" });
    } catch (error) {
      if (error instanceof ApiResponseError && error.status === 409) {
        setConflict(error.body.authoritative_snapshot as unknown as ProjectSnapshot);
        return;
      }
      throw error;
    }
  }

  async function saveAsNewProject() {
    const source = conflict ?? project;
    if (!source) return;
    const brief = source.brief;
    const conceptId = selected || source.selected_concept_id;
    const pendingMotion = project?.scenes[0]?.motion;
    setStatus("Saving as new project…");
    const body = await api.request<{ project: ProjectSnapshot; concepts: Concept[] }>("/api/projects", {
      method: "POST",
      body: JSON.stringify(brief)
    });
    let updated = body.project;
    if (conceptId) {
      updated = await api.command(updated.id, updated.revision, "select_concept", { concept_id: conceptId });
    }
    const scene = updated.scenes[0];
    if (scene) {
      const { media_id, ...sceneWithoutMedia } = scene;
      updated = await api.command(updated.id, updated.revision, "update_scene", {
        scene: {
          ...sceneWithoutMedia,
          caption: draft,
          ...(pendingMotion !== undefined ? { motion: pendingMotion } : {}),
          caption_cues: undefined
        }
      });
    }
    setProject(updated);
    localStorage.setItem("fmotion-project", updated.id);
    setConflict(undefined);
    setStep("editor");
    setStatus("Saved as a new project (media not copied).");
  }

  async function followRender(id: string, lastEventId = "") {
    const deadline = Date.now() + 15 * 60_000;
    while (Date.now() < deadline) {
      const response = await fetch(`/api/render-jobs/${id}/events`, {
        headers: {
          authorization: `Bearer ${token}`,
          ...(lastEventId ? { "last-event-id": lastEventId } : {})
        }
      });
      if (!response.ok) throw new Error("Render progress unavailable");
      if (!response.body) throw new Error("Render progress stream unavailable");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let terminal = false;

      while (!terminal) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() ?? "";
        for (const block of blocks) {
          const eventId = block.match(/^id: (.+)$/m)?.[1];
          const data = block.match(/^data: (.+)$/m)?.[1];
          if (!eventId || !data) continue;
          lastEventId = eventId;
          const event = JSON.parse(data) as { phase: string; percent: number };
          setProgress(event);
          if (event.phase === "complete") {
            const result = await api.request<{ url: string }>(`/api/render-jobs/${id}/download`);
            setDownloadUrl(result.url);
            return;
          }
          if (event.phase === "cancelled" || event.phase === "failed") return;
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  async function requestRender() {
    if (!project) return;
    const job = await api.request<{ job_id: string }>(`/api/projects/${project.id}/render`, { method: "POST" });
    setJobId(job.job_id);
    setStep("render");
    await followRender(job.job_id);
  }

  async function retryRender() {
    setDownloadUrl("");
    setProgress({ phase: "queued", percent: 0 });
    await requestRender();
  }

  async function cancelRender() {
    if (!jobId) return;
    await api.request(`/api/render-jobs/${jobId}/cancel`, { method: "POST" });
    setProgress({ phase: "cancelled", percent: 0 });
  }

  function signOut() {
    sessionStorage.removeItem("fmotion-access-token");
    setToken("");
    setProject(undefined);
    setDrafts([]);
    setConcepts([]);
    setSelected("");
    setConflict(undefined);
    setStatus("");
    setJobId("");
    setDownloadUrl("");
    setPexelsResults([]);
    setProgress({ phase: "queued", percent: 0 });
    setStep("sign-in");
  }

  return <main>
    <header><strong>F‑Motion</strong>
      <div className="header-actions">
        {token && step !== "sign-in" && <button className="secondary" onClick={() => setStep("settings")}>Settings</button>}
        <span role="status">{online ? "● Connected" : "○ Reconnecting — draft kept locally"}</span>
      </div>
    </header>
    {step === "sign-in" && <section>
      <h1>Shape a vertical video</h1>
      <p>Sign in to keep projects private.</p>
      <label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
      <button disabled={Boolean(import.meta.env.VITE_SUPABASE_URL) && !email} onClick={() => void magicLink()}>Email me a magic link</button>
      <button className="secondary" onClick={googleSignIn}>Continue with Google</button>
      <p role="status">{status}</p>
    </section>}
    {step === "drafts" && <section>
      <h1>Drafts</h1>
      <p>Pick up where you left off or start a new video.</p>
      <button onClick={startCreate}>Create new video</button>
      <button className="secondary" onClick={() => setStep("settings")}>Settings</button>
      {draftsLoading && <p role="status">Loading drafts…</p>}
      {!draftsLoading && drafts.length === 0 && <p role="status">No drafts yet.</p>}
      <div className="concepts">{drafts.map((item) =>
        <button key={item.id} className="card" onClick={() => void openDraft(item.id)}>
          <strong>{item.brief.purpose || "Untitled draft"}</strong>
          <span>Revision {item.revision}</span>
        </button>)}</div>
      <p role="status">{status}</p>
    </section>}
    {step === "brief" && <section>
      <h1>What should this video achieve?</h1>
      <label>Brief<textarea value={draft} maxLength={500} onChange={(event) => setDraft(event.target.value)} placeholder="Launch a product for small teams…" /></label>
      <button disabled={!draft.trim()} onClick={() => void createProject()}>Review brief</button>
      <button className="secondary" onClick={() => setStep("drafts")}>Back to drafts</button>
    </section>}
    {step === "concepts" && <section>
      <h1>Choose one concept</h1>
      <div className="concepts">{concepts.map((concept) =>
        <button key={concept.id} aria-pressed={selected === concept.id} className="card" onClick={() => setSelected(concept.id)}>
          <strong>{concept.title}</strong><span>{concept.treatment}</span>
        </button>)}</div>
      <button disabled={!selected} onClick={() => void chooseConcept()}>Use {concepts.find(({ id }) => id === selected)?.title ?? "concept"}</button>
    </section>}
    {step === "editor" && project && <section>
      <h1>Storyboard</h1>
      <p className="notice">Approximate preview — request an accurate render to verify timing and crop.</p>
      <div className="preview" aria-label="Approximate vertical preview"><span>{draft}</span></div>
      <label>Caption<input maxLength={180} value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={() => void saveScene()} /></label>
      <label>Motion<select value={project.scenes[0]?.motion ?? "none"} onChange={(event) => void saveMotion(event.target.value as Scene["motion"])}>
        <option value="none">None</option><option value="push">Push</option><option value="zoom">Zoom</option></select></label>
      <label>Duration<input type="range" min="500" max="15000" step="100" value={project.scenes[0]?.duration_ms ?? 3000} readOnly /></label>
      <input ref={upload} hidden type="file" accept="video/mp4,image/jpeg,image/png" onChange={(event) => {
        const file = event.target.files?.[0];
        if (file) void admitFile(file);
      }} />
      <div><button onClick={() => upload.current?.click()}>Upload media</button></div>
      <label>Search Pexels<input value={pexelsQuery} onChange={(event) => setPexelsQuery(event.target.value)} /></label>
      <button className="secondary" disabled={!pexelsQuery} onClick={() => void searchPexels()}>Search Pexels</button>
      {pexelsResults.map((result) => <button key={result.id} className="card" onClick={() => void copyPexels(result.id)}>
        Use video by {result.creator} · Pexels
      </button>)}
      <p role="status">{status || "✓ All changes saved"}</p>
      <button onClick={() => void requestRender()}>Render accurate 720p preview</button>
      <button className="secondary" onClick={() => setStep("drafts")}>Back to drafts</button>
      <button className="secondary" onClick={() => void proveConflict()}>Test stale revision</button>
      {conflict && <dialog open><h2>Newer changes exist</h2><p>Your changes were not merged.</p>
        <button onClick={() => { setProject(conflict); setConflict(undefined); }}>Reload latest</button>
        <button onClick={() => void saveAsNewProject()}>Save as new project</button>
      </dialog>}
    </section>}
    {step === "render" && <section>
      <h1>Accurate preview</h1>
      <p role="status">{progress.phase === "failed" ? "Accurate preview failed — try again or keep editing." : `${progress.phase} · 720p watermarked preview`}</p>
      <progress value={progress.percent} max="100">{progress.percent}%</progress>
      <div>
        <button disabled={progress.phase === "complete" || progress.phase === "cancelled" || progress.phase === "failed"} onClick={() => void cancelRender()}>Cancel render</button>
        {(progress.phase === "failed" || progress.phase === "cancelled") && <button onClick={() => void retryRender()}>Retry</button>}
        <a href={downloadUrl} download><button disabled={!downloadUrl || progress.phase === "failed"}>Download preview</button></a>
      </div>
      <button className="secondary" onClick={() => setStep("editor")}>Keep editing</button>
    </section>}
    {step === "settings" && <section>
      <h1>Settings</h1>
      <p>Pexels videos require on-product attribution — see “Use video by … · Pexels” in the editor when you add stock footage.</p>
      <p>Privacy and terms will ship with Gate 0 launch policy evidence.</p>
      <button onClick={signOut}>Sign out</button>
      <button className="secondary" onClick={() => setStep("drafts")}>Back to drafts</button>
    </section>}
  </main>;
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
