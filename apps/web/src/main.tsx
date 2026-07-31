import { StrictMode, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ApiClient,
  ApiResponseError,
  loadSceneMediaViews,
  sceneDurationForMedia,
  type ProjectSnapshot,
  type ProjectSummary,
  type Scene,
  type SceneMediaView
} from "./api";
import { AuthConfigurationError, createAuthGateway } from "./auth";
import "./style.css";

type Step = "sign-in" | "drafts" | "brief" | "media" | "editor" | "render" | "settings";
interface PexelsMatch {
  id: number;
  creator: string;
  attributionUrl: string;
  previewUrl: string;
}

function App() {
  const authSetup = useMemo(() => {
    try {
      return {
        gateway: createAuthGateway({
          url: import.meta.env.VITE_SUPABASE_URL,
          publicKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          origin: location.origin,
          allowDemo: Boolean(import.meta.env.DEV) || import.meta.env.VITE_ALLOW_DEMO_AUTH === "1"
        })
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error : new AuthConfigurationError()
      };
    }
  }, []);
  const tokenRef = useRef("");
  const [token, setToken] = useState("");
  const [authReady, setAuthReady] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [step, setStep] = useState<Step>("sign-in");
  const [email, setEmail] = useState("");
  const [draft, setDraft] = useState(() => localStorage.getItem("fengine-draft") ?? "");
  const [project, setProject] = useState<ProjectSnapshot>();
  const [drafts, setDrafts] = useState<ProjectSummary[]>([]);
  const [draftsLoading, setDraftsLoading] = useState(false);
  const [sceneMedia, setSceneMedia] = useState<Record<string, SceneMediaView>>({});
  const mediaTransition = useRef(0);
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [status, setStatus] = useState("");
  const api = useMemo(() => new ApiClient(
    () => tokenRef.current,
    () => {
      void authSetup.gateway?.signOut()
        .catch(() => undefined)
        .finally(() => setStatus("Your session expired. Please sign in again."));
    }
  ), [authSetup.gateway]);
  const [conflict, setConflict] = useState<ProjectSnapshot>();
  const [jobId, setJobId] = useState("");
  const [progress, setProgress] = useState({ phase: "queued", percent: 0 });
  const [downloadUrl, setDownloadUrl] = useState("");
  const upload = useRef<HTMLInputElement>(null);
  const renderLabel = import.meta.env.VITE_RENDER_LABEL?.trim() || "720p preview";

  function clearSessionState() {
    tokenRef.current = "";
    setToken("");
    setProject(undefined);
    setDrafts([]);
    mediaTransition.current += 1;
    setSceneMedia({});
    setConflict(undefined);
    setJobId("");
    setDownloadUrl("");
    setProgress({ phase: "queued", percent: 0 });
    setStatus("");
    setStep("sign-in");
  }

  useEffect(() => {
    if (!authSetup.gateway) {
      setAuthReady(true);
      setStatus(authSetup.error?.message ?? "Sign-in is not configured for this deployment.");
      return;
    }
    return authSetup.gateway.subscribe((session) => {
      setAuthReady(true);
      if (!session) {
        clearSessionState();
        return;
      }
      tokenRef.current = session.accessToken;
      setToken(session.accessToken);
      const callback = new URL(location.href);
      if (callback.searchParams.has("code")) {
        callback.searchParams.delete("code");
        history.replaceState(null, "", `${callback.pathname}${callback.search}${callback.hash}`);
      }
      setStep((current) => current === "sign-in" ? "drafts" : current);
    });
  }, [authSetup.error, authSetup.gateway]);

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
  useEffect(() => localStorage.setItem("fengine-draft", draft), [draft]);

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
    if (!authSetup.gateway) return;
    setAuthBusy(true);
    try {
      await authSetup.gateway.sendMagicLink(email);
      if (import.meta.env.DEV || import.meta.env.VITE_ALLOW_DEMO_AUTH === "1") {
        setStatus("");
      } else {
        setStatus("Check your email for the sign-in link.");
      }
    } catch {
      setStatus("Sign-in link could not be sent.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function googleSignIn() {
    if (!authSetup.gateway) return;
    setAuthBusy(true);
    try {
      await authSetup.gateway.signInWithGoogle();
    } catch {
      setStatus("Google sign-in could not be started.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function initializeScene(snapshot: ProjectSnapshot): Promise<ProjectSnapshot> {
    if (snapshot.scenes.length) return snapshot;
    return api.command(snapshot.id, snapshot.revision, "select_concept", { concept_id: "direct" });
  }

  async function prepareProject(): Promise<ProjectSnapshot> {
    let current = project;
    if (!current) {
      const body = await api.request<{ project: ProjectSnapshot }>("/api/projects", {
        method: "POST",
        body: JSON.stringify({ purpose: draft, audience: "Viewers", tone: "Cinematic" })
      });
      current = body.project;
      localStorage.setItem("fengine-project", current.id);
    }
    current = await initializeScene(current);
    setProject(current);
    return current;
  }

  async function chooseUpload() {
    if (busy) return;
    setBusy(true);
    setStatus("Creating your draft…");
    try {
      await prepareProject();
      setStatus("");
      setStep("media");
    } catch {
      setStatus("Your draft could not be created. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function autoMatchStock() {
    if (busy) return;
    mediaTransition.current += 1;
    setSceneMedia({});
    setBusy(true);
    setStatus("Finding the best licensed visual for your description…");
    try {
      const current = await prepareProject();
      const body = await api.request<{ asset: { id: string }; match: PexelsMatch }>(
        `/api/projects/${current.id}/media/pexels/auto`,
        {
          method: "POST",
          body: JSON.stringify({ description: draft })
        }
      );
      setStatus("Licensed visual selected. Checking it for a safe render…");
      if (await attachMediaWhenReady(body.asset.id, current)) {
        setStatus(`Visual matched automatically · video by ${body.match.creator} on Pexels`);
      }
    } catch {
      setStatus("No suitable licensed visual was found. Make the visual description more concrete or upload your own media.");
    } finally {
      setBusy(false);
    }
  }

  async function openDraft(projectId: string) {
    const transition = ++mediaTransition.current;
    setSceneMedia({});
    setStatus("Opening draft…");
    try {
      const { project: opened } = await api.getProject(projectId);
      const initialized = await initializeScene(opened);
      if (transition !== mediaTransition.current) return;
      setProject(initialized);
      localStorage.setItem("fengine-project", initialized.id);
      setDraft(initialized.scenes[0]?.caption ?? initialized.brief.purpose);
      let hydrationFailed = false;
      try {
        const views = await loadSceneMediaViews(api, initialized);
        if (transition !== mediaTransition.current) return;
        setSceneMedia(views);
      } catch {
        hydrationFailed = true;
      }
      if (transition !== mediaTransition.current) return;
      setStep(initialized.scenes[0]?.media_id ? "editor" : "brief");
      setStatus(hydrationFailed ? "Draft media details could not be loaded." : "");
    } catch {
      if (transition === mediaTransition.current) setStatus("Draft could not be opened.");
    }
  }

  function startCreate() {
    mediaTransition.current += 1;
    setProject(undefined);
    setSceneMedia({});
    setDraft(localStorage.getItem("fengine-draft") ?? "");
    setStatus("");
    setStep("brief");
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
  async function attachMediaWhenReady(
    assetId: string,
    snapshot: ProjectSnapshot | undefined = project
  ): Promise<boolean> {
    if (!snapshot) return false;
    const scene = snapshot.scenes[0];
    if (!scene) return false;
    setStatus("Waiting for media inspection…");
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const media = await api.request<SceneMediaView>(`/api/projects/${snapshot.id}/media/${assetId}`);
      if (media.state === "ready") {
        const updated = await api.command(snapshot.id, snapshot.revision, "update_scene", {
          scene: {
            ...scene,
            caption: draft,
            duration_ms: sceneDurationForMedia(media.detected?.duration_ms, scene.duration_ms),
            media_id: assetId
          }
        });
        setProject(updated);
        setSceneMedia({ [media.id]: media });
        setStep("editor");
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
    mediaTransition.current += 1;
    setSceneMedia({});
    setBusy(true);
    setStatus("Uploading media…");
    try {
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
    } catch {
      setStatus("Media could not be uploaded. Check the file and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function saveAsNewProject() {
    const source = conflict ?? project;
    if (!source) return;
    const brief = source.brief;
    const pendingMotion = project?.scenes[0]?.motion;
    setStatus("Saving as new project…");
    const body = await api.request<{ project: ProjectSnapshot }>("/api/projects", {
      method: "POST",
      body: JSON.stringify(brief)
    });
    let updated = body.project;
    updated = await api.command(updated.id, updated.revision, "select_concept", { concept_id: "direct" });
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
    localStorage.setItem("fengine-project", updated.id);
    setConflict(undefined);
    setStep("editor");
    setStatus("Saved as a new project (media not copied).");
  }

  async function followRender(id: string, lastEventId = "") {
    const deadline = Date.now() + 15 * 60_000;
    while (Date.now() < deadline) {
      const response = await fetch(`/api/render-jobs/${id}/events`, {
        headers: {
          authorization: `Bearer ${tokenRef.current}`,
          ...(lastEventId ? { "last-event-id": lastEventId } : {})
        }
      });
      if (response.status === 401) {
        await authSetup.gateway?.signOut().catch(() => undefined);
        setStatus("Your session expired. Please sign in again.");
        return;
      }
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

  async function signOut() {
    if (!authSetup.gateway) return;
    setAuthBusy(true);
    try {
      await authSetup.gateway.signOut();
      setStatus("");
    } catch {
      setStatus("Sign out could not be completed. Please try again.");
    } finally {
      setAuthBusy(false);
    }
  }

  const activeMediaId = project?.scenes[0]?.media_id;
  const activeMedia = activeMediaId ? sceneMedia[activeMediaId] : undefined;

  return <main>
    <header><strong>F-Engine Reference</strong>
      <div className="header-actions">
        {authReady && token && step !== "sign-in" && <button className="secondary" onClick={() => setStep("settings")}>Settings</button>}
        <span role="status">{online ? "● Connected" : "○ Reconnecting — draft kept locally"}</span>
      </div>
    </header>
    {!authReady && <section><p role="status">Checking session…</p></section>}
    {authReady && step === "sign-in" && <section>
      <h1>Shape a vertical video</h1>
      <p>Sign in to keep projects private.</p>
      <label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
      <button disabled={authBusy || !authSetup.gateway || (Boolean(import.meta.env.VITE_SUPABASE_URL) && !email.trim())} onClick={() => void magicLink()}>Email me a magic link</button>
      {import.meta.env.VITE_ENABLE_GOOGLE_AUTH === "1"
        ? <button className="secondary" disabled={authBusy || !authSetup.gateway} onClick={() => void googleSignIn()}>Continue with Google</button>
        : null}
      <p role="status">{status}</p>
    </section>}
    {authReady && step === "drafts" && <section>
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
    {authReady && step === "brief" && <section>
      <h1>What do you want to make?</h1>
      <p>Describe what viewers should see using concrete subjects, setting, mood, weather, and camera style. We will translate it into a visual-first stock search and attach the strongest licensed match automatically.</p>
      <label>Visual description<textarea value={draft} maxLength={500} onChange={(event) => setDraft(event.target.value)} placeholder="A remote island in dark ocean fog, an abandoned lighthouse, cinematic aerial shot…" /></label>
      <button disabled={busy || !draft.trim()} onClick={() => void autoMatchStock()}>
        {busy ? "Finding the best visual…" : "Create with licensed stock"}
      </button>
      <button className="secondary" disabled={busy || !draft.trim()} onClick={() => void chooseUpload()}>Use my own media instead</button>
      <p role="status" aria-live="polite">{status}</p>
      <button className="secondary" disabled={busy} onClick={() => setStep("drafts")}>Back to drafts</button>
    </section>}
    {authReady && step === "media" && project && <section>
      <h1>Upload your media</h1>
      <p>Choose one JPEG, PNG, or MP4 you have permission to use. It is inspected before it can be rendered.</p>
      <input ref={upload} hidden type="file" accept="video/mp4,image/jpeg,image/png" onChange={(event) => {
        const file = event.target.files?.[0];
        if (file) void admitFile(file);
      }} />
      <button disabled={busy} onClick={() => upload.current?.click()}>Choose a file</button>
      <p role="status" aria-live="polite">{status}</p>
      <button className="secondary" disabled={busy} onClick={() => setStep("brief")}>Back to description</button>
    </section>}
    {authReady && step === "editor" && project && <section>
      <h1>Video preview</h1>
      <p className="notice">Approximate preview — request an accurate render to verify timing and crop.</p>
      <div className="preview" aria-label="Approximate vertical preview">
        {activeMedia?.attribution?.previewUrl && <img src={activeMedia.attribution.previewUrl} alt={`Automatically selected stock video by ${activeMedia.attribution.creator}`} />}
        {activeMedia?.attribution && !activeMedia.attribution.previewUrl && <span>Preview unavailable</span>}
        <span>{draft}</span>
      </div>
      {activeMedia?.attribution && <p>
        Automatically matched video by <a href={activeMedia.attribution.attributionUrl} target="_blank" rel="noreferrer">{activeMedia.attribution.creator}</a>
        {" · "}<a href="https://www.pexels.com" target="_blank" rel="noreferrer">Pexels</a>
      </p>}
      <label>Caption<input maxLength={180} value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={() => void saveScene()} /></label>
      <label>Motion<select value={project.scenes[0]?.motion ?? "none"} onChange={(event) => void saveMotion(event.target.value as Scene["motion"])}>
        <option value="none">None</option><option value="push">Push</option><option value="zoom">Zoom</option></select></label>
      <p role="status">{status || "✓ All changes saved"}</p>
      <button disabled={!project.scenes[0]?.media_id} onClick={() => void requestRender()}>Render {renderLabel}</button>
      {!project.scenes[0]?.media_id && <p>Add media before rendering.</p>}
      <button className="secondary" onClick={() => setStep("brief")}>Edit description and rematch</button>
      <button className="secondary" onClick={() => { mediaTransition.current += 1; setSceneMedia({}); setStep("media"); }}>Upload different media</button>
      <button className="secondary" onClick={() => setStep("drafts")}>Back to drafts</button>
      {conflict && <dialog open><h2>Newer changes exist</h2><p>Your changes were not merged.</p>
        <button onClick={() => { setProject(conflict); setConflict(undefined); }}>Reload latest</button>
        <button onClick={() => void saveAsNewProject()}>Save as new project</button>
      </dialog>}
    </section>}
    {authReady && step === "render" && <section>
      <h1>Final render</h1>
      <p role="status">{progress.phase === "failed" ? "Final render failed — try again or keep editing." : `${progress.phase} · ${renderLabel}`}</p>
      <progress value={progress.percent} max="100">{progress.percent}%</progress>
      <div>
        <button disabled={progress.phase === "complete" || progress.phase === "cancelled" || progress.phase === "failed"} onClick={() => void cancelRender()}>Cancel render</button>
        {(progress.phase === "failed" || progress.phase === "cancelled") && <button onClick={() => void retryRender()}>Retry</button>}
        <a href={downloadUrl} download><button disabled={!downloadUrl || progress.phase === "failed"}>Download video</button></a>
      </div>
      <button className="secondary" onClick={() => setStep("editor")}>Keep editing</button>
    </section>}
    {authReady && step === "settings" && <section>
      <h1>Settings</h1>
      <p>Pexels videos require on-product attribution — see “Use video by … · Pexels” in the editor when you add stock footage.</p>
      <p>Privacy and terms will ship with Gate 0 launch policy evidence.</p>
      <button disabled={authBusy} onClick={() => void signOut()}>Sign out</button>
      <button className="secondary" onClick={() => setStep("drafts")}>Back to drafts</button>
    </section>}
  </main>;
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
