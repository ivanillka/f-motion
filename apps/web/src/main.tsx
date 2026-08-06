import { StrictMode, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ApiClient,
  ApiResponseError,
  buildStoryboardDraft,
  defaultVideoArchitecture,
  loadSceneMediaViews,
  recommendVideoArchitecture,
  sceneDurationForMedia,
  type ProjectSnapshot,
  type ProjectSummary,
  type Scene,
  type SceneMediaView,
  type VideoArchitecture
} from "./api";
import { AuthConfigurationError, createAuthGateway } from "./auth";
import { clearImportedProject, isImportedProjectId, rememberImportedProject } from "./imported-project";
import "./style.css";

type Step = "sign-in" | "drafts" | "brief" | "architecture" | "media" | "editor" | "render" | "settings";
interface PexelsMatch {
  id: number;
  creator: string;
  attributionUrl: string;
  previewUrl: string;
}
interface FalCredentialView {
  provider: "fal";
  connected: boolean;
  hint?: string;
  validated_at?: string;
}
interface PexelsCredentialView {
  provider: "pexels";
  connected: boolean;
  hint?: string;
  validated_at?: string;
}
interface FeatureLock {
  title: string;
  message: string;
  action?: "settings";
}
interface HostUsageView {
  unit: "render_unit";
  balance: number;
  free_grant: number;
  costs: { preview: number; final: number };
}
interface ApiKeyView {
  id: string;
  label: string;
  hint: string;
  created_at: string;
  revoked_at?: string;
}

const architectureLabels = {
  goal: { story: "Tell a story", explain: "Explain something", promote: "Promote an idea or product", educate: "Teach the viewer" },
  audience: { general: "General viewers", social: "Social media audience", customers: "Customers", internal: "Internal team" },
  structure: { story_arc: "Beginning → turn → resolution", mystery: "Clues → tension → reveal", problem_solution: "Problem → solution → result", chronological: "Chronological journey" },
  tone: { cinematic: "Cinematic", documentary: "Documentary", energetic: "Energetic", calm: "Calm" },
  pace: { slow: "Slow and atmospheric", balanced: "Balanced", fast: "Fast and punchy" },
  media: { stock: "Pexels real stock video", own: "My own media", mixed: "Pexels stock + my media" }
} as const;

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
  const [architecture, setArchitecture] = useState<VideoArchitecture>(defaultVideoArchitecture);
  const [project, setProject] = useState<ProjectSnapshot>();
  const [activeSceneId, setActiveSceneId] = useState("");
  const [drafts, setDrafts] = useState<ProjectSummary[]>([]);
  const [draftsLoading, setDraftsLoading] = useState(false);
  const [sceneMedia, setSceneMedia] = useState<Record<string, SceneMediaView>>({});
  const mediaTransition = useRef(0);
  const searchTransition = useRef(0);
  const searchAbort = useRef<AbortController | null>(null);
  const [candidates, setCandidates] = useState<PexelsMatch[]>([]);
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [status, setStatus] = useState("");
  const [falCredential, setFalCredential] = useState<FalCredentialView>();
  const [falUnavailable, setFalUnavailable] = useState(false);
  const [falKey, setFalKey] = useState("");
  const [falBusy, setFalBusy] = useState(false);
  const [pexelsCredential, setPexelsCredential] = useState<PexelsCredentialView>();
  const [pexelsUnavailable, setPexelsUnavailable] = useState(false);
  const [pexelsKey, setPexelsKey] = useState("");
  const [pexelsBusy, setPexelsBusy] = useState(false);
  const [featureLock, setFeatureLock] = useState<FeatureLock>();
  const [hostUsage, setHostUsage] = useState<HostUsageView>();
  const [apiKeys, setApiKeys] = useState<ApiKeyView[]>([]);
  const [apiKeyLabel, setApiKeyLabel] = useState("agent");
  const [createdApiToken, setCreatedApiToken] = useState("");
  const [apiKeysBusy, setApiKeysBusy] = useState(false);
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
  const [previewRevision, setPreviewRevision] = useState<number>();
  const [previewMetadata, setPreviewMetadata] = useState<Record<string, string | number | boolean | null>>({});
  const upload = useRef<HTMLInputElement>(null);
  const importedProjectRef = useRef("");
  const [pendingImportId, setPendingImportId] = useState(() => {
    if (typeof sessionStorage === "undefined") return "";
    return rememberImportedProject(location.href, sessionStorage);
  });
  const renderLabel = import.meta.env.VITE_RENDER_LABEL?.trim() || "720p preview";

  function clearSessionState() {
    tokenRef.current = "";
    setToken("");
    setProject(undefined);
    setActiveSceneId("");
    setDrafts([]);
    mediaTransition.current += 1;
    setSceneMedia({});
    searchAbort.current?.abort();
    setCandidates([]);
    setConflict(undefined);
    setJobId("");
    setDownloadUrl("");
    setPreviewRevision(undefined);
    setPreviewMetadata({});
    setProgress({ phase: "queued", percent: 0 });
    setStatus("");
    setFalCredential(undefined);
    setFalUnavailable(false);
    setFalKey("");
    setFalBusy(false);
    setPexelsCredential(undefined);
    setPexelsUnavailable(false);
    setPexelsKey("");
    setPexelsBusy(false);
    setFeatureLock(undefined);
    setHostUsage(undefined);
    setApiKeys([]);
    setApiKeyLabel("agent");
    setCreatedApiToken("");
    setApiKeysBusy(false);
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
    if (!token) return;
    void loadFalCredential();
    void loadPexelsCredential();
    void loadHostUsage();
    void loadApiKeys();
  }, [token]);

  useEffect(() => {
    if (step !== "settings") {
      setFalKey("");
      setPexelsKey("");
      setCreatedApiToken("");
    }
  }, [step]);

  useEffect(() => {
    const pendingId = rememberImportedProject(location.href, sessionStorage);
    setPendingImportId(pendingId);
    if (!token) {
      if (pendingId && authReady) {
        setStatus("Sign in to open the imported draft from Fotium.");
      }
      return;
    }
    if (!isImportedProjectId(pendingId) || importedProjectRef.current === pendingId) return;
    importedProjectRef.current = pendingId;
    void openDraft(pendingId).then((opened) => {
      if (!opened) return;
      clearImportedProject(sessionStorage);
      setPendingImportId("");
      const url = new URL(location.href);
      url.searchParams.delete("project");
      history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    });
  }, [token, authReady]);

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

  useEffect(() => {
    if (step !== "editor" || !project || !Object.values(sceneMedia).some(({ state }) => state === "admitted" || state === "inspecting")) return;
    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      try {
        const views = await loadSceneMediaViews(api, project);
        if (cancelled) return;
        setSceneMedia(views);
        if (Object.values(views).some(({ state }) => state === "admitted" || state === "inspecting")) {
          timeout = setTimeout(() => void refresh(), 1_000);
        }
      } catch {
        if (!cancelled) setStatus("Media processing status could not be refreshed.");
      }
    };
    timeout = setTimeout(() => void refresh(), 1_000);
    return () => {
      cancelled = true;
      if (timeout) clearTimeout(timeout);
    };
  }, [api, project, sceneMedia, step]);

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
    let createdNow = false;
    if (!current) {
      const body = await api.request<{ project: ProjectSnapshot }>("/api/projects", {
        method: "POST",
        body: JSON.stringify({
          purpose: draft,
          audience: architecture.audience,
          tone: `${architecture.tone}, ${architecture.pace}`
        })
      });
      current = body.project;
      createdNow = true;
      localStorage.setItem("fengine-project", current.id);
    }
    current = await initializeScene(current);
    if (createdNow) {
      current = await api.command(current.id, current.revision, "replace_storyboard", {
        scenes: buildStoryboardDraft(draft, () => crypto.randomUUID(), architecture)
      });
    }
    setProject(current);
    setActiveSceneId((active) => current.scenes.some(({ id }) => id === active) ? active : (current.scenes[0]?.id ?? ""));
    return current;
  }

  async function createStoryboard() {
    if (busy) return;
    mediaTransition.current += 1;
    setSceneMedia({});
    setBusy(true);
    setStatus("Creating an editable storyboard…");
    try {
      await prepareProject();
      setStatus("Storyboard ready. Review each footage search, then choose media.");
      setStep(architecture.media === "own" ? "media" : "editor");
    } catch {
      setStatus("Your storyboard could not be created. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function openDraft(projectId: string): Promise<boolean> {
    const transition = ++mediaTransition.current;
    setSceneMedia({});
    setStatus("Opening draft…");
    try {
      const { project: opened } = await api.getProject(projectId);
      const initialized = await initializeScene(opened);
      if (transition !== mediaTransition.current) return false;
      setProject(initialized);
      setActiveSceneId(initialized.scenes[0]?.id ?? "");
      localStorage.setItem("fengine-project", initialized.id);
      setDraft(initialized.brief.purpose);
      let hydrationFailed = false;
      try {
        const views = await loadSceneMediaViews(api, initialized);
        if (transition !== mediaTransition.current) return false;
        setSceneMedia(views);
      } catch {
        hydrationFailed = true;
      }
      if (transition !== mediaTransition.current) return false;
      setStep("editor");
      setStatus(hydrationFailed ? "Draft media details could not be loaded." : "");
      return true;
    } catch {
      if (transition === mediaTransition.current) setStatus("Draft could not be opened.");
      return false;
    }
  }

  function startCreate() {
    mediaTransition.current += 1;
    setProject(undefined);
    setActiveSceneId("");
    setSceneMedia({});
    setCandidates([]);
    setArchitecture(defaultVideoArchitecture);
    setDraft(localStorage.getItem("fengine-draft") ?? "");
    setStatus("");
    setStep("brief");
  }

  function continueToArchitecture() {
    setArchitecture(recommendVideoArchitecture(draft));
    setStatus("");
    setStep("architecture");
  }

  async function saveScenePatch(sceneId: string, patch: Partial<Scene>) {
    const scene = project?.scenes.find(({ id }) => id === sceneId);
    if (!project || !scene) return;
    setStatus("Saving…");
    try {
      const updated = await api.command(project.id, project.revision, "update_scene", {
        scene: { ...scene, ...patch, ...(patch.caption !== undefined ? { caption_cues: undefined } : {}) }
      });
      setProject(updated);
      setStatus("✓ All changes saved");
    } catch (error) {
      if (error instanceof ApiResponseError && error.status === 409) {
        setConflict(error.body.authoritative_snapshot as unknown as ProjectSnapshot);
        return;
      }
      setStatus("Scene changes could not be saved.");
    }
  }

  /** Inspection is bound to the intended scene ID so async completion cannot drift. */
  async function attachMediaWhenReady(
    assetId: string,
    projectId: string,
    intendedSceneId: string
  ): Promise<boolean> {
    setStatus("Waiting for media inspection…");
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const media = await api.request<SceneMediaView>(`/api/projects/${projectId}/media/${assetId}`);
      if (media.state === "ready") {
        const { project: latest } = await api.getProject(projectId);
        const scene = latest.scenes.find(({ id }) => id === intendedSceneId);
        if (!scene) return false;
        const updated = await api.command(projectId, latest.revision, "update_scene", {
          scene: {
            ...scene,
            duration_ms: sceneDurationForMedia(media.detected?.duration_ms, scene.duration_ms),
            media_id: assetId
          }
        });
        setProject(updated);
        setSceneMedia((current) => ({ ...current, [media.id]: media }));
        setStep("editor");
        return true;
      }
      if (media.state !== "admitted" && media.state !== "inspecting") return false;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    setStatus("Media is still inspecting — try again in a moment.");
    return false;
  }

  async function moveScene(sceneId: string, to: number) {
    if (!project) return;
    try {
      const updated = await api.command(project.id, project.revision, "reorder_scene", { scene_id: sceneId, to });
      setProject(updated);
      setStatus("✓ All changes saved");
    } catch (error) {
      if (error instanceof ApiResponseError && error.status === 409) {
        setConflict(error.body.authoritative_snapshot as unknown as ProjectSnapshot);
        return;
      }
      setStatus("Scene order could not be saved.");
    }
  }

  async function addScene() {
    if (!project || project.scenes.length >= 8) return;
    const activeIndex = Math.max(0, project.scenes.findIndex(({ id }) => id === activeSceneId));
    const scene: Scene = {
      id: crypto.randomUUID(), order: activeIndex + 1, caption: "",
      visual_prompt: `${project.brief.purpose.slice(0, 210).trim()} — additional visual beat`,
      duration_ms: 3000, focal_x: 0.5, focal_y: 0.5, motion: "none", audio_level: 1, ducking: false
    };
    try {
      const updated = await api.command(project.id, project.revision, "add_scene", { scene, at: activeIndex + 1 });
      setProject(updated);
      setActiveSceneId(scene.id);
      setStatus("Scene added.");
    } catch (error) {
      if (error instanceof ApiResponseError && error.status === 409) setConflict(error.body.authoritative_snapshot as unknown as ProjectSnapshot);
      else setStatus("Scene could not be added.");
    }
  }

  async function removeScene(sceneId: string) {
    if (!project || project.scenes.length <= 1) return;
    const index = project.scenes.findIndex(({ id }) => id === sceneId);
    try {
      const updated = await api.command(project.id, project.revision, "remove_scene", { scene_id: sceneId });
      setProject(updated);
      if (activeSceneId === sceneId) setActiveSceneId(updated.scenes[Math.min(index, updated.scenes.length - 1)]?.id ?? "");
      setStatus("Scene removed.");
    } catch (error) {
      if (error instanceof ApiResponseError && error.status === 409) setConflict(error.body.authoritative_snapshot as unknown as ProjectSnapshot);
      else setStatus("Scene could not be removed.");
    }
  }

  async function searchStock(sceneId: string) {
    const scene = project?.scenes.find(({ id }) => id === sceneId);
    const query = scene?.visual_prompt?.trim().slice(0, 100);
    if (!query) return;
    searchAbort.current?.abort();
    const controller = new AbortController();
    searchAbort.current = controller;
    const transition = ++searchTransition.current;
    setCandidates([]);
    setStatus("Finding licensed options for this scene…");
    try {
      const body = await api.request<{ results: PexelsMatch[] }>(`/api/pexels/search?q=${encodeURIComponent(query)}`, { signal: controller.signal });
      if (transition !== searchTransition.current || activeSceneId !== sceneId) return;
      setCandidates(body.results.slice(0, 3));
      setStatus(body.results.length ? "Choose the footage that fits this scene." : "No licensed options found. Refine the footage search.");
    } catch (error) {
      if (!controller.signal.aborted) {
        const type = error instanceof ApiResponseError ? error.body.type : undefined;
        setStatus(type === "pexels_not_connected"
          ? "Connect your Pexels API key in Settings, or upload your own media."
          : "Licensed media search failed. Your scene edits are safe.");
      }
    }
  }

  async function selectStock(sceneId: string, candidate: PexelsMatch) {
    if (!project) return;
    const scene = project.scenes.find(({ id }) => id === sceneId);
    const query = scene?.visual_prompt?.trim().slice(0, 100);
    if (!scene || !query) return;
    setBusy(true);
    setStatus(`Copying video by ${candidate.creator} for inspection…`);
    try {
      const body = await api.request<{ asset: { id: string } }>(`/api/projects/${project.id}/media/pexels`, {
        method: "POST",
        body: JSON.stringify({ query, pexels_id: candidate.id })
      });
      if (await attachMediaWhenReady(body.asset.id, project.id, sceneId)) {
        setStatus(`Scene media selected · video by ${candidate.creator} on Pexels`);
      }
    } catch (error) {
      const type = error instanceof ApiResponseError ? error.body.type : undefined;
      setStatus(type === "pexels_not_connected"
        ? "Connect your Pexels API key in Settings, or upload your own media."
        : "That licensed visual could not be attached. Choose another or try again.");
    } finally {
      setBusy(false);
    }
  }

  async function admitFile(file: File, intendedSceneId: string) {
    if (!project || !project.scenes.some(({ id }) => id === intendedSceneId)) return;
    mediaTransition.current += 1;
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
      if (await attachMediaWhenReady(admission.asset_id, project.id, intendedSceneId)) setStatus("Media attached to this scene.");
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
    setStatus("Saving as new project…");
    const body = await api.request<{ project: ProjectSnapshot }>("/api/projects", {
      method: "POST",
      body: JSON.stringify(brief)
    });
    let updated = body.project;
    updated = await api.command(updated.id, updated.revision, "select_concept", { concept_id: "direct" });
    const scenes = (source.scenes.length ? source.scenes : buildStoryboardDraft(brief.purpose, () => crypto.randomUUID())).map((scene, order) => {
      const { media_id: _mediaId, ...withoutMedia } = scene;
      return {
        ...withoutMedia,
        id: crypto.randomUUID(),
        order,
        visual_prompt: scene.visual_prompt || `${brief.purpose.slice(0, 210).trim()} — scene ${order + 1}`
      };
    });
    updated = await api.command(updated.id, updated.revision, "replace_storyboard", { scenes });
    setProject(updated);
    setActiveSceneId(updated.scenes[0]?.id ?? "");
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
            const result = await api.request<{ url: string; metadata?: Record<string, string | number | boolean | null> }>(`/api/render-jobs/${id}/download`);
            setDownloadUrl(result.url);
            setPreviewMetadata(result.metadata ?? {});
            setPreviewRevision(project?.revision);
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
    const job = await api.request<{ job_id: string }>(`/api/projects/${project.id}/render`, {
      method: "POST",
      body: JSON.stringify({ kind: "preview" })
    });
    setJobId(job.job_id);
    setStep("render");
    await followRender(job.job_id);
  }

  async function retryRender() {
    setDownloadUrl("");
    setProgress({ phase: "queued", percent: 0 });
    await requestRender();
  }

  async function refreshPreviewUrl() {
    if (!jobId) return;
    try {
      const result = await api.request<{ url: string }>(`/api/render-jobs/${jobId}/download`);
      setDownloadUrl(result.url);
    } catch {
      setStatus("Preview link expired and could not be refreshed.");
    }
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

  async function loadHostUsage() {
    try {
      setHostUsage(await api.request<HostUsageView>("/api/me/usage"));
    } catch {
      setHostUsage(undefined);
    }
  }

  async function loadApiKeys() {
    try {
      const view = await api.request<{ keys: ApiKeyView[] }>("/api/me/api-keys");
      setApiKeys(view.keys.filter((key) => !key.revoked_at));
    } catch {
      setApiKeys([]);
    }
  }

  async function createApiKey() {
    setApiKeysBusy(true);
    try {
      const created = await api.request<ApiKeyView & { token: string }>("/api/me/api-keys", {
        method: "POST",
        body: JSON.stringify({ label: apiKeyLabel.trim() || "agent" })
      });
      setCreatedApiToken(created.token);
      setStatus("API key created. Copy it now — it will not be shown again.");
      await loadApiKeys();
    } catch {
      setStatus("API key could not be created.");
    } finally {
      setApiKeysBusy(false);
    }
  }

  async function revokeApiKey(keyId: string) {
    if (!window.confirm("Revoke this API key? Agents using it will stop working.")) return;
    setApiKeysBusy(true);
    try {
      await api.request(`/api/me/api-keys/${keyId}`, { method: "DELETE" });
      if (createdApiToken) setCreatedApiToken("");
      setStatus("API key revoked.");
      await loadApiKeys();
    } catch {
      setStatus("API key could not be revoked.");
    } finally {
      setApiKeysBusy(false);
    }
  }

  async function loadFalCredential() {
    setFalBusy(true);
    try {
      const view = await api.request<FalCredentialView>("/api/providers/fal/credential");
      setFalCredential(view);
      setFalUnavailable(false);
    } catch (error) {
      setFalCredential(undefined);
      setFalUnavailable(error instanceof ApiResponseError && error.status === 503);
    } finally {
      setFalBusy(false);
    }
  }

  async function loadPexelsCredential() {
    setPexelsBusy(true);
    try {
      const view = await api.request<PexelsCredentialView>("/api/providers/pexels/credential");
      setPexelsCredential(view);
      setPexelsUnavailable(false);
    } catch (error) {
      setPexelsCredential(undefined);
      setPexelsUnavailable(error instanceof ApiResponseError && error.status === 503);
    } finally {
      setPexelsBusy(false);
    }
  }

  async function connectPexels() {
    if (!pexelsKey.trim()) return;
    if (pexelsCredential?.connected && !window.confirm("Replace your saved Pexels API key?")) return;
    setPexelsBusy(true);
    try {
      const view = await api.request<PexelsCredentialView>("/api/providers/pexels/credential", {
        method: "PUT",
        body: JSON.stringify({ api_key: pexelsKey })
      });
      setPexelsCredential(view);
      setPexelsUnavailable(false);
      setStatus("Pexels connected. Licensed searches now use your encrypted key.");
    } catch (error) {
      const type = error instanceof ApiResponseError ? error.body.type : undefined;
      setStatus(type === "invalid_provider_credential"
        ? "Pexels rejected this API key. Check it and try again."
        : type === "provider_unavailable"
          ? "Pexels could not be reached. Your existing projects are safe."
          : "Pexels could not be connected.");
    } finally {
      setPexelsKey("");
      setPexelsBusy(false);
    }
  }

  async function testPexels() {
    setPexelsBusy(true);
    try {
      const view = await api.request<PexelsCredentialView>("/api/providers/pexels/credential/test", { method: "POST" });
      setPexelsCredential(view);
      setStatus("Pexels connection verified.");
    } catch (error) {
      const type = error instanceof ApiResponseError ? error.body.type : undefined;
      setStatus(type === "invalid_provider_credential"
        ? "Pexels rejected the saved key. Replace or disconnect it."
        : "Pexels could not verify the saved key. Try again later.");
    } finally {
      setPexelsBusy(false);
    }
  }

  async function disconnectPexels() {
    if (!window.confirm("Disconnect Pexels and delete your saved encrypted key? Licensed search will stop working.")) return;
    setPexelsBusy(true);
    try {
      await api.request("/api/providers/pexels/credential", { method: "DELETE" });
      setPexelsCredential({ provider: "pexels", connected: false });
      setPexelsKey("");
      setStatus("Pexels disconnected. You can still upload your own media.");
    } catch {
      setStatus("Pexels could not be disconnected. Try again.");
    } finally {
      setPexelsBusy(false);
    }
  }

  async function connectFal() {
    if (!falKey.trim()) return;
    if (falCredential?.connected && !window.confirm("Replace your saved FAL API key? Active generation must finish first.")) return;
    setFalBusy(true);
    try {
      const view = await api.request<FalCredentialView>("/api/providers/fal/credential", {
        method: "PUT",
        body: JSON.stringify({ api_key: falKey })
      });
      setFalCredential(view);
      setFalUnavailable(false);
      setStatus("FAL connected. The key is encrypted and will never be shown again.");
    } catch (error) {
      const type = error instanceof ApiResponseError ? error.body.type : undefined;
      setStatus(type === "invalid_provider_credential"
        ? "FAL rejected this API key. Create an API-scope key and try again."
        : type === "provider_unavailable"
          ? "FAL could not be reached. Your existing projects are safe."
          : "FAL could not be connected.");
    } finally {
      setFalKey("");
      setFalBusy(false);
    }
  }

  async function testFal() {
    setFalBusy(true);
    try {
      const view = await api.request<FalCredentialView>("/api/providers/fal/credential/test", { method: "POST" });
      setFalCredential(view);
      setStatus("FAL connection verified.");
    } catch (error) {
      const type = error instanceof ApiResponseError ? error.body.type : undefined;
      setStatus(type === "invalid_provider_credential"
        ? "FAL rejected the saved key. Replace or disconnect it."
        : "FAL could not verify the saved key. Try again later.");
    } finally {
      setFalBusy(false);
    }
  }

  async function disconnectFal() {
    if (!window.confirm("Disconnect FAL and delete your saved encrypted key?")) return;
    setFalBusy(true);
    try {
      await api.request("/api/providers/fal/credential", { method: "DELETE" });
      setFalCredential({ provider: "fal", connected: false });
      setFalKey("");
      setStatus("FAL disconnected.");
    } catch {
      setStatus("FAL could not be disconnected. Try again.");
    } finally {
      setFalBusy(false);
    }
  }

  function showPexelsLock() {
    setFeatureLock(pexelsUnavailable
      ? { title: "Pexels is unavailable", message: "This deployment cannot connect Pexels. Upload your own media instead." }
      : { title: "Pexels stock is locked", message: "Connect your Pexels API key to search real stock video.", action: "settings" });
  }

  function showFalLock() {
    setFeatureLock(falCredential?.connected
      ? { title: "AI generation is not live yet", message: "Your FAL key is connected. Nothing else is required for now." }
      : { title: "FAL generation is locked", message: "Connect your FAL API key now. AI video and voice will unlock when the workflow launches.", action: "settings" });
  }

  function showFutureLock() {
    setFeatureLock({ title: "More providers are coming", message: "This option is not available yet. No setup is required." });
  }

  const activeScene = project?.scenes.find(({ id }) => id === activeSceneId)
    ?? project?.scenes[0]; // read-only fallback for an old/recovered selection
  const activeSceneNumber = activeScene ? activeScene.order + 1 : 0;
  const activeMediaId = activeScene?.media_id;
  const activeMedia = activeMediaId ? sceneMedia[activeMediaId] : undefined;
  const activePreviewUrl = activeMedia?.previewUrl ?? activeMedia?.attribution?.previewUrl;
  const allScenesHaveMedia = Boolean(project?.scenes.length && project.scenes.every(({ media_id }) =>
    media_id && sceneMedia[media_id]?.state === "ready"));

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
      <p>{pendingImportId
        ? "Sign in to open the imported draft from Fotium."
        : "Sign in to keep projects private."}</p>
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
      <aside className="provider-preview" aria-label="Creation sources">
        <button className="provider-preview-item" data-locked={!pexelsCredential?.connected} onClick={() => pexelsCredential?.connected ? setStep("settings") : showPexelsLock()}>
          <strong>Pexels</strong><span>Real stock video · {pexelsCredential?.connected ? "unlocked" : "locked"}</span>
        </button>
        <button className="provider-preview-item" data-locked onClick={showFalLock}>
          <strong>FAL</strong><span>AI video + voice · locked</span>
        </button>
        <button className="provider-preview-item" data-locked onClick={showFutureLock}>
          <strong>More</strong><span>New providers · locked</span>
        </button>
        <button className="secondary" onClick={() => setStep("settings")}>Choose video sources</button>
      </aside>
      <button onClick={startCreate}>Create new video</button>
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
      <p>Describe the subject, audience, mood, intended result, media you have, and preferred length in your own words. F-Motion will recommend a complete video plan.</p>
      <label>Visual description<textarea value={draft} maxLength={500} onChange={(event) => setDraft(event.target.value)} placeholder="A remote island in dark ocean fog, an abandoned lighthouse, cinematic aerial shot…" /></label>
      <button disabled={!draft.trim()} onClick={continueToArchitecture}>Continue to video plan</button>
      <p role="status" aria-live="polite">{status}</p>
      <button className="secondary" disabled={busy} onClick={() => setStep("drafts")}>Back to drafts</button>
    </section>}
    {authReady && step === "architecture" && <section>
      <h1>Plan the video</h1>
      <p>F-Motion prepared this recommendation from your conversation. Build it as proposed, or unfold the details to edit any decision.</p>
      <dl className="architecture-summary" aria-label="Recommended video plan">
        <div><dt>Goal</dt><dd>{architectureLabels.goal[architecture.goal]}</dd></div>
        <div><dt>Audience</dt><dd>{architectureLabels.audience[architecture.audience]}</dd></div>
        <div><dt>Story</dt><dd>{architectureLabels.structure[architecture.structure]}</dd></div>
        <div><dt>Style</dt><dd>{architectureLabels.tone[architecture.tone]} · {architectureLabels.pace[architecture.pace]}</dd></div>
        <div><dt>Length</dt><dd>About {architecture.durationSeconds} seconds</dd></div>
        <div><dt>Visuals</dt><dd>{architectureLabels.media[architecture.media]}</dd></div>
      </dl>
      <details className="architecture-editor">
        <summary>Edit recommended video plan</summary>
        <p>Optional: adjust the decisions before F-Motion builds the storyboard and footage searches.</p>
        <div className="architecture-grid">
        <label>What should this video achieve?<select value={architecture.goal} onChange={(event) => setArchitecture({ ...architecture, goal: event.target.value as VideoArchitecture["goal"] })}>
          <option value="story">Tell a story</option><option value="explain">Explain something</option><option value="promote">Promote an idea or product</option><option value="educate">Teach the viewer</option>
        </select></label>
        <label>Who is it for?<select value={architecture.audience} onChange={(event) => setArchitecture({ ...architecture, audience: event.target.value as VideoArchitecture["audience"] })}>
          <option value="general">General viewers</option><option value="social">Social media audience</option><option value="customers">Customers</option><option value="internal">Internal team</option>
        </select></label>
        <label>How should the story unfold?<select value={architecture.structure} onChange={(event) => setArchitecture({ ...architecture, structure: event.target.value as VideoArchitecture["structure"] })}>
          <option value="story_arc">Beginning → turn → resolution</option><option value="mystery">Clues → tension → reveal</option><option value="problem_solution">Problem → solution → result</option><option value="chronological">Chronological journey</option>
        </select></label>
        <label>What tone fits best?<select value={architecture.tone} onChange={(event) => setArchitecture({ ...architecture, tone: event.target.value as VideoArchitecture["tone"] })}>
          <option value="cinematic">Cinematic</option><option value="documentary">Documentary</option><option value="energetic">Energetic</option><option value="calm">Calm</option>
        </select></label>
        <label>How fast should it feel?<select value={architecture.pace} onChange={(event) => setArchitecture({ ...architecture, pace: event.target.value as VideoArchitecture["pace"] })}>
          <option value="slow">Slow and atmospheric</option><option value="balanced">Balanced</option><option value="fast">Fast and punchy</option>
        </select></label>
        <label>Target length<select value={architecture.durationSeconds} onChange={(event) => setArchitecture({ ...architecture, durationSeconds: Number(event.target.value) as VideoArchitecture["durationSeconds"] })}>
          <option value="15">About 15 seconds · 4 scenes</option><option value="30">About 30 seconds · 5 scenes</option><option value="45">About 45 seconds · 6 scenes</option>
        </select></label>
        <label>Where should visuals come from?<select value={architecture.media} onChange={(event) => setArchitecture({ ...architecture, media: event.target.value as VideoArchitecture["media"] })}>
          <option value="stock">Pexels real stock video</option><option value="own">My own media</option><option value="mixed">Mix Pexels stock and my media</option>
        </select></label>
        </div>
      </details>
      <button disabled={busy} onClick={() => void createStoryboard()}>{busy ? "Building video plan…" : "Build storyboard"}</button>
      <button className="secondary" disabled={busy} onClick={() => setStep("brief")}>Back to description</button>
      <p role="status" aria-live="polite">{status}</p>
    </section>}
    {authReady && step === "media" && project && <section>
      <h1>Upload your media</h1>
      <p>Choose one JPEG, PNG, or MP4 you have permission to use. It is inspected before it can be rendered.</p>
      <input ref={upload} hidden type="file" accept="video/mp4,image/jpeg,image/png" onChange={(event) => {
        const file = event.target.files?.[0];
        if (file && activeScene) void admitFile(file, activeScene.id);
      }} />
      <button disabled={busy} onClick={() => upload.current?.click()}>Choose a file</button>
      <p role="status" aria-live="polite">{status}</p>
      <button className="secondary" disabled={busy} onClick={() => setStep("editor")}>Back to storyboard</button>
    </section>}
    {authReady && step === "editor" && project && activeScene && <section className="editor">
      <h1>Storyboard</h1>
      <p>Review each beat and its selected media. Replace it only when another visual fits better.</p>
      <nav className="scene-strip" aria-label="Storyboard scenes">{project.scenes.map((scene) => {
        const media = scene.media_id ? sceneMedia[scene.media_id] : undefined;
        const previewUrl = media?.previewUrl ?? media?.attribution?.previewUrl;
        return <button
          key={scene.id}
          className="scene-card"
          aria-pressed={scene.id === activeScene.id}
          aria-label={`Edit scene ${scene.order + 1}`}
          onClick={() => {
            searchAbort.current?.abort();
            searchTransition.current += 1;
            setCandidates([]);
            setActiveSceneId(scene.id);
          }}
        >
          {previewUrl
            ? media?.detected?.type === "video/mp4"
              ? <video src={previewUrl} muted playsInline preload="metadata" />
              : <img src={previewUrl} alt="" />
            : <span className="scene-empty">{media ? "Media processing" : "No media"}</span>}
          <strong>Scene {scene.order + 1}</strong>
          <span>{scene.caption || scene.visual_prompt}</span>
        </button>;
      })}</nav>

      <div className="editor-grid" key={`${activeScene.id}:${project.revision}`}>
        <div>
          <p className="notice">Approximate composition — accurate rendered preview comes next.</p>
          <div className="preview" aria-label={`Approximate preview for scene ${activeSceneNumber}`}>
        {activePreviewUrl && (activeMedia?.detected?.type === "video/mp4"
          ? <video src={activePreviewUrl} muted loop playsInline controls preload="metadata" />
          : <img src={activePreviewUrl} alt={activeMedia?.attribution ? `Selected stock video by ${activeMedia.attribution.creator}` : "Selected gallery media"} />)}
        {activeMedia && !activePreviewUrl && <span>{activeMedia.state === "ready" ? "Preview unavailable" : "Media processing…"}</span>}
            {!activeMedia && <span>Choose stock or upload media</span>}
            <span>{activeScene.caption}</span>
          </div>
          {activeMedia?.attribution && <p>
            Video by <a href={activeMedia.attribution.attributionUrl} target="_blank" rel="noreferrer">{activeMedia.attribution.creator}</a>
            {" · "}<a href="https://www.pexels.com" target="_blank" rel="noreferrer">Pexels</a>
          </p>}
        </div>

        <div className="scene-controls">
          <label htmlFor={`prompt-${activeScene.id}`}>Scene {activeSceneNumber} {activeMedia ? "visual note" : "footage search"}
            <textarea id={`prompt-${activeScene.id}`} maxLength={100} defaultValue={activeScene.visual_prompt ?? ""} onBlur={(event) => void saveScenePatch(activeScene.id, { visual_prompt: event.currentTarget.value.trim() })} />
            <small>{activeMedia
              ? "Existing media is selected. This note is only used if you search for a replacement."
              : "Use concrete terms Pexels can match: subject, location, action, shot type, and mood. Maximum 100 characters."}</small>
          </label>
          <label htmlFor={`caption-${activeScene.id}`}>Scene {activeSceneNumber} caption
            <input id={`caption-${activeScene.id}`} maxLength={180} defaultValue={activeScene.caption} onBlur={(event) => void saveScenePatch(activeScene.id, { caption: event.currentTarget.value })} />
          </label>
          <label htmlFor={`duration-${activeScene.id}`}>Scene {activeSceneNumber} duration (seconds)
            <input id={`duration-${activeScene.id}`} type="number" min="0.5" max="15" step="0.1" defaultValue={activeScene.duration_ms / 1000} onBlur={(event) => void saveScenePatch(activeScene.id, { duration_ms: Math.round(event.currentTarget.valueAsNumber * 1000) })} />
          </label>
          <label htmlFor={`motion-${activeScene.id}`}>Scene {activeSceneNumber} motion
            <select id={`motion-${activeScene.id}`} value={activeScene.motion} onChange={(event) => void saveScenePatch(activeScene.id, { motion: event.target.value as Scene["motion"] })}>
              <option value="none">None</option><option value="push">Push</option><option value="zoom">Zoom</option>
            </select>
          </label>
          <label htmlFor={`focal-x-${activeScene.id}`}>Scene {activeSceneNumber} horizontal focus · {activeScene.focal_x.toFixed(2)}
            <input id={`focal-x-${activeScene.id}`} type="range" min="0" max="1" step="0.05" defaultValue={activeScene.focal_x} onBlur={(event) => void saveScenePatch(activeScene.id, { focal_x: event.currentTarget.valueAsNumber })} />
          </label>
          <label htmlFor={`focal-y-${activeScene.id}`}>Scene {activeSceneNumber} vertical focus · {activeScene.focal_y.toFixed(2)}
            <input id={`focal-y-${activeScene.id}`} type="range" min="0" max="1" step="0.05" defaultValue={activeScene.focal_y} onBlur={(event) => void saveScenePatch(activeScene.id, { focal_y: event.currentTarget.valueAsNumber })} />
          </label>
          <label htmlFor={`audio-${activeScene.id}`}>Scene {activeSceneNumber} source audio · {Math.round(activeScene.audio_level * 100)}%
            <input id={`audio-${activeScene.id}`} type="range" min="0" max="1" step="0.05" defaultValue={activeScene.audio_level} onBlur={(event) => void saveScenePatch(activeScene.id, { audio_level: event.currentTarget.valueAsNumber })} />
          </label>
          <button className="secondary" onClick={() => void saveScenePatch(activeScene.id, { audio_level: activeScene.audio_level === 0 ? 1 : 0 })}>{activeScene.audio_level === 0 ? `Unmute scene ${activeSceneNumber}` : `Mute scene ${activeSceneNumber}`}</button>
          <button className={!pexelsCredential?.connected ? "locked-feature" : undefined}
            disabled={busy || (Boolean(pexelsCredential?.connected) && !activeScene.visual_prompt)}
            onClick={() => pexelsCredential?.connected ? void searchStock(activeScene.id) : showPexelsLock()}>
            {!pexelsCredential?.connected ? "🔒 " : ""}Find licensed media for scene {activeSceneNumber}
          </button>
        </div>
      </div>

      {candidates.length > 0 && <div className="candidates" aria-label={`Licensed media options for scene ${activeSceneNumber}`}>{candidates.map((candidate) => <article key={candidate.id} className="candidate">
        <img src={candidate.previewUrl} alt={`Pexels preview by ${candidate.creator}`} />
        <a href={candidate.attributionUrl} target="_blank" rel="noreferrer">{candidate.creator} on Pexels</a>
        <button disabled={busy} onClick={() => void selectStock(activeScene.id, candidate)}>Select for scene {activeSceneNumber}</button>
      </article>)}</div>}

      <div className="scene-actions">
        <button className="secondary" disabled={activeScene.order === 0} onClick={() => void moveScene(activeScene.id, activeScene.order - 1)}>Move scene {activeSceneNumber} earlier</button>
        <button className="secondary" disabled={activeScene.order === project.scenes.length - 1} onClick={() => void moveScene(activeScene.id, activeScene.order + 1)}>Move scene {activeSceneNumber} later</button>
        <button className="secondary" disabled={project.scenes.length >= 8} onClick={() => void addScene()}>Add scene</button>
        <button className="secondary" disabled={project.scenes.length <= 1} onClick={() => void removeScene(activeScene.id)}>Remove scene {activeSceneNumber}</button>
      </div>

      <input ref={upload} hidden type="file" accept="video/mp4,image/jpeg,image/png" onChange={(event) => {
        const file = event.target.files?.[0];
        if (file) void admitFile(file, activeScene.id);
      }} />
      <button className="secondary" disabled={busy} onClick={() => upload.current?.click()}>Upload media for scene {activeSceneNumber}</button>
      <p role="status">{status || "✓ All changes saved"}</p>
      <button disabled={!allScenesHaveMedia} onClick={() => void requestRender()}>Generate accurate preview</button>
      {!allScenesHaveMedia && <p>{project.scenes.every(({ media_id }) => media_id)
        ? "Media is processing. Preview unlocks automatically when every scene is ready."
        : "Add media to every scene before rendering."}</p>}
      {downloadUrl && <button className="secondary" onClick={() => setStep("render")}>View accurate preview{previewRevision !== project.revision ? " · older" : ""}</button>}
      <button className="secondary" onClick={() => setStep("brief")}>Start a different description</button>
      <button className="secondary" onClick={() => setStep("drafts")}>Back to drafts</button>
      {conflict && <dialog open><h2>Newer changes exist</h2><p>Your changes were not merged.</p>
        <button onClick={() => { setProject(conflict); setActiveSceneId(conflict.scenes.some(({ id }) => id === activeScene.id) ? activeScene.id : (conflict.scenes[0]?.id ?? "")); setConflict(undefined); }}>Reload latest</button>
        <button onClick={() => void saveAsNewProject()}>Save as new project</button>
      </dialog>}
    </section>}
    {authReady && step === "render" && <section>
      <h1>Accurate preview</h1>
      <p role="status">{progress.phase === "failed" ? "Accurate preview failed — try again or keep editing." : `${progress.phase} · ${renderLabel}`}</p>
      <progress value={progress.percent} max="100">{progress.percent}%</progress>
      {downloadUrl && <video controls playsInline preload="metadata" src={downloadUrl} onError={() => void refreshPreviewUrl()}>
        Your browser cannot play this MP4 preview. Use the download link instead.
      </video>}
      {downloadUrl && <p>{previewMetadata.width && previewMetadata.height ? `${previewMetadata.width}×${previewMetadata.height}` : "Rendered MP4"}
        {previewMetadata.duration_ms ? ` · ${(Number(previewMetadata.duration_ms) / 1000).toFixed(1)} seconds` : ""}
        {previewMetadata.audio_status ? ` · audio ${previewMetadata.audio_status}` : ""}</p>}
      {previewRevision !== undefined && project && previewRevision !== project.revision && <p className="notice">Older preview — regenerate after your edits.</p>}
      <div>
        <button disabled={progress.phase === "complete" || progress.phase === "cancelled" || progress.phase === "failed"} onClick={() => void cancelRender()}>Cancel render</button>
        {(progress.phase === "failed" || progress.phase === "cancelled") && <button onClick={() => void retryRender()}>Retry</button>}
        <a href={downloadUrl} download><button disabled={!downloadUrl || progress.phase === "failed"}>Download preview</button></a>
      </div>
      <button className="secondary" onClick={() => setStep("editor")}>Keep editing</button>
    </section>}
    {authReady && step === "settings" && <section>
      <h1>Choose your video sources</h1>
      <p>Connect only the services you want to use. Each provider stays under your account and uses your own API key.</p>
      <article className="settings-card" aria-labelledby="usage-settings-title">
        <h2 id="usage-settings-title">Host API usage</h2>
        <p>Renders consume free starter units on your F-Motion account, then paid top-ups. This meters host work only — FAL and Pexels stay on your own keys.</p>
        {hostUsage
          ? <p>{hostUsage.balance} {hostUsage.unit}s remaining · preview costs {hostUsage.costs.preview}, final costs {hostUsage.costs.final} · starter grant {hostUsage.free_grant}</p>
          : <p className="notice">Usage balance is unavailable on this deployment.</p>}
        <p><small>Paid top-up checkout is not wired yet; operators can credit balances server-side.</small></p>
      </article>
      <article className="settings-card" aria-labelledby="api-keys-settings-title">
        <h2 id="api-keys-settings-title">Machine API keys</h2>
        <p>Create a key for CLI, MCP, or agent tools. Send it as <code>Authorization: Bearer fm_…</code>. The secret is shown once.</p>
        <label htmlFor="api-key-label">Label
          <input id="api-key-label" value={apiKeyLabel} onChange={(event) => setApiKeyLabel(event.target.value)} maxLength={64} />
        </label>
        <div className="settings-actions">
          <button disabled={apiKeysBusy} onClick={() => void createApiKey()}>Create API key</button>
        </div>
        {createdApiToken && <p role="status"><code>{createdApiToken}</code></p>}
        {apiKeys.length === 0
          ? <p role="status">No active API keys.</p>
          : <ul>{apiKeys.map((key) =>
            <li key={key.id}>
              {key.label} · …{key.hint} · created {new Date(key.created_at).toLocaleString()}
              {" "}
              <button className="secondary" disabled={apiKeysBusy} onClick={() => void revokeApiKey(key.id)}>Revoke</button>
            </li>)}</ul>}
      </article>
      <div className="provider-onboarding" aria-label="Video source options">
        <article className={`provider-card ${pexelsCredential?.connected ? "provider-live" : "provider-locked"}`}>
          <span className={`provider-status ${pexelsCredential?.connected ? "" : "provider-soon"}`}>{pexelsCredential?.connected ? "Unlocked" : "Locked"}</span>
          <h2>Pexels</h2>
          <strong>Real stock video</strong>
          <p>Search licensed footage from real creators and select it scene by scene.</p>
          {pexelsCredential?.connected
            ? <a href="#pexels-settings-title">Manage Pexels</a>
            : <button className="lock-trigger" onClick={showPexelsLock}>Why is this locked?</button>}
        </article>
        <article className="provider-card">
          <span className="provider-status provider-soon">Locked</span>
          <h2>FAL</h2>
          <strong>AI video + voice</strong>
          <p>Connect your key now. AI video and voice generation will appear here after the generation workflow and cost confirmation are enabled.</p>
          <button className="lock-trigger" onClick={showFalLock}>Why is this locked?</button>
        </article>
        <article className="provider-card provider-future">
          <span className="provider-status provider-soon">Coming soon</span>
          <h2>More providers</h2>
          <strong>More ways to create</strong>
          <p>Additional stock, AI video, voice, and media services can join the same provider flow.</p>
          <button className="lock-trigger" onClick={showFutureLock}>Why is this locked?</button>
        </article>
      </div>
      <p>Pexels videos require on-product attribution — see “Use video by … · Pexels” in the editor when you add stock footage.</p>
      <article className="settings-card" aria-labelledby="pexels-settings-title">
        <h2 id="pexels-settings-title">Pexels licensed media</h2>
        <p>Connect your own Pexels API key. Licensed searches use your Pexels account; F-Motion does not supply or share a Pexels key.</p>
        {pexelsUnavailable && <p className="notice">Pexels connection is unavailable here. Uploading, editing, and rendering still work.</p>}
        {!pexelsUnavailable && pexelsCredential?.connected && <p>
          Connected · key ending …{pexelsCredential.hint}
          {pexelsCredential.validated_at ? ` · verified ${new Date(pexelsCredential.validated_at).toLocaleString()}` : ""}
        </p>}
        {!pexelsUnavailable && <label htmlFor="pexels-key">{pexelsCredential?.connected ? "Replacement Pexels API key" : "Pexels API key"}
          <input id="pexels-key" type="password" autoComplete="new-password" spellCheck={false}
            value={pexelsKey} onChange={(event) => setPexelsKey(event.target.value)} placeholder="Paste your Pexels API key" />
          <small>The key is validated, encrypted server-side, and never shown again.</small>
        </label>}
        {!pexelsUnavailable && <div className="settings-actions">
          <button disabled={pexelsBusy || !pexelsKey.trim()} onClick={() => void connectPexels()}>{pexelsCredential?.connected ? "Replace key" : "Connect Pexels"}</button>
          {pexelsCredential?.connected && <button className="secondary" disabled={pexelsBusy} onClick={() => void testPexels()}>Test Pexels</button>}
          {pexelsCredential?.connected && <button className="secondary" disabled={pexelsBusy} onClick={() => void disconnectPexels()}>Disconnect Pexels</button>}
        </div>}
        <a href="https://www.pexels.com/api/" target="_blank" rel="noreferrer">Get a Pexels API key</a>
      </article>
      <article className="settings-card" aria-labelledby="fal-settings-title">
        <h2 id="fal-settings-title">FAL generation</h2>
        <p>Connect your own FAL API-scope key for the planned AI video and voice workflow. Future generation will be charged directly to your FAL account after you see the estimated cost and confirm it. Generation is not live yet, and F-Motion does not supply or share a FAL key.</p>
        {falUnavailable && <p className="notice">FAL connection is unavailable here. Uploads, Pexels, editing, and rendering still work.</p>}
        {!falUnavailable && falCredential?.connected && <p>
          Connected · key ending …{falCredential.hint}
          {falCredential.validated_at ? ` · verified ${new Date(falCredential.validated_at).toLocaleString()}` : ""}
        </p>}
        {!falUnavailable && <label htmlFor="fal-key">{falCredential?.connected ? "Replacement FAL API key" : "FAL API key"}
          <input
            id="fal-key"
            type="password"
            autoComplete="new-password"
            spellCheck={false}
            value={falKey}
            onChange={(event) => setFalKey(event.target.value)}
            placeholder="Paste an API-scope key"
          />
          <small>Create an API-scope key in FAL. F-Motion can verify that it calls models, but FAL does not provide scope introspection.</small>
        </label>}
        {!falUnavailable && <div className="settings-actions">
          <button disabled={falBusy || !falKey.trim()} onClick={() => void connectFal()}>{falCredential?.connected ? "Replace key" : "Connect FAL"}</button>
          {falCredential?.connected && <button className="secondary" disabled={falBusy} onClick={() => void testFal()}>Test connection</button>}
          {falCredential?.connected && <button className="secondary" disabled={falBusy} onClick={() => void disconnectFal()}>Disconnect</button>}
        </div>}
        <a href="https://fal.ai/dashboard/keys" target="_blank" rel="noreferrer">Open FAL API keys</a>
      </article>
      <p>Privacy and terms will ship with Gate 0 launch policy evidence.</p>
      <p role="status" aria-live="polite">{status}</p>
      <button disabled={authBusy} onClick={() => void signOut()}>Sign out</button>
      <button className="secondary" onClick={() => { setFalKey(""); setPexelsKey(""); setStep("drafts"); }}>Back to drafts</button>
    </section>}
    {featureLock && <dialog open aria-labelledby="feature-lock-title">
      <span className="lock-label">Locked</span>
      <h2 id="feature-lock-title">{featureLock.title}</h2>
      <p>{featureLock.message}</p>
      {featureLock.action === "settings" && <button onClick={() => { setFeatureLock(undefined); setStep("settings"); }}>Open provider settings</button>}
      <button className="secondary" onClick={() => setFeatureLock(undefined)}>Close</button>
    </dialog>}
  </main>;
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
