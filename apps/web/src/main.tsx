import { StrictMode, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ApiClient,
  ApiResponseError,
  buildStoryboardDraft,
  conceptsFor,
  defaultVideoArchitecture,
  formatPlayTime,
  livePlayhead,
  liveTimeline,
  loadSceneMediaViews,
  nextLiveSceneId,
  previousLiveSceneId,
  recommendVideoArchitecture,
  sceneDurationForMedia,
  scenePreviewUrl,
  seekLivePlayhead,
  type Concept,
  type ProjectSnapshot,
  type ProjectSummary,
  type Scene,
  type SceneMediaView,
  type VideoArchitecture
} from "./api";
import { AuthConfigurationError, authCallbackError, createAuthGateway, studioOrigin } from "./auth";
import { clearImportedProject, isImportedProjectId, rememberImportedProject } from "./imported-project";
import "./style.css";

type Step = "sign-in" | "drafts" | "brief" | "architecture" | "concepts" | "media" | "editor" | "render" | "settings";
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
interface FalImageQuote {
  endpoint_id: string;
  unit_price: number;
  unit: string;
  currency: string;
  estimated_total: number | null;
  estimated_total_explanation?: string;
}
interface GenerationJobView {
  id: string;
  project_id: string;
  scene_id: string;
  kind: "image" | "image_to_video";
  endpoint_id: string;
  state: string;
  cancel_requested: boolean;
  prompt: string;
  quote: FalImageQuote;
  quote_expires_at: string;
  failure_code?: string;
  result_media?: SceneMediaView;
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
          origin: studioOrigin(location.href),
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
  const [awaitingEmail, setAwaitingEmail] = useState(false);
  const [draft, setDraft] = useState(() => localStorage.getItem("fengine-draft") ?? "");
  const [architecture, setArchitecture] = useState<VideoArchitecture>(defaultVideoArchitecture);
  const [conceptChoices, setConceptChoices] = useState<Concept[]>([]);
  const [project, setProject] = useState<ProjectSnapshot>();
  const [activeSceneId, setActiveSceneId] = useState("");
  const [cropFocus, setCropFocus] = useState({ x: 0.5, y: 0.5 });
  const [livePlaying, setLivePlaying] = useState(false);
  const [playSceneId, setPlaySceneId] = useState("");
  const [playTick, setPlayTick] = useState(0);
  const userPausedPreview = useRef(false);
  const sceneClock = useRef({ startedAt: 0, elapsedAtPause: 0 });
  const [drafts, setDrafts] = useState<ProjectSummary[]>([]);
  const [draftsLoading, setDraftsLoading] = useState(false);
  const [sceneMedia, setSceneMedia] = useState<Record<string, SceneMediaView>>({});
  const [sceneProgress, setSceneProgress] = useState<Record<string, "finding" | "inspecting" | "ready" | "needs_media">>({});
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
  const [falGenOpen, setFalGenOpen] = useState(false);
  const [falGenPrompt, setFalGenPrompt] = useState("");
  const [falGenJob, setFalGenJob] = useState<GenerationJobView>();
  const [falGenBusy, setFalGenBusy] = useState(false);
  const [falVideoOpen, setFalVideoOpen] = useState(false);
  const [falVideoPrompt, setFalVideoPrompt] = useState("");
  const [falVideoJob, setFalVideoJob] = useState<GenerationJobView>();
  const [falVideoBusy, setFalVideoBusy] = useState(false);
  const [pexelsCredential, setPexelsCredential] = useState<PexelsCredentialView>();
  const [pexelsUnavailable, setPexelsUnavailable] = useState(false);
  const [pexelsKey, setPexelsKey] = useState("");
  const [pexelsBusy, setPexelsBusy] = useState(false);
  const [featureLock, setFeatureLock] = useState<FeatureLock>();
  const api = useMemo(() => new ApiClient(
    () => tokenRef.current,
    () => {
      void authSetup.gateway?.signOut()
        .catch(() => undefined)
        .finally(() => setStatus("Your session expired. Please sign in again."));
    }
  ), [authSetup.gateway]);
  const [conflict, setConflict] = useState<ProjectSnapshot>();
  const [conflictNotice, setConflictNotice] = useState<{ sceneId?: string; operation: string }>();
  const [jobId, setJobId] = useState("");
  const [renderKind, setRenderKind] = useState<"preview" | "final">("preview");
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
  const previewRenderLabel = import.meta.env.VITE_RENDER_LABEL?.trim() || "720p preview";
  const renderLabel = renderKind === "final" ? "final export" : previewRenderLabel;
  const renderHeading = renderKind === "final" ? "Final export" : "Accurate preview";
  const downloadLabel = renderKind === "final" ? "Download export" : "Download preview";
  const renderFailedLabel = renderKind === "final"
    ? "Final export failed — try again or keep editing."
    : "Accurate preview failed — try again or keep editing.";
  const olderRenderNotice = renderKind === "final"
    ? "Older export — regenerate after your edits."
    : "Older preview — regenerate after your edits.";

  function openConflict(snapshot: ProjectSnapshot, notice: { sceneId?: string; operation: string }) {
    setConflict(snapshot);
    setConflictNotice(notice);
  }

  function dismissConflict() {
    setConflict(undefined);
    setConflictNotice(undefined);
  }

  function clearSessionState() {
    tokenRef.current = "";
    setToken("");
    setProject(undefined);
    setActiveSceneId("");
    setLivePlaying(false);
    setPlaySceneId("");
    setPlayTick(0);
    userPausedPreview.current = false;
    sceneClock.current = { startedAt: 0, elapsedAtPause: 0 };
    setDrafts([]);
    mediaTransition.current += 1;
    setSceneMedia({});
    setSceneProgress({});
    searchAbort.current?.abort();
    setCandidates([]);
    dismissConflict();
    setJobId("");
    setRenderKind("preview");
    setDownloadUrl("");
    setPreviewRevision(undefined);
    setPreviewMetadata({});
    setProgress({ phase: "queued", percent: 0 });
    setStatus("");
    setFalCredential(undefined);
    setFalUnavailable(false);
    setFalKey("");
    setFalBusy(false);
    setFalGenOpen(false);
    setFalGenPrompt("");
    setFalGenJob(undefined);
    setFalGenBusy(false);
    setFalVideoOpen(false);
    setFalVideoPrompt("");
    setFalVideoJob(undefined);
    setFalVideoBusy(false);
    setPexelsCredential(undefined);
    setPexelsUnavailable(false);
    setPexelsKey("");
    setPexelsBusy(false);
    setFeatureLock(undefined);
    setAwaitingEmail(false);
    setStep("sign-in");
  }

  useEffect(() => {
    if (!authSetup.gateway) {
      setAuthReady(true);
      setStatus(authSetup.error?.message ?? "Sign-in is not configured for this deployment.");
      return;
    }
    const callbackError = authCallbackError(location.href);
    const expiredMessage = callbackError === "otp_expired" || callbackError === "access_denied"
      ? "That sign-in link was already used or expired. Request a new email."
      : "";
    let pendingExpired = expiredMessage;
    if (pendingExpired) {
      const cleaned = new URL(location.href);
      cleaned.searchParams.delete("error_code");
      cleaned.searchParams.delete("error");
      history.replaceState(null, "", `${cleaned.pathname}${cleaned.search}`);
    }
    return authSetup.gateway.subscribe((session) => {
      setAuthReady(true);
      if (!session) {
        clearSessionState();
        if (pendingExpired) {
          setStatus(pendingExpired);
          pendingExpired = "";
        }
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
  }, [token]);

  useEffect(() => {
    if (step !== "settings") {
      setFalKey("");
      setPexelsKey("");
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
      .catch((error) => {
        if (!cancelled) {
          setStatus(error instanceof ApiResponseError && error.status === 403
            ? "This account is not invited to the hosted studio."
            : "Drafts could not be loaded.");
        }
      })
      .finally(() => {
        if (!cancelled) setDraftsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api, step, token]);

  useEffect(() => {
    if (step !== "editor" || !project || !Object.values(sceneMedia).some(({ state }) =>
      state === "admitted" || state === "inspecting" || state === "quarantined")) return;
    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      try {
        const views = await loadSceneMediaViews(api, project);
        if (cancelled) return;
        setSceneMedia(views);
        if (Object.values(views).some(({ state }) =>
          state === "admitted" || state === "inspecting" || state === "quarantined")) {
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
        setAwaitingEmail(false);
      } else {
        setAwaitingEmail(true);
        setStatus("Check your email and open the link. It should return to this studio.");
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

  function briefForConcepts(): ProjectSnapshot["brief"] {
    return {
      purpose: draft,
      audience: architecture.audience,
      tone: `${architecture.tone}, ${architecture.pace}`
    };
  }

  async function continueToConcepts() {
    if (busy) return;
    mediaTransition.current += 1;
    setSceneMedia({});
    setSceneProgress({});
    setBusy(true);
    setStatus("Preparing story concepts…");
    try {
      let current = project;
      if (!current) {
        const body = await api.request<{ project: ProjectSnapshot; concepts?: Concept[] }>("/api/projects", {
          method: "POST",
          body: JSON.stringify(briefForConcepts())
        });
        current = body.project;
        localStorage.setItem("fengine-project", current.id);
        setProject(current);
        setConceptChoices(body.concepts?.length ? body.concepts : [...conceptsFor(briefForConcepts())]);
      } else {
        setConceptChoices([...conceptsFor(current.brief.purpose ? current.brief : briefForConcepts())]);
      }
      setActiveSceneId("");
      setStep("concepts");
      setStatus("Licensed visuals are matched only after you choose a story approach.");
    } catch {
      setStatus("Story concepts could not be prepared. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function chooseConcept(conceptId: string) {
    if (busy || !project) return;
    mediaTransition.current += 1;
    setSceneMedia({});
    setSceneProgress({});
    setBusy(true);
    setStatus("Building the selected storyboard…");
    try {
      let current = project;
      if (!current.scenes.length || current.selected_concept_id !== conceptId) {
        if (current.scenes.length) {
          // ponytail: empty projects are the concept gate; non-empty reselection stays replace-free.
          setStatus("This draft already has scenes. Open it from Drafts to keep editing.");
          return;
        }
        current = await api.command(current.id, current.revision, "select_concept", { concept_id: conceptId });
      }
      setProject(current);
      setActiveSceneId(current.scenes[0]?.id ?? "");
      if (architecture.media === "own") {
        setStatus("Storyboard ready. Upload media for each scene.");
        setStep("media");
        return;
      }
      setStep("editor");
      await fillStockStoryboard(current);
    } catch (error) {
      const type = error instanceof ApiResponseError ? error.type : undefined;
      setStatus(type === "pexels_not_connected"
        ? "Connect your Pexels API key in Settings, or upload your own media."
        : "Your storyboard could not be created. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function openDraft(projectId: string): Promise<boolean> {
    const transition = ++mediaTransition.current;
    setSceneMedia({});
    setStatus("Opening draft…");
    try {
      const found = await api.getProject(projectId);
      const opened = found.project;
      if (transition !== mediaTransition.current) return false;
      setProject(opened);
      setActiveSceneId(opened.scenes[0]?.id ?? "");
      localStorage.setItem("fengine-project", opened.id);
      setDraft(opened.brief.purpose);
      if (!opened.scenes.length) {
        setConceptChoices(found.concepts?.length ? found.concepts : [...conceptsFor(opened.brief)]);
        setStep("concepts");
        setStatus("Licensed visuals are matched only after you choose a story approach.");
        return true;
      }
      let hydrationFailed = false;
      try {
        const views = await loadSceneMediaViews(api, opened);
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
    setSceneProgress({});
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
        openConflict(error.body.authoritative_snapshot as unknown as ProjectSnapshot, {
          sceneId,
          operation: "scene edits"
        });
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
        try {
          const updated = await api.command(projectId, latest.revision, "update_scene", {
            scene: {
              ...scene,
              duration_ms: sceneDurationForMedia(media.detected?.duration_ms, scene.duration_ms),
              media_id: assetId
            }
          });
          setProject(updated);
          setSceneMedia((current) => ({ ...current, [media.id]: media }));
          setSceneProgress((current) => ({ ...current, [intendedSceneId]: "ready" }));
          return true;
        } catch (error) {
          if (error instanceof ApiResponseError && error.status === 409) {
            openConflict(error.body.authoritative_snapshot as unknown as ProjectSnapshot, {
              sceneId: intendedSceneId,
              operation: "media replacement"
            });
            return false;
          }
          throw error;
        }
      }
      if (media.state !== "admitted" && media.state !== "inspecting") return false;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    setStatus("Media is still inspecting — try again in a moment.");
    return false;
  }

  async function fillStockStoryboard(snapshot: ProjectSnapshot): Promise<void> {
    setSceneProgress(Object.fromEntries(
      snapshot.scenes.map((scene) => [scene.id, scene.media_id ? "ready" as const : "finding" as const])
    ));
    setStatus("Finding licensed media for each scene…");
    const body = await api.request<{
      results: Array<{
        scene_id: string;
        state: "matched" | "no_result" | "skipped";
        asset?: { id: string };
      }>;
    }>(`/api/projects/${snapshot.id}/media/pexels/storyboard`, {
      method: "POST",
      body: "{}"
    });
    for (const result of body.results) {
      if (result.state === "skipped") continue;
      if (result.state !== "matched" || !result.asset) {
        setSceneProgress((current) => ({ ...current, [result.scene_id]: "needs_media" }));
        continue;
      }
      setSceneProgress((current) => ({ ...current, [result.scene_id]: "inspecting" }));
      const attached = await attachMediaWhenReady(result.asset.id, snapshot.id, result.scene_id);
      if (!attached) setSceneProgress((current) => ({ ...current, [result.scene_id]: "needs_media" }));
    }
    const { project: refreshed } = await api.getProject(snapshot.id);
    setProject(refreshed);
    setSceneMedia(await loadSceneMediaViews(api, refreshed));
    const readyCount = refreshed.scenes.filter((scene) => scene.media_id).length;
    setStatus(readyCount === refreshed.scenes.length
      ? "Licensed media attached for every scene. Review attribution, then render."
      : `${readyCount} of ${refreshed.scenes.length} scenes have media. Find or upload the rest before rendering.`);
  }

  async function moveScene(sceneId: string, to: number) {
    if (!project) return;
    try {
      const updated = await api.command(project.id, project.revision, "reorder_scene", { scene_id: sceneId, to });
      setProject(updated);
      setStatus("✓ All changes saved");
    } catch (error) {
      if (error instanceof ApiResponseError && error.status === 409) {
        openConflict(error.body.authoritative_snapshot as unknown as ProjectSnapshot, {
          sceneId,
          operation: "scene reorder"
        });
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
      if (error instanceof ApiResponseError && error.status === 409) {
        openConflict(error.body.authoritative_snapshot as unknown as ProjectSnapshot, { operation: "adding a scene" });
      } else setStatus("Scene could not be added.");
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
      if (error instanceof ApiResponseError && error.status === 409) {
        openConflict(error.body.authoritative_snapshot as unknown as ProjectSnapshot, {
          sceneId,
          operation: "removing a scene"
        });
      } else setStatus("Scene could not be removed.");
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
      if (await attachMediaWhenReady(admission.asset_id, project.id, intendedSceneId)) {
        setStatus("Media attached to this scene.");
        setStep("editor");
      }
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
    const conceptId = source.selected_concept_id
      ?? conceptsFor(brief).find(({ id }) => id === "story")?.id
      ?? conceptsFor(brief)[0].id;
    updated = await api.command(updated.id, updated.revision, "select_concept", { concept_id: conceptId });
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
    dismissConflict();
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

  async function requestRender(kind: "preview" | "final" = "preview") {
    if (!project) return;
    setRenderKind(kind);
    setDownloadUrl("");
    setProgress({ phase: "queued", percent: 0 });
    const job = await api.request<{ job_id: string }>(`/api/projects/${project.id}/render`, {
      method: "POST",
      body: JSON.stringify({ kind })
    });
    setJobId(job.job_id);
    setStep("render");
    await followRender(job.job_id);
  }

  async function retryRender() {
    setDownloadUrl("");
    setProgress({ phase: "queued", percent: 0 });
    await requestRender(renderKind);
  }

  async function refreshPreviewUrl() {
    if (!jobId) return;
    try {
      const result = await api.request<{ url: string }>(`/api/render-jobs/${jobId}/download`);
      setDownloadUrl(result.url);
    } catch {
      setStatus(renderKind === "final"
        ? "Export link expired and could not be refreshed."
        : "Preview link expired and could not be refreshed.");
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

  function falJobStorageKey(projectId: string, sceneId: string) {
    return `fengine-fal-job:${projectId}:${sceneId}`;
  }

  function falGenFailureMessage(job: GenerationJobView): string {
    switch (job.failure_code) {
      case "submission_uncertain":
        return "FAL may have started this job. Check your FAL dashboard before generating again.";
      case "inspection_rejected":
        return "The generated image did not pass media inspection.";
      case "credential":
        return "FAL rejected the saved key. Replace or disconnect it in Settings.";
      case "rate_limited":
        return "FAL rate-limited this request. Wait a moment and try again.";
      case "unsafe_output":
        return "FAL blocked this output. Try a different prompt.";
      default:
        return "FAL generation failed. Your scene media was not changed.";
    }
  }

  function openFalGenerate(scene: Scene) {
    if (!falCredential?.connected || falUnavailable) {
      showFalLock();
      return;
    }
    setFalGenPrompt(scene.visual_prompt?.trim() || "");
    setFalGenJob(undefined);
    setFalGenOpen(true);
    const projectId = project?.id;
    if (!projectId) return;
    const stored = localStorage.getItem(falJobStorageKey(projectId, scene.id));
    if (!stored) return;
    void (async () => {
      try {
        const job = await api.request<GenerationJobView>(`/api/generation-jobs/${stored}`);
        setFalGenJob(job);
        setFalGenPrompt(job.prompt);
        if (!["ready", "cancelled", "failed", "submission_uncertain", "quoted"].includes(job.state)) {
          void pollFalGeneration(job.id);
        }
      } catch {
        localStorage.removeItem(falJobStorageKey(projectId, scene.id));
      }
    })();
  }

  async function quoteFalImage() {
    if (!project || !activeScene) return;
    const prompt = falGenPrompt.trim();
    if (!prompt || prompt.length > 500) {
      setStatus("Enter an image prompt between 1 and 500 characters.");
      return;
    }
    setFalGenBusy(true);
    setStatus("Requesting FAL price…");
    try {
      const job = await api.request<GenerationJobView>(
        `/api/projects/${project.id}/scenes/${activeScene.id}/fal/image-quotes`,
        { method: "POST", body: JSON.stringify({ prompt }) }
      );
      setFalGenJob(job);
      localStorage.setItem(falJobStorageKey(project.id, activeScene.id), job.id);
      setStatus("Review the FAL price, then confirm to generate one image.");
    } catch (error) {
      const type = error instanceof ApiResponseError ? error.body.type : undefined;
      setStatus(type === "fal_not_connected"
        ? "Connect your FAL API key in Settings first."
        : type === "fal_generation_busy"
          ? "Only one active FAL generation is allowed. Wait or cancel it."
          : type === "invalid_provider_credential"
            ? "FAL rejected the saved key. Replace it in Settings."
            : "FAL could not price this image. Try again later.");
    } finally {
      setFalGenBusy(false);
    }
  }

  async function confirmFalImage() {
    if (!project || !activeScene || !falGenJob || falGenJob.state !== "quoted") return;
    if (falGenJob.quote.estimated_total === null) return;
    setFalGenBusy(true);
    setStatus("Confirming FAL generation…");
    try {
      const job = await api.request<GenerationJobView>(`/api/generation-jobs/${falGenJob.id}/confirm`, {
        method: "POST",
        body: JSON.stringify({ idempotency_key: crypto.randomUUID() })
      });
      setFalGenJob(job);
      localStorage.setItem(falJobStorageKey(project.id, activeScene.id), job.id);
      setStatus("FAL generation queued.");
      void pollFalGeneration(job.id);
    } catch (error) {
      const type = error instanceof ApiResponseError ? error.body.type : undefined;
      setStatus(type === "quote_expired"
        ? "This quote expired. Request a new price."
        : type === "quote_incomplete"
          ? "FAL could not calculate a total for this model."
          : "FAL generation could not be confirmed.");
    } finally {
      setFalGenBusy(false);
    }
  }

  async function pollFalGeneration(jobId: string) {
    const deadline = Date.now() + 12 * 60_000;
    while (Date.now() < deadline) {
      try {
        const job = await api.request<GenerationJobView>(`/api/generation-jobs/${jobId}`);
        setFalGenJob(job);
        if (["ready", "cancelled", "failed", "submission_uncertain"].includes(job.state)) {
          if (job.state === "ready") setStatus("AI still ready — review it before attaching.");
          else if (job.state === "cancelled") setStatus("FAL generation cancelled.");
          else setStatus(falGenFailureMessage(job));
          return;
        }
        setStatus(`FAL generation · ${job.state.replaceAll("_", " ")}`);
      } catch {
        setStatus("Could not refresh FAL generation status.");
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    setStatus("FAL generation is still running. Reopen Generate AI image to check again.");
  }

  async function cancelFalGeneration() {
    if (!falGenJob) return;
    setFalGenBusy(true);
    try {
      const job = await api.request<GenerationJobView>(`/api/generation-jobs/${falGenJob.id}/cancel`, { method: "POST" });
      setFalGenJob(job);
      setStatus(job.state === "cancelled"
        ? "FAL generation cancelled."
        : "Cancel requested. FAL may still bill work that already started.");
    } catch {
      setStatus("FAL generation could not be cancelled.");
    } finally {
      setFalGenBusy(false);
    }
  }

  async function useFalGeneratedMedia() {
    if (!project || !falGenJob?.result_media || falGenJob.result_media.state !== "ready") return;
    const scene = project.scenes.find(({ id }) => id === falGenJob.scene_id);
    if (!scene) return;
    setFalGenBusy(true);
    setBusy(true);
    try {
      const media = falGenJob.result_media;
      const updated = await api.command(project.id, project.revision, "update_scene", {
        scene: {
          ...scene,
          duration_ms: sceneDurationForMedia(media.detected?.duration_ms, scene.duration_ms),
          media_id: media.id
        }
      });
      setProject(updated);
      setSceneMedia((current) => ({ ...current, [media.id]: media }));
      setSceneProgress((current) => ({ ...current, [scene.id]: "ready" }));
      localStorage.removeItem(falJobStorageKey(project.id, scene.id));
      setFalGenOpen(false);
      setStatus(`Scene ${scene.order + 1} uses AI-generated with FAL still.`);
    } catch (error) {
      if (error instanceof ApiResponseError && error.status === 409) {
        openConflict(error.body.authoritative_snapshot as unknown as ProjectSnapshot, {
          sceneId: scene.id,
          operation: "AI media attach"
        });
        return;
      }
      setStatus("Generated still could not be attached.");
    } finally {
      setFalGenBusy(false);
      setBusy(false);
    }
  }


  function falVideoStorageKey(projectId: string, sceneId: string) {
    return `fengine-fal-video:${projectId}:${sceneId}`;
  }

  function openFalAnimate(scene: Scene) {
    if (!falCredential?.connected || falUnavailable) {
      showFalLock();
      return;
    }
    const media = scene.media_id ? sceneMedia[scene.media_id] : undefined;
    const type = media?.detected?.type;
    if (!media || media.state !== "ready" || type === "video/mp4") {
      setStatus("Animate needs a ready still image on this scene.");
      return;
    }
    setFalVideoPrompt("gentle camera drift, subtle motion");
    setFalVideoJob(undefined);
    setFalVideoOpen(true);
    const projectId = project?.id;
    if (!projectId) return;
    const stored = localStorage.getItem(falVideoStorageKey(projectId, scene.id));
    if (!stored) return;
    void (async () => {
      try {
        const job = await api.request<GenerationJobView>(`/api/generation-jobs/${stored}`);
        setFalVideoJob(job);
        setFalVideoPrompt(job.prompt);
        if (!["ready", "cancelled", "failed", "submission_uncertain", "quoted"].includes(job.state)) {
          void pollFalVideo(job.id);
        }
      } catch {
        localStorage.removeItem(falVideoStorageKey(projectId, scene.id));
      }
    })();
  }

  async function quoteFalVideo() {
    if (!project || !activeScene?.media_id) return;
    const prompt = falVideoPrompt.trim();
    if (!prompt || prompt.length > 500) {
      setStatus("Enter a motion prompt between 1 and 500 characters.");
      return;
    }
    setFalVideoBusy(true);
    setStatus("Requesting FAL video price…");
    try {
      const job = await api.request<GenerationJobView>(
        `/api/projects/${project.id}/scenes/${activeScene.id}/fal/video-quotes`,
        {
          method: "POST",
          body: JSON.stringify({ source_media_id: activeScene.media_id, motion_prompt: prompt })
        }
      );
      setFalVideoJob(job);
      localStorage.setItem(falVideoStorageKey(project.id, activeScene.id), job.id);
      setStatus("Review the FAL price, then confirm to generate one 6-second video.");
    } catch (error) {
      const type = error instanceof ApiResponseError ? error.body.type : undefined;
      setStatus(type === "fal_not_connected"
        ? "Connect your FAL API key in Settings first."
        : type === "fal_generation_busy"
          ? "Only one active FAL generation is allowed. Wait or cancel it."
          : "FAL could not price this video. Check that the scene still has a ready portrait image.");
    } finally {
      setFalVideoBusy(false);
    }
  }

  async function confirmFalVideo() {
    if (!project || !activeScene || !falVideoJob || falVideoJob.state !== "quoted") return;
    if (falVideoJob.quote.estimated_total === null) return;
    setFalVideoBusy(true);
    setStatus("Confirming FAL video generation…");
    try {
      const job = await api.request<GenerationJobView>(`/api/generation-jobs/${falVideoJob.id}/confirm`, {
        method: "POST",
        body: JSON.stringify({ idempotency_key: crypto.randomUUID() })
      });
      setFalVideoJob(job);
      localStorage.setItem(falVideoStorageKey(project.id, activeScene.id), job.id);
      setStatus("FAL video generation queued.");
      void pollFalVideo(job.id);
    } catch (error) {
      const type = error instanceof ApiResponseError ? error.body.type : undefined;
      setStatus(type === "quote_expired"
        ? "This quote expired. Request a new price."
        : type === "source_changed"
          ? "The source image changed. Request a new price."
          : "FAL video generation could not be confirmed.");
    } finally {
      setFalVideoBusy(false);
    }
  }

  async function pollFalVideo(jobId: string) {
    const deadline = Date.now() + 25 * 60_000;
    while (Date.now() < deadline) {
      try {
        const job = await api.request<GenerationJobView>(`/api/generation-jobs/${jobId}`);
        setFalVideoJob(job);
        if (["ready", "cancelled", "failed", "submission_uncertain"].includes(job.state)) {
          if (job.state === "ready") setStatus("AI video ready — review it before attaching.");
          else if (job.state === "cancelled") setStatus("FAL video generation cancelled.");
          else setStatus(falGenFailureMessage(job));
          return;
        }
        setStatus(`FAL video · ${job.state.replaceAll("_", " ")}`);
      } catch {
        setStatus("Could not refresh FAL video status.");
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    setStatus("FAL video is still running. Reopen Animate this image to check again.");
  }

  async function cancelFalVideo() {
    if (!falVideoJob) return;
    setFalVideoBusy(true);
    try {
      const job = await api.request<GenerationJobView>(`/api/generation-jobs/${falVideoJob.id}/cancel`, { method: "POST" });
      setFalVideoJob(job);
      setStatus(job.state === "cancelled"
        ? "FAL video generation cancelled."
        : "Cancel requested. FAL may still bill work that already started.");
    } catch {
      setStatus("FAL video generation could not be cancelled.");
    } finally {
      setFalVideoBusy(false);
    }
  }

  async function useFalVideoMedia() {
    if (!project || !falVideoJob?.result_media || falVideoJob.result_media.state !== "ready") return;
    const scene = project.scenes.find(({ id }) => id === falVideoJob.scene_id);
    if (!scene) return;
    setFalVideoBusy(true);
    setBusy(true);
    try {
      const media = falVideoJob.result_media;
      const updated = await api.command(project.id, project.revision, "update_scene", {
        scene: { ...scene, media_id: media.id }
      });
      setProject(updated);
      setSceneMedia((current) => ({ ...current, [media.id]: media }));
      setSceneProgress((current) => ({ ...current, [scene.id]: "ready" }));
      localStorage.removeItem(falVideoStorageKey(project.id, scene.id));
      setFalVideoOpen(false);
      setStatus(`Scene ${scene.order + 1} uses AI-generated FAL video. Preview may loop or trim to the scene duration.`);
    } catch (error) {
      if (error instanceof ApiResponseError && error.status === 409) {
        openConflict(error.body.authoritative_snapshot as unknown as ProjectSnapshot, {
          sceneId: scene.id,
          operation: "AI video attach"
        });
        return;
      }
      setStatus("Generated video could not be attached.");
    } finally {
      setFalVideoBusy(false);
      setBusy(false);
    }
  }

  function showFalLock() {
    setFeatureLock(falCredential?.connected
      ? { title: "Generate AI stills from a scene", message: "Open a scene in the storyboard and choose Generate AI image. Each still is quoted and confirmed before FAL charges your account." }
      : { title: "FAL generation is locked", message: "Connect your FAL API key now. AI still generation unlocks in the storyboard after you connect.", action: "settings" });
  }

  function showFutureLock() {
    setFeatureLock({ title: "More providers are coming", message: "This option is not available yet. No setup is required." });
  }

  const activeScene = project?.scenes.find(({ id }) => id === activeSceneId)
    ?? project?.scenes[0]; // read-only fallback for an old/recovered selection
  const activeSceneNumber = activeScene ? activeScene.order + 1 : 0;
  const activeMediaId = activeScene?.media_id;
  const activeMedia = activeMediaId ? sceneMedia[activeMediaId] : undefined;
  const activePreviewUrl = scenePreviewUrl(activeMedia);
  const wideStill = Boolean(
    activeMedia?.detected?.width
    && activeMedia.detected.height
    && activeMedia.detected.width > activeMedia.detected.height
  );
  useEffect(() => {
    if (!activeScene) return;
    setCropFocus({ x: activeScene.focal_x, y: activeScene.focal_y });
  }, [activeScene?.id, activeScene?.focal_x, activeScene?.focal_y]);
  const allScenesHaveMedia = Boolean(project?.scenes.length && project.scenes.every(({ media_id }) =>
    media_id && sceneMedia[media_id]?.state === "ready"));
  const allScenesHavePreview = Boolean(project?.scenes.length && project.scenes.every((scene) =>
    scenePreviewUrl(scene.media_id ? sceneMedia[scene.media_id] : undefined)));
  const previewScene = livePlaying
    ? (project?.scenes.find(({ id }) => id === playSceneId) ?? activeScene)
    : activeScene;
  const previewMedia = previewScene?.media_id ? sceneMedia[previewScene.media_id] : undefined;
  const previewUrl = scenePreviewUrl(previewMedia);
  const previewPosition = {
    objectPosition: `${(livePlaying ? previewScene?.focal_x ?? cropFocus.x : cropFocus.x) * 100}% ${(livePlaying ? previewScene?.focal_y ?? cropFocus.y : cropFocus.y) * 100}%`,
    transformOrigin: `${(livePlaying ? previewScene?.focal_x ?? cropFocus.x : cropFocus.x) * 100}% ${(livePlaying ? previewScene?.focal_y ?? cropFocus.y : cropFocus.y) * 100}%`,
    ["--scene-ms" as string]: `${Math.max(500, previewScene?.duration_ms ?? 3000)}ms`
  };
  const previewMotion = livePlaying && previewScene && previewScene.motion !== "none" ? previewScene.motion : undefined;
  const sceneElapsedMs = livePlaying
    ? sceneClock.current.elapsedAtPause + Math.max(0, playTick - sceneClock.current.startedAt)
    : sceneClock.current.elapsedAtPause;
  const playhead = livePlayhead(project?.scenes ?? [], playSceneId || previewScene?.id || "", sceneElapsedMs);
  const timeline = liveTimeline(project?.scenes ?? []);

  function readSceneElapsed(now = performance.now()) {
    return livePlaying
      ? sceneClock.current.elapsedAtPause + Math.max(0, now - sceneClock.current.startedAt)
      : sceneClock.current.elapsedAtPause;
  }

  function armSceneClock(elapsedMs: number, playing: boolean, now = performance.now()) {
    sceneClock.current.elapsedAtPause = Math.max(0, elapsedMs);
    sceneClock.current.startedAt = playing ? now : 0;
  }

  function playLivePreview() {
    userPausedPreview.current = false;
    const id = playSceneId || activeSceneId;
    setPlaySceneId(id);
    armSceneClock(sceneClock.current.elapsedAtPause, true);
    setLivePlaying(true);
    setPlayTick(performance.now());
  }

  function pauseLivePreview() {
    userPausedPreview.current = true;
    armSceneClock(readSceneElapsed(), false);
    setLivePlaying(false);
  }

  function seekLivePreview(sceneId: string, elapsedMs = 0, playing = livePlaying) {
    setActiveSceneId(sceneId);
    setPlaySceneId(sceneId);
    armSceneClock(elapsedMs, playing);
    setPlayTick(performance.now());
  }

  function stepLivePreview(direction: -1 | 1) {
    if (!project?.scenes.length) return;
    const ids = project.scenes.map(({ id }) => id);
    const currentId = playSceneId || activeSceneId || ids[0]!;
    if (direction < 0 && readSceneElapsed() > 400) {
      seekLivePreview(currentId, 0);
      return;
    }
    const nextId = direction < 0 ? previousLiveSceneId(ids, currentId) : nextLiveSceneId(ids, currentId);
    seekLivePreview(nextId, 0);
  }

  function restartLivePreview() {
    const first = project?.scenes[0];
    if (!first) return;
    userPausedPreview.current = false;
    seekLivePreview(first.id, 0, true);
    setLivePlaying(true);
  }

  function seekFromProgress(event: { currentTarget: HTMLElement; clientX: number }) {
    if (!project?.scenes.length) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = rect.width <= 0 ? 0 : Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    const seek = seekLivePlayhead(project.scenes, ratio * playhead.totalMs);
    seekLivePreview(seek.sceneId, seek.sceneElapsedMs);
  }
  useEffect(() => {
    userPausedPreview.current = false;
    sceneClock.current = { startedAt: 0, elapsedAtPause: 0 };
    setPlaySceneId(activeSceneId || project?.scenes[0]?.id || "");
    setPlayTick(0);
  }, [project?.id]);
  useEffect(() => {
    if (step !== "editor" || !allScenesHavePreview || userPausedPreview.current) return;
    if (livePlaying) return;
    armSceneClock(0, true);
    setLivePlaying(true);
    setPlayTick(performance.now());
  }, [step, project?.id, allScenesHavePreview]);
  useEffect(() => {
    if (!livePlaying || step !== "editor" || !project?.scenes.length) return;
    const tick = () => {
      const now = performance.now();
      const current = project.scenes.find(({ id }) => id === playSceneId) ?? project.scenes[0];
      if (!current) return;
      const elapsed = sceneClock.current.elapsedAtPause + Math.max(0, now - sceneClock.current.startedAt);
      if (elapsed >= Math.max(500, current.duration_ms)) {
        const nextId = nextLiveSceneId(project.scenes.map(({ id }) => id), current.id);
        sceneClock.current = { startedAt: now, elapsedAtPause: 0 };
        setPlaySceneId(nextId);
      }
      setPlayTick(now);
    };
    const timer = window.setInterval(tick, 100);
    tick();
    return () => window.clearInterval(timer);
  }, [livePlaying, step, project, playSceneId]);
  useEffect(() => {
    if (step !== "editor") return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      if (event.code === "Space") {
        event.preventDefault();
        if (livePlaying) pauseLivePreview();
        else playLivePreview();
      } else if (event.code === "ArrowLeft") {
        event.preventDefault();
        stepLivePreview(-1);
      } else if (event.code === "ArrowRight") {
        event.preventDefault();
        stepLivePreview(1);
      } else if (event.code === "Home") {
        event.preventDefault();
        restartLivePreview();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, livePlaying, playSceneId, activeSceneId, project]);
  const inApp = authReady && Boolean(token) && step !== "sign-in";
  const createFlow = step === "brief" || step === "architecture" || step === "concepts" || step === "media" || step === "editor" || step === "render";
  const projectTitle = project?.brief.purpose?.trim() || "Untitled draft";
  const saveBusy = busy || status === "Saving…";
  const saveLabel = saveBusy ? "Saving…" : (status.startsWith("✓") || !status ? "Saved" : status);

  function goCreate() {
    if (step === "drafts" || step === "settings") startCreate();
  }

  const appNav = inApp ? <>
    <button type="button" aria-current={step === "drafts" ? "page" : undefined} onClick={() => setStep("drafts")}>Drafts</button>
    <button type="button" aria-current={createFlow ? "page" : undefined} onClick={goCreate}>Create</button>
    <button type="button" aria-current={step === "settings" ? "page" : undefined} onClick={() => setStep("settings")}>Settings</button>
  </> : null;

  return <div className={`app-shell${inApp ? " app-shell-signed" : ""}${step === "editor" ? " app-shell-editor" : ""}`}>
    {inApp && <nav className="app-rail" aria-label="Primary">
      <a className="rail-brand" href="/">F-MOTION</a>
      {appNav}
    </nav>}
    <div className="app-stage">
    <header>
      <div className="header-identity">
        <strong>F-Motion</strong>
        {step === "editor" && project && <>
          <span className="header-sep" aria-hidden="true">·</span>
          <span className="project-title">{projectTitle}</span>
          <span className="save-pill" data-busy={saveBusy || undefined}>{saveLabel}</span>
        </>}
      </div>
      <div className="header-actions">
        {authReady && token && step !== "sign-in" && !inApp && <button className="secondary" onClick={() => setStep("settings")}>Settings</button>}
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
      {Boolean(import.meta.env.VITE_SUPABASE_URL) && <p>{awaitingEmail
        ? "Email sent. Open the link to finish sign-in on this studio."
        : "Open the email link to finish sign-in."}</p>}
      {import.meta.env.VITE_ENABLE_GOOGLE_AUTH === "1"
        ? <button className="secondary" disabled={authBusy || !authSetup.gateway} onClick={() => void googleSignIn()}>Continue with Google</button>
        : null}
      <p role="status">{status}</p>
    </section>}
    {authReady && step === "drafts" && <section>
      <div className="drafts-hero">
        <h1>Drafts</h1>
        <p>Pick up where you left off or start a new video.</p>
      </div>
      <aside className="provider-preview" aria-label="Creation sources">
        <button className="provider-preview-item" data-locked={!pexelsCredential?.connected} onClick={() => pexelsCredential?.connected ? setStep("settings") : showPexelsLock()}>
          <strong>Pexels</strong><span>Real stock video · {pexelsCredential?.connected ? "unlocked" : "locked"}</span>
        </button>
        <button className="provider-preview-item" data-locked onClick={showFalLock}>
          <strong>FAL</strong><span>{falCredential?.connected && !falUnavailable ? "AI stills in storyboard" : "AI stills · locked"}</span>
        </button>
        <button className="provider-preview-item" data-locked onClick={showFutureLock}>
          <strong>More</strong><span>New providers · locked</span>
        </button>
        <button className="secondary" onClick={() => setStep("settings")}>Choose video sources</button>
      </aside>
      <button onClick={startCreate}>Create new video</button>
      {draftsLoading && <p role="status">Loading drafts…</p>}
      {!draftsLoading && drafts.length === 0 && <div className="empty-drafts">
        <p role="status">No drafts yet.</p>
        <p>Describe what you want to make — F-Motion will recommend a video plan and storyboard.</p>
        <button onClick={startCreate}>Create new video</button>
      </div>}
      <div className="concepts drafts-grid">{drafts.map((item) =>
        <button key={item.id} className="card draft-card" onClick={() => void openDraft(item.id)}>
          <strong>{item.brief.purpose || "Untitled draft"}</strong>
          <span className="draft-meta">Revision {item.revision}</span>
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
      <button disabled={busy} onClick={() => void continueToConcepts()}>{busy ? "Preparing concepts…" : "Continue to story concepts"}</button>
      <button className="secondary" disabled={busy} onClick={() => setStep("brief")}>Back to description</button>
      <p role="status" aria-live="polite">{status}</p>
    </section>}
    {authReady && step === "concepts" && project && <section>
      <h1>Choose a story approach</h1>
      <p>Each option builds a different multi-scene plan. Licensed stock is matched only after you choose.</p>
      <div className="concept-choices" aria-label="Story concepts">{conceptChoices.map((concept) =>
        <button
          key={concept.id}
          className="card"
          disabled={busy}
          aria-label={`Choose ${concept.title} concept`}
          onClick={() => void chooseConcept(concept.id)}
        >
          <strong>{concept.title}</strong>
          <span>{concept.hook}</span>
          <span>{concept.beat_summary}</span>
          <span>About {concept.duration_seconds} seconds · {concept.scene_count} scenes</span>
          <span>{concept.media_direction}</span>
        </button>)}</div>
      <p role="status" aria-live="polite">{status}</p>
      <button className="secondary" disabled={busy} onClick={() => setStep("architecture")}>Back to video plan</button>
    </section>}
    {authReady && step === "media" && project && <section>
      <h1>Upload your media</h1>
      <p>Choose one JPEG, PNG, or MP4 you have permission to use. It is inspected before it can be rendered.</p>
      <input ref={upload} hidden type="file" accept="video/mp4,image/jpeg,image/png,image/webp" onChange={(event) => {
        const file = event.target.files?.[0];
        if (file && activeScene) void admitFile(file, activeScene.id);
      }} />
      <button disabled={busy} onClick={() => upload.current?.click()}>Choose a file</button>
      <p role="status" aria-live="polite">{status}</p>
      <button className="secondary" disabled={busy} onClick={() => setStep("editor")}>Back to storyboard</button>
    </section>}
    {authReady && step === "editor" && project && activeScene && <section className="editor">
      <div className="editor-toolbar">
        <div>
          <h1>Storyboard</h1>
          <p>{playhead.totalMs
            ? `Live cut · ${formatPlayTime(playhead.offsetMs)} / ${formatPlayTime(playhead.totalMs)}`
            : "Review each beat and replace a still only when another visual fits better."}</p>
        </div>
        <div className="editor-toolbar-actions">
          <button className="secondary" disabled={!allScenesHaveMedia} onClick={() => void requestRender("final")}>Export final</button>
        </div>
      </div>

      <div className="studio-board">
      <nav className="scene-strip" aria-label="Storyboard scenes">{project.scenes.map((scene) => {
        const media = scene.media_id ? sceneMedia[scene.media_id] : undefined;
        const previewUrl = scenePreviewUrl(media);
        return <button
          key={scene.id}
          className={`scene-card${scene.id === playSceneId ? " is-playing" : ""}`}
          aria-pressed={scene.id === activeScene.id}
          aria-current={scene.id === playSceneId ? "true" : undefined}
          aria-label={`Edit scene ${scene.order + 1}`}
          onClick={() => {
            searchAbort.current?.abort();
            searchTransition.current += 1;
            setCandidates([]);
            seekLivePreview(scene.id, 0);
          }}
        >
          {previewUrl
            ? (media?.detected?.type === "video/mp4"
              ? <video src={previewUrl} muted playsInline preload="metadata" style={{ objectPosition: `${scene.focal_x * 100}% ${scene.focal_y * 100}%` }} />
              : <img src={previewUrl} alt="" style={{ objectPosition: `${scene.focal_x * 100}% ${scene.focal_y * 100}%` }} />)
            : (
              <span className="scene-empty">
                {sceneProgress[scene.id] === "finding" ? "Finding…"
                  : sceneProgress[scene.id] === "inspecting" ? "Inspecting…"
                    : sceneProgress[scene.id] === "needs_media" ? "Needs media"
                      : media ? "Media processing" : "No media"}
              </span>
            )}
          <strong>Scene {scene.order + 1} · {(scene.duration_ms / 1000).toFixed(1)}s</strong>
          <span>{scene.caption || scene.visual_prompt}</span>
          {sceneProgress[scene.id] && !previewUrl ? (
            <span className="scene-progress">
              {sceneProgress[scene.id] === "finding" ? "finding"
                : sceneProgress[scene.id] === "inspecting" ? "inspecting"
                  : sceneProgress[scene.id] === "ready" ? "ready"
                    : "needs media"}
            </span>
          ) : null}
        </button>;
      })}</nav>

      <div className="editor-grid" key={`${activeScene.id}:${project.revision}`}>
        <div className="preview-panel">
          <div
            className={`preview${livePlaying ? " is-live" : ""}`}
            aria-label={livePlaying
              ? `Live preview · scene ${(previewScene?.order ?? 0) + 1}`
              : `Live preview for scene ${activeSceneNumber}`}
          >
        {previewUrl && (previewMedia?.detected?.type === "video/mp4"
          ? <video key={previewScene?.id} src={previewUrl} muted playsInline autoPlay={livePlaying} loop={!livePlaying} controls={!livePlaying} preload="metadata" className={previewMotion ? `motion-${previewMotion}` : undefined} style={previewPosition} />
          : <img key={previewScene?.id} src={previewUrl} alt={previewMedia?.attribution ? `Selected stock video by ${previewMedia.attribution.creator}` : "Selected gallery media"} className={previewMotion ? `motion-${previewMotion}` : undefined} style={previewPosition} />)}
        {previewMedia && !previewUrl && <span className="media-placeholder">{previewMedia.state === "ready" ? "Preview unavailable" : "Media processing…"}</span>}
            {!previewMedia && <span className="media-placeholder">Choose stock or upload media</span>}
            {previewScene?.caption ? <span className="caption-burn">{previewScene.caption}</span> : null}
            {!livePlaying && <span
              className="crop-guide"
              style={{ left: `${cropFocus.x * 100}%`, top: `${cropFocus.y * 100}%` }}
              aria-hidden="true"
            />}
          </div>
          <div className="play-transport">
            <div className="play-transport-row">
              <button className="secondary" type="button" disabled={!project.scenes.length} onClick={() => restartLivePreview()}>Restart</button>
              <button className="secondary" type="button" disabled={!project.scenes.length} onClick={() => stepLivePreview(-1)}>Previous scene</button>
              <button type="button" disabled={!allScenesHavePreview} onClick={() => livePlaying ? pauseLivePreview() : playLivePreview()}>{livePlaying ? "Pause preview" : "Play preview"}</button>
              <button className="secondary" type="button" disabled={!project.scenes.length} onClick={() => stepLivePreview(1)}>Next scene</button>
              <span className="play-time">{formatPlayTime(playhead.offsetMs)} / {formatPlayTime(playhead.totalMs)}</span>
            </div>
            <div
              className="play-progress"
              role="slider"
              tabIndex={0}
              aria-label="Play progress"
              aria-valuemin={0}
              aria-valuemax={Math.round(playhead.totalMs / 1000)}
              aria-valuenow={Math.round(playhead.offsetMs / 1000)}
              aria-valuetext={`${formatPlayTime(playhead.offsetMs)} of ${formatPlayTime(playhead.totalMs)}`}
              onClick={(event) => seekFromProgress(event)}
              onKeyDown={(event) => {
                if (event.code === "ArrowLeft") { event.preventDefault(); stepLivePreview(-1); }
                if (event.code === "ArrowRight") { event.preventDefault(); stepLivePreview(1); }
                if (event.code === "Home") { event.preventDefault(); restartLivePreview(); }
              }}
            >
              {project.scenes.map((scene, index) => {
                const duration = timeline.durations[index] ?? 0;
                const current = scene.id === (playSceneId || previewScene?.id);
                const done = timeline.offsets[index]! + duration <= playhead.offsetMs + 1;
                const fill = current ? (duration ? (playhead.sceneElapsedMs / duration) * 100 : 0) : done ? 100 : 0;
                return <span
                  key={scene.id}
                  className={`play-progress-scene${current ? " is-current" : ""}${done && !current ? " is-done" : ""}`}
                  style={{ flexGrow: duration, ["--fill" as string]: `${fill}%` }}
                >
                  <span className="play-progress-fill" />
                </span>;
              })}
            </div>
          </div>
          <p className="crop-hint">{livePlaying
            ? "Space plays or pauses · click the bar to scrub."
            : wideStill
            ? "Wide still — drag horizontal focus to keep the subject in the 9:16 frame."
            : "Crop focus · drag the focus sliders in the inspector"}</p>
          {activeMedia?.attribution && <p>
            Video by <a href={activeMedia.attribution.attributionUrl} target="_blank" rel="noreferrer">{activeMedia.attribution.creator}</a>
            {" · "}<a href="https://www.pexels.com" target="_blank" rel="noreferrer">Pexels</a>
          </p>}
          {activeMedia?.generation?.source === "FAL" && <p>AI-generated with FAL{activeMedia.generation.derivedFromImage ? " · from your still" : ""} · {activeMedia.generation.model}</p>}
        </div>

        <div className="scene-controls">
          <h2>Scene {activeSceneNumber}</h2>
          <div className="inspector-block">
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
          </div>
          <div className="inspector-block">
          <label htmlFor={`motion-${activeScene.id}`}>Scene {activeSceneNumber} motion
            <select id={`motion-${activeScene.id}`} value={activeScene.motion} onChange={(event) => void saveScenePatch(activeScene.id, { motion: event.target.value as Scene["motion"] })}>
              <option value="none">None</option><option value="push">Push</option><option value="zoom">Zoom</option>
            </select>
          </label>
          <label htmlFor={`focal-x-${activeScene.id}`}>Scene {activeSceneNumber} horizontal focus · {cropFocus.x.toFixed(2)}
            <input id={`focal-x-${activeScene.id}`} type="range" min="0" max="1" step="0.05" value={cropFocus.x} onChange={(event) => { pauseLivePreview(); setCropFocus((current) => ({ ...current, x: event.currentTarget.valueAsNumber })); }} onBlur={(event) => void saveScenePatch(activeScene.id, { focal_x: event.currentTarget.valueAsNumber })} />
          </label>
          <label htmlFor={`focal-y-${activeScene.id}`}>Scene {activeSceneNumber} vertical focus · {cropFocus.y.toFixed(2)}
            <input id={`focal-y-${activeScene.id}`} type="range" min="0" max="1" step="0.05" value={cropFocus.y} onChange={(event) => { pauseLivePreview(); setCropFocus((current) => ({ ...current, y: event.currentTarget.valueAsNumber })); }} onBlur={(event) => void saveScenePatch(activeScene.id, { focal_y: event.currentTarget.valueAsNumber })} />
          </label>
          <label htmlFor={`audio-${activeScene.id}`}>Scene {activeSceneNumber} source audio · {Math.round(activeScene.audio_level * 100)}%
            <input id={`audio-${activeScene.id}`} type="range" min="0" max="1" step="0.05" defaultValue={activeScene.audio_level} onBlur={(event) => void saveScenePatch(activeScene.id, { audio_level: event.currentTarget.valueAsNumber })} />
          </label>
          <button className="secondary" onClick={() => void saveScenePatch(activeScene.id, { audio_level: activeScene.audio_level === 0 ? 1 : 0 })}>{activeScene.audio_level === 0 ? `Unmute scene ${activeSceneNumber}` : `Mute scene ${activeSceneNumber}`}</button>
          </div>
          <div className="inspector-block">
          <button className={!pexelsCredential?.connected ? "locked-feature" : undefined}
            disabled={busy || (Boolean(pexelsCredential?.connected) && !activeScene.visual_prompt)}
            onClick={() => pexelsCredential?.connected ? void searchStock(activeScene.id) : showPexelsLock()}>
            {!pexelsCredential?.connected ? "🔒 " : ""}{activeMedia
              ? `Find another licensed video for scene ${activeSceneNumber}`
              : `Find licensed media for scene ${activeSceneNumber}`}
          </button>
          <button className={!falCredential?.connected || falUnavailable ? "locked-feature" : undefined}
            disabled={busy || falGenBusy}
            onClick={() => openFalGenerate(activeScene)}>
            {!falCredential?.connected || falUnavailable ? "🔒 " : ""}Generate AI image for scene {activeSceneNumber}
          </button>
          {activeMedia?.state === "ready" && activeMedia.detected?.type !== "video/mp4" && (
            <button className={!falCredential?.connected || falUnavailable ? "locked-feature" : undefined}
              disabled={busy || falVideoBusy}
              onClick={() => openFalAnimate(activeScene)}>
              {!falCredential?.connected || falUnavailable ? "🔒 " : ""}Animate this image for scene {activeSceneNumber}
            </button>
          )}
          </div>
        </div>
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

      <input ref={upload} hidden type="file" accept="video/mp4,image/jpeg,image/png,image/webp" onChange={(event) => {
        const file = event.target.files?.[0];
        if (file) void admitFile(file, activeScene.id);
      }} />
      <button className="secondary" disabled={busy} onClick={() => upload.current?.click()}>Upload media for scene {activeSceneNumber}</button>
      <p role="status">{status || "✓ All changes saved"}</p>
      {!allScenesHavePreview && <p>{project.scenes.every(({ media_id }) => media_id)
        ? "Media is processing. Live preview starts when every scene is ready."
        : "Add media to every scene to play the live preview."}</p>}
      {downloadUrl && <button className="secondary" onClick={() => setStep("render")}>{renderKind === "final" ? "View final export" : "View accurate preview"}{previewRevision !== project.revision ? " · older" : ""}</button>}
      <button className="secondary" onClick={() => setStep("brief")}>Start a different description</button>
      <button className="secondary" onClick={() => setStep("drafts")}>Back to drafts</button>
      {falGenOpen && activeScene && <dialog open aria-labelledby="fal-gen-title">
        <h2 id="fal-gen-title">Generate AI image for scene {activeSceneNumber}</h2>
        <p>Optional fallback after your own media or licensed Pexels search. One still uses Flux Schnell on FAL. Charged directly to your FAL account. F-Motion copies the result into private storage within an hour and does not keep FAL CDN copies longer than that preference.</p>
        <label htmlFor="fal-gen-prompt">Image prompt
          <textarea id="fal-gen-prompt" maxLength={500} value={falGenPrompt} disabled={falGenBusy || (falGenJob && !["quoted", "failed", "cancelled", "submission_uncertain", "ready"].includes(falGenJob.state))} onChange={(event) => setFalGenPrompt(event.target.value)} />
        </label>
        {falGenJob && <div className="notice">
          <p>Model · Flux Schnell (fast still)</p>
          <p>{falGenJob.quote.currency} {falGenJob.quote.unit_price} per {falGenJob.quote.unit}
            {falGenJob.quote.estimated_total !== null
              ? ` · estimated total ${falGenJob.quote.currency} ${falGenJob.quote.estimated_total}`
              : ` · ${falGenJob.quote.estimated_total_explanation ?? "FAL could not calculate a total"}`}</p>
          <p>Status · {falGenJob.state.replaceAll("_", " ")}</p>
        </div>}
        {falGenJob?.state === "ready" && falGenJob.result_media && (
          <div>
            {(falGenJob.result_media.previewUrl || falGenJob.result_media.attribution?.previewUrl)
              ? <img src={falGenJob.result_media.previewUrl ?? falGenJob.result_media.attribution?.previewUrl} alt="Generated AI still preview" />
              : <p>Generated still is ready for review.</p>}
            <p>AI-generated with FAL</p>
          </div>
        )}
        <div className="dialog-actions">
          {(!falGenJob || ["failed", "cancelled", "submission_uncertain", "ready"].includes(falGenJob.state)) && (
            <button disabled={falGenBusy || !falGenPrompt.trim()} onClick={() => void quoteFalImage()}>Get FAL price</button>
          )}
          {falGenJob?.state === "quoted" && (
            <button disabled={falGenBusy || falGenJob.quote.estimated_total === null} onClick={() => void confirmFalImage()}>Generate one image</button>
          )}
          {falGenJob && !["ready", "cancelled", "failed", "submission_uncertain", "quoted"].includes(falGenJob.state) && (
            <button className="secondary" disabled={falGenBusy} onClick={() => void cancelFalGeneration()}>Cancel generation</button>
          )}
          {falGenJob?.state === "ready" && falGenJob.result_media?.state === "ready" && (
            <>
              <button disabled={falGenBusy || busy} onClick={() => void useFalGeneratedMedia()}>Use for scene {activeSceneNumber}</button>
              <button className="secondary" disabled={falGenBusy} onClick={() => {
                setFalGenJob(undefined);
                setStatus("Current scene media kept.");
              }}>Keep current media</button>
              <button className="secondary" disabled={falGenBusy} onClick={() => {
                setFalGenJob(undefined);
                setStatus("Request a new FAL price to generate another still.");
              }}>Generate another</button>
            </>
          )}
          <button className="secondary" disabled={falGenBusy} onClick={() => setFalGenOpen(false)}>Close</button>
        </div>
      </dialog>}
      {falVideoOpen && activeScene && <dialog open aria-labelledby="fal-video-title">
        <h2 id="fal-video-title">Animate image for scene {activeSceneNumber}</h2>
        <p>Creates one 6-second Hailuo video from the selected still. Charged directly to your FAL account. The accurate preview may loop or trim this clip to the scene duration.</p>
        {activePreviewUrl && <img src={activePreviewUrl} alt="Source still for animation" />}
        <label htmlFor="fal-video-prompt">Motion prompt
          <textarea id="fal-video-prompt" maxLength={500} value={falVideoPrompt} disabled={falVideoBusy || (falVideoJob && !["quoted", "failed", "cancelled", "submission_uncertain", "ready"].includes(falVideoJob.state))} onChange={(event) => setFalVideoPrompt(event.target.value)} />
        </label>
        {falVideoJob && <div className="notice">
          <p>Model · MiniMax Hailuo 2.3 Fast · 6 seconds</p>
          <p>{falVideoJob.quote.currency} {falVideoJob.quote.unit_price} per {falVideoJob.quote.unit}
            {falVideoJob.quote.estimated_total !== null
              ? ` · estimated total ${falVideoJob.quote.currency} ${falVideoJob.quote.estimated_total}`
              : ` · ${falVideoJob.quote.estimated_total_explanation ?? "FAL could not calculate a total"}`}</p>
          <p>Status · {falVideoJob.state.replaceAll("_", " ")}</p>
        </div>}
        {falVideoJob?.state === "ready" && falVideoJob.result_media && (
          <div>
            {(falVideoJob.result_media.previewUrl)
              ? <video src={falVideoJob.result_media.previewUrl} controls playsInline muted preload="metadata" />
              : <p>Generated video is ready for review.</p>}
            <p>AI-generated with FAL{falVideoJob.result_media.generation?.derivedFromImage ? " · from your still" : ""}</p>
          </div>
        )}
        <div className="dialog-actions">
          {(!falVideoJob || ["failed", "cancelled", "submission_uncertain", "ready"].includes(falVideoJob.state)) && (
            <button disabled={falVideoBusy || !falVideoPrompt.trim()} onClick={() => void quoteFalVideo()}>Get FAL price</button>
          )}
          {falVideoJob?.state === "quoted" && (
            <button disabled={falVideoBusy || falVideoJob.quote.estimated_total === null} onClick={() => void confirmFalVideo()}>Generate one 6-second video</button>
          )}
          {falVideoJob && !["ready", "cancelled", "failed", "submission_uncertain", "quoted"].includes(falVideoJob.state) && (
            <button className="secondary" disabled={falVideoBusy} onClick={() => void cancelFalVideo()}>Cancel generation</button>
          )}
          {falVideoJob?.state === "ready" && falVideoJob.result_media?.state === "ready" && (
            <>
              <button disabled={falVideoBusy || busy} onClick={() => void useFalVideoMedia()}>Use video for scene {activeSceneNumber}</button>
              <button className="secondary" disabled={falVideoBusy} onClick={() => {
                setFalVideoJob(undefined);
                setStatus("Current image kept.");
              }}>Keep image</button>
              <button className="secondary" disabled={falVideoBusy} onClick={() => {
                setFalVideoJob(undefined);
                setStatus("Request a new FAL price to generate another video.");
              }}>Generate another</button>
            </>
          )}
          <button className="secondary" disabled={falVideoBusy} onClick={() => setFalVideoOpen(false)}>Close</button>
        </div>
      </dialog>}
      {conflict && <dialog open><h2>Newer changes exist</h2>
        <p>{(() => {
          const scene = conflictNotice?.sceneId
            ? (project?.scenes.find(({ id }) => id === conflictNotice.sceneId)
              ?? conflict.scenes.find(({ id }) => id === conflictNotice.sceneId))
            : undefined;
          const where = scene ? ` on scene ${scene.order + 1}` : "";
          const what = conflictNotice?.operation ?? "edits";
          return `Your pending ${what}${where} was not merged. Reload the latest storyboard, or save your local scene edits as a new project.`;
        })()}</p>
        <button onClick={() => {
          setProject(conflict);
          setActiveSceneId(conflict.scenes.some(({ id }) => id === activeScene.id) ? activeScene.id : (conflict.scenes[0]?.id ?? ""));
          dismissConflict();
        }}>Reload latest</button>
        <button onClick={() => void saveAsNewProject()}>Save as new project</button>
      </dialog>}
    </section>}
    {authReady && step === "render" && <section className="export-surface">
      <h1>{renderHeading}</h1>
      {progress.phase === "queued" || progress.phase === "running" || progress.phase === "uploading" || progress.phase === "encoding" ? (
        <p>Export setup · your storyboard is rendering. Keep this tab open until it finishes.</p>
      ) : null}
      <p role="status">{progress.phase === "failed" ? renderFailedLabel : `${progress.phase} · ${renderLabel}`}</p>
      <progress value={progress.percent} max="100">{progress.percent}%</progress>
      {downloadUrl && progress.phase === "complete" && <div className="export-complete">
        <strong>{renderKind === "final" ? "Export complete" : "Preview ready"}</strong>
        <p>Download the MP4 or keep editing the storyboard.</p>
      </div>}
      {downloadUrl && <video controls playsInline preload="metadata" src={downloadUrl} onError={() => void refreshPreviewUrl()}>
        Your browser cannot play this MP4. Use the download link instead.
      </video>}
      {downloadUrl && <p>{previewMetadata.width && previewMetadata.height ? `${previewMetadata.width}×${previewMetadata.height}` : "Rendered MP4"}
        {previewMetadata.duration_ms ? ` · ${(Number(previewMetadata.duration_ms) / 1000).toFixed(1)} seconds` : ""}
        {previewMetadata.audio_status ? ` · audio ${previewMetadata.audio_status}` : ""}</p>}
      {previewRevision !== undefined && project && previewRevision !== project.revision && <p className="notice">{olderRenderNotice}</p>}
      <div className="export-actions">
        <button disabled={progress.phase === "complete" || progress.phase === "cancelled" || progress.phase === "failed"} onClick={() => void cancelRender()}>Cancel render</button>
        {(progress.phase === "failed" || progress.phase === "cancelled") && <button onClick={() => void retryRender()}>Retry</button>}
        <a href={downloadUrl} download><button disabled={!downloadUrl || progress.phase === "failed"}>{downloadLabel}</button></a>
      </div>
      <button className="secondary" onClick={() => setStep("editor")}>Keep editing</button>
    </section>}
    {authReady && step === "settings" && <section>
      <h1>Choose your video sources</h1>
      <p>Connect only the services you want to use. Each provider stays under your account and uses your own API key.</p>
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
        <article className={`provider-card ${falCredential?.connected && !falUnavailable ? "provider-live" : "provider-locked"}`}>
          <span className={`provider-status ${falCredential?.connected && !falUnavailable ? "" : "provider-soon"}`}>{falCredential?.connected && !falUnavailable ? "Unlocked" : "Locked"}</span>
          <h2>FAL</h2>
          <strong>AI stills</strong>
          <p>Connect your key for AI still generation. Open a storyboard scene and choose Generate AI image to quote, confirm, and review one still.</p>
          {falCredential?.connected && !falUnavailable
            ? <a href="#fal-settings-title">Manage FAL</a>
            : <button className="lock-trigger" onClick={showFalLock}>Why is this locked?</button>}
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
        <p>Connect your own FAL API-scope key for AI still generation in the storyboard. Each image is charged directly to your FAL account after you see the estimated cost and confirm it. F-Motion does not supply or share a FAL key.</p>
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
    </div>
    {inApp && <nav className="app-dock" aria-label="Primary">{appNav}</nav>}
  </div>;
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
