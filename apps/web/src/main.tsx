import { StrictMode, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ApiClient,
  ApiResponseError,
  applyConversationConceptOverlays,
  beatsForConcept,
  buildStoryboardDraft,
  conceptsFor,
  clampFocus,
  clampBpm,
  isWideMedia,
  defaultVideoArchitecture,
  focusFromPoint,
  formatPlayTime,
  livePlayhead,
  liveTimeline,
  loadSceneMediaViews,
  mergeConversationStoryboard,
  musicLaneBeats,
  nextLiveSceneId,
  panFocus,
  previousLiveSceneId,
  recommendVideoArchitecture,
  sceneDurationForMedia,
  scenePreviewUrl,
  seekLivePlayhead,
  snapDurationToBeat,
  snapshotFromConflict,
  stockBedUrl,
  stockBeds,
  stockBedForPace,
  stockFillStatus,
  storyboardArchitectureForConcept,
  captionsFromVoiceScript,
  clientId,
  durationSecondsFromClipCount,
  exportGaps,
  showsPartnerBrands,
  cueAtElapsed,
  cuesForScene,
  VOICEOVER_DUCK,
  type Concept,
  type ConversationConceptOverlays,
  type ProjectSnapshot,
  type ProjectSummary,
  type Scene,
  type SceneMediaView,
  type Soundtrack,
  type StoryboardSource,
  type VideoArchitecture,
  type Voiceover
} from "./api";
import { AuthConfigurationError, authCallbackError, createAuthGateway, studioOrigin } from "./auth";
import { clearImportedProject, isImportedProjectId, rememberImportedProject } from "./imported-project";
import { MarketingApp } from "./marketing/MarketingApp";
import "./style.css";

type Step = "sign-in" | "drafts" | "brief" | "architecture" | "concepts" | "media" | "assemble" | "review" | "editor" | "render" | "settings";
interface PreviewPanState {
  pointerId: number;
  startX: number;
  startY: number;
  startFocus: { x: number; y: number };
  moved: boolean;
  sceneId: string;
  wasPlaying: boolean;
}
interface StockMatch {
  id: number;
  creator: string;
  attributionUrl: string;
  previewUrl: string;
  source: "pexels" | "pixabay";
  kind: "video" | "still";
}
interface MixkitMatch {
  id: number;
  title: string;
  artist: string;
  duration: string;
  tags: string[];
  page: string;
  previewUrl: string;
}
const overlayLooks = [
  ["Caption", "caption", "bottom"],
  ["Title", "title", "center"],
  ["Lower third", "poster", "bottom"]
] as const;
const musicMoods = [
  ["Trendy", "trendy"],
  ["Hip hop", "hip hop"],
  ["Lo-fi", "lo-fi"],
  ["Pop", "pop"],
  ["EDM", "edm"],
  ["Cinematic", "cinematic"],
  ["Chill", "chill"]
] as const;
function encodeWav(buffer: AudioBuffer): Blob {
  const length = buffer.length;
  const channels = buffer.numberOfChannels;
  const bytes = new DataView(new ArrayBuffer(44 + length * 2));
  const write = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) bytes.setUint8(offset + i, text.charCodeAt(i));
  };
  write(0, "RIFF");
  bytes.setUint32(4, 36 + length * 2, true);
  write(8, "WAVE");
  write(12, "fmt ");
  bytes.setUint32(16, 16, true);
  bytes.setUint16(20, 1, true);
  bytes.setUint16(22, 1, true);
  bytes.setUint32(24, buffer.sampleRate, true);
  bytes.setUint32(28, buffer.sampleRate * 2, true);
  bytes.setUint16(32, 2, true);
  bytes.setUint16(34, 16, true);
  write(36, "data");
  bytes.setUint32(40, length * 2, true);
  for (let i = 0; i < length; i++) {
    let sample = 0;
    for (let channel = 0; channel < channels; channel++) sample += buffer.getChannelData(channel)[i] ?? 0;
    sample = Math.max(-1, Math.min(1, channels ? sample / channels : 0));
    bytes.setInt16(44 + i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return new Blob([bytes], { type: "audio/wav" });
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
  kind: "image" | "image_to_video" | "speech";
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
interface PixabayCredentialView {
  provider: "pixabay";
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

function beatSteps(summary: string, sceneCount = 6): string[] {
  return beatsForConcept(summary, sceneCount);
}

const sourceChoices = [
  ["stock", "Licensed stock", "Pexels real stock video"],
  ["own", "My own media", "Build the video from clips you attach"],
  ["mixed", "Mix", "Pexels stock + my media"]
] as const;

function conceptDirection(direction: string, media: VideoArchitecture["media"]): string {
  if (media === "own") return "Attach your own clips to each scene.";
  if (media === "mixed") return "Attach your clips, then fill gaps with licensed stock.";
  return direction;
}

function App() {
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
      return {
        error: error instanceof Error ? error : new AuthConfigurationError()
      };
    }
  }, []);
  const tokenRef = useRef("");
  const justOnboarded = useRef(false);
  const [token, setToken] = useState("");
  const [authReady, setAuthReady] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [step, setStep] = useState<Step>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [selfhostGate, setSelfhostGate] = useState<"checking" | "setup" | "login">("checking");
  const [onboardSources, setOnboardSources] = useState(false);
  const [awaitingEmail, setAwaitingEmail] = useState(false);
  const [draft, setDraft] = useState(() => localStorage.getItem("fengine-draft") ?? "");
  const [architecture, setArchitecture] = useState<VideoArchitecture>(defaultVideoArchitecture);
  const [conversationSource, setConversationSource] = useState<StoryboardSource>();
  const [conversationOverlays, setConversationOverlays] = useState<ConversationConceptOverlays>();
  const [conversationPlanKind, setConversationPlanKind] = useState<"fal" | "rules">("rules");
  const [conceptChoices, setConceptChoices] = useState<Concept[]>([]);
  const [project, setProject] = useState<ProjectSnapshot>();
  const [activeSceneId, setActiveSceneId] = useState("");
  const [cropFocus, setCropFocus] = useState({ x: 0.5, y: 0.5 });
  const [livePlaying, setLivePlaying] = useState(false);
  const [playSceneId, setPlaySceneId] = useState("");
  const [playTick, setPlayTick] = useState(0);
  const [bedSeek, setBedSeek] = useState(0);
  const [previewPanning, setPreviewPanning] = useState(false);
  const [previewSize, setPreviewSize] = useState<{ url: string; width: number; height: number }>();
  const previewPan = useRef<PreviewPanState | null>(null);
  const userPausedPreview = useRef(false);
  const sceneClock = useRef({ startedAt: 0, elapsedAtPause: 0 });
  const [drafts, setDrafts] = useState<ProjectSummary[]>([]);
  const [draftsLoading, setDraftsLoading] = useState(false);
  const [sceneMedia, setSceneMedia] = useState<Record<string, SceneMediaView>>({});
  const [sceneProgress, setSceneProgress] = useState<Record<string, "finding" | "inspecting" | "ready" | "needs_media">>({});
  const [assembleLog, setAssembleLog] = useState<string[]>([]);
  const [assembleDone, setAssembleDone] = useState(0);
  const [assembleTotal, setAssembleTotal] = useState(4);
  const assembleLogEl = useRef<HTMLOListElement>(null);
  const mediaTransition = useRef(0);
  const searchTransition = useRef(0);
  const searchAbort = useRef<AbortController | null>(null);
  const [candidates, setCandidates] = useState<StockMatch[]>([]);
  const [musicHits, setMusicHits] = useState<MixkitMatch[]>([]);
  const [musicQuery, setMusicQuery] = useState("trendy");
  const [musicOpen, setMusicOpen] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [voiceScript, setVoiceScript] = useState("");
  const [previewingId, setPreviewingId] = useState<number>();
  const [overlayCaption, setOverlayCaption] = useState("");
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
  const falVideoPollRef = useRef<string | undefined>(undefined);
  const falGenPollRef = useRef<string | undefined>(undefined);
  const [falSpeechOpen, setFalSpeechOpen] = useState(false);
  const [falSpeechPrompt, setFalSpeechPrompt] = useState("");
  const [falSpeechJob, setFalSpeechJob] = useState<GenerationJobView>();
  const [falSpeechBusy, setFalSpeechBusy] = useState(false);
  const [pexelsCredential, setPexelsCredential] = useState<PexelsCredentialView>();
  const [pexelsUnavailable, setPexelsUnavailable] = useState(false);
  const [pexelsKey, setPexelsKey] = useState("");
  const [pexelsBusy, setPexelsBusy] = useState(false);
  const [pixabayCredential, setPixabayCredential] = useState<PixabayCredentialView>();
  const [pixabayUnavailable, setPixabayUnavailable] = useState(false);
  const [pixabayKey, setPixabayKey] = useState("");
  const [pixabayBusy, setPixabayBusy] = useState(false);
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
  const gather = useRef<HTMLInputElement>(null);
  const exportVideo = useRef<HTMLVideoElement>(null);
  const pendingClips = useRef<File[]>([]);
  const audioUpload = useRef<HTMLInputElement>(null);
  const voiceUpload = useRef<HTMLInputElement>(null);
  const bedAudio = useRef<HTMLAudioElement | null>(null);
  const voiceAudio = useRef<HTMLAudioElement | null>(null);
  const previewAudio = useRef<HTMLAudioElement | null>(null);
  const recordStream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const recordChunks = useRef<Blob[]>([]);
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
    setPixabayCredential(undefined);
    setPixabayUnavailable(false);
    setPixabayKey("");
    setPixabayBusy(false);
    setFeatureLock(undefined);
    setAwaitingEmail(false);
    setMusicHits([]);
    setMusicQuery("trendy");
    setMusicOpen(false);
    setPreviewingId(undefined);
    setOverlayCaption("");
    setPassword("");
    setConfirmPassword("");
    setDisplayName("");
    setSelfhostGate("checking");
    setOnboardSources(false);
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
      if (justOnboarded.current) {
        justOnboarded.current = false;
        setOnboardSources(true);
        setStep("settings");
        return;
      }
      setStep((current) => current === "sign-in" ? "drafts" : current);
    });
  }, [authSetup.error, authSetup.gateway]);

  useEffect(() => {
    if (import.meta.env.VITE_SELFHOST_AUTH !== "1") return;
    if (!authReady || token || !authSetup.gateway?.setupNeeded) return;
    let cancelled = false;
    void authSetup.gateway.setupNeeded().then((needed) => {
      if (!cancelled) setSelfhostGate(needed ? "setup" : "login");
    }).catch(() => {
      if (!cancelled) {
        setSelfhostGate("login");
        setStatus("Could not check this install.");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [authReady, token, authSetup.gateway]);

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
    void loadPixabayCredential();
  }, [token]);

  useEffect(() => {
    if (step !== "settings") {
      setFalKey("");
      setPexelsKey("");
      setPixabayKey("");
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
    if (step !== "assemble") return;
    assembleLogEl.current?.scrollTo({ top: assembleLogEl.current.scrollHeight });
  }, [assembleLog, step]);

  useEffect(() => {
    if ((step !== "editor" && step !== "review") || !project || !Object.values(sceneMedia).some(({ state }) =>
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

  async function setupOwner() {
    if (!authSetup.gateway?.setupAccount) return;
    if (password !== confirmPassword) {
      setStatus("Passwords do not match.");
      return;
    }
    setAuthBusy(true);
    try {
      justOnboarded.current = true;
      await authSetup.gateway.setupAccount(email, password, displayName);
      setStatus("");
    } catch (error) {
      justOnboarded.current = false;
      setStatus(error instanceof Error ? error.message : "Could not create the owner account.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function passwordSignIn() {
    if (!authSetup.gateway?.signInWithPassword) return;
    setAuthBusy(true);
    try {
      await authSetup.gateway.signInWithPassword(email, password);
      setStatus("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Email or password was rejected.");
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
      let choices: Concept[] = [];
      if (!current) {
        const body = await api.request<{ project: ProjectSnapshot; concepts?: Concept[] }>("/api/projects", {
          method: "POST",
          body: JSON.stringify(briefForConcepts())
        });
        current = body.project;
        localStorage.setItem("fengine-project", current.id);
        choices = applyConversationConceptOverlays(
          body.concepts?.length ? body.concepts : [...conceptsFor(briefForConcepts())],
          conversationOverlays
        );
      } else {
        try {
          const found = await api.getProject(current.id);
          current = found.project;
          choices = applyConversationConceptOverlays(
            found.concepts?.length ? found.concepts : [...conceptsFor(current.brief.purpose ? current.brief : briefForConcepts())],
            conversationOverlays
          );
        } catch {
          choices = applyConversationConceptOverlays(
            [...conceptsFor(current.brief.purpose ? current.brief : briefForConcepts())],
            conversationOverlays
          );
        }
      }
      setProject(current);
      if (current.scenes.length) {
        setActiveSceneId(current.scenes[0]?.id ?? "");
        setStep("editor");
        setStatus("");
        return;
      }
      setConceptChoices(choices);
      setActiveSceneId("");
      setStep("concepts");
      setStatus(architecture.media === "own"
        ? "Pick a story shape, then attach your media to each scene."
        : "Captions, licensed clips, and a music bed are assembled after you choose.");
    } catch {
      setStatus("Story concepts could not be prepared. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function noteAssemble(line: string, advance = false) {
    setAssembleLog((lines) => [...lines.slice(-48), line]);
    setStatus(line);
    if (advance) setAssembleDone((done) => done + 1);
  }

  async function chooseConcept(conceptId: string) {
    if (busy || !project) return;
    mediaTransition.current += 1;
    setSceneMedia({});
    setSceneProgress({});
    setAssembleLog([]);
    setAssembleDone(0);
    setAssembleTotal(4);
    setBusy(true);
    setStep("assemble");
    noteAssemble("Writing captions and laying out scenes…");
    try {
      let current = project;
      if (!current.scenes.length) {
        try {
          current = await api.command(current.id, current.revision, "select_concept", { concept_id: conceptId });
        } catch (error) {
          const authoritative = snapshotFromConflict(error, current.id);
          if (!authoritative) throw error;
          current = authoritative.scenes.length
            ? authoritative
            : await api.command(authoritative.id, authoritative.revision, "select_concept", { concept_id: conceptId });
        }
      }
      setAssembleTotal(2 + Math.max(1, current.scenes.length));
      noteAssemble(`Laid out ${current.scenes.length} scenes.`, true);
      if (conversationSource && current.scenes.length) {
        try {
          noteAssemble("Applying on-screen copy…");
          const drafted = buildStoryboardDraft(
            current.brief.purpose,
            clientId,
            storyboardArchitectureForConcept(conceptId, architecture),
            conversationSource
          );
          current = await api.command(current.id, current.revision, "replace_storyboard", {
            scenes: mergeConversationStoryboard(current.scenes, drafted)
          });
          noteAssemble("On-screen copy is on the storyboard.");
        } catch {
          noteAssemble("Kept the engine captions.");
        }
      }
      if (!current.brief.soundtrack) {
        try {
          const bed = stockBedForPace(architecture.pace);
          noteAssemble(`Adding music bed · ${bed.label}…`);
          current = await api.command(current.id, current.revision, "update_soundtrack", {
            soundtrack: { kind: "stock", stock_id: bed.id, bpm: bed.bpm, offset_ms: 0, level: 0.8 }
          });
          noteAssemble(`Music bed · ${bed.label}.`, true);
        } catch {
          noteAssemble("Continuing without a music bed.", true);
        }
      } else {
        noteAssemble("Music bed already on this draft.", true);
      }
      setProject(current);
      setActiveSceneId(current.scenes[0]?.id ?? "");
      setVoiceScript(current.scenes.map((scene) => scene.caption.trim()).filter(Boolean).join("\n"));
      const clips = pendingClips.current;
      if (architecture.media === "own" && !clips.length) {
        noteAssemble("Upload media for each scene next.");
        setStatus("Storyboard ready. Upload media for each scene.");
        setStep("media");
        return;
      }
      if (clips.length) {
        try {
          noteAssemble(`Attaching ${clips.length} of your clips…`);
          current = await attachPendingClips(current);
          setActiveSceneId(current.scenes[0]?.id ?? "");
          noteAssemble("Your clips are on the storyboard.", true);
        } catch {
          noteAssemble("Some clips could not be attached.");
          setStatus("Some clips could not be attached. Upload the rest from the storyboard.");
        }
      }
      if (architecture.media === "own") {
        setStep("review");
        setStatus(current.scenes.every((scene) => scene.media_id)
          ? "Clips on the storyboard. Play the draft, then export or edit."
          : "Storyboard ready. Upload media for each scene.");
        return;
      }
      if (!pexelsCredential?.connected && !pixabayCredential?.connected) {
        noteAssemble("Connect Pexels or Pixabay in Settings to match licensed clips.");
        setStatus(stockFillStatus("pexels_not_connected"));
        setStep("review");
        return;
      }
      try {
        await fillStockStoryboard(current);
      } catch (error) {
        const message = stockFillStatus(error instanceof ApiResponseError ? error.type : undefined);
        noteAssemble(message);
        setStatus(message);
      }
      setStep("review");
    } catch (error) {
      const detail = error instanceof ApiResponseError ? error.message : "";
      const message = detail && detail.length < 120
        ? `Your storyboard could not be created. ${detail}`
        : "Your storyboard could not be created. Please try again.";
      noteAssemble(message);
      setStatus(message);
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
        setStatus(architecture.media === "own"
          ? "Pick a story shape, then attach your media to each scene."
          : "Captions, licensed clips, and a music bed are assembled after you choose.");
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
    pendingClips.current = [];
    setProject(undefined);
    setActiveSceneId("");
    setSceneMedia({});
    setSceneProgress({});
    setAssembleLog([]);
    setAssembleDone(0);
    setCandidates([]);
    setArchitecture(defaultVideoArchitecture);
    setConversationSource(undefined);
    setConversationOverlays(undefined);
    setConversationPlanKind("rules");
    setDraft(localStorage.getItem("fengine-draft") ?? "");
    setVoiceScript("");
    setStatus("");
    setStep("brief");
  }

  function startFromClips() {
    gather.current?.click();
  }

  function onGatherFiles(event: { currentTarget: HTMLInputElement }) {
    const files = [...(event.currentTarget.files ?? [])]
      .filter((file) => /^(video\/mp4|image\/(jpeg|png|webp))$/.test(file.type))
      .slice(0, 8);
    event.currentTarget.value = "";
    if (!files.length) {
      setStatus("Use JPEG, PNG, WebP, or MP4 clips.");
      return;
    }
    pendingClips.current = files;
    setArchitecture({
      ...defaultVideoArchitecture,
      media: "own",
      durationSeconds: durationSecondsFromClipCount(files.length)
    });
    setDraft((current) => current.trim() || `Vertical video from ${files.length} clips`);
    setStatus(`${files.length} clips ready. Continue to the video plan.`);
    setStep("brief");
  }

  async function continueToArchitecture() {
    const brief = draft.trim();
    if (!brief || busy) return;
    setBusy(true);
    const falReady = Boolean(falCredential?.connected && !falUnavailable);
    setStatus(falReady ? "Writing the video plan…" : "");
    try {
      let recommended = recommendVideoArchitecture(brief);
      let source: StoryboardSource | undefined;
      let overlays: ConversationConceptOverlays | undefined;
      let kind: "fal" | "rules" = "rules";
      let note = falReady
        ? "FAL conversation was unavailable. Using the rule-based plan."
        : "Rule-based plan. Connect FAL in Settings for smarter copy.";
      if (falReady) {
        try {
          const planned = await api.planCreateConversation(brief);
          recommended = planned.architecture;
          source = planned.source;
          overlays = planned.concept_overlays;
          kind = "fal";
          note = "FAL wrote this plan and on-screen copy. Usage is billed to your FAL account.";
        } catch {
          // Keep the rule-based plan.
        }
      }
      setArchitecture(pendingClips.current.length
        ? { ...recommended, media: "own", durationSeconds: durationSecondsFromClipCount(pendingClips.current.length) }
        : recommended);
      setConversationSource(source);
      setConversationOverlays(overlays);
      setConversationPlanKind(kind);
      setStatus(note);
      setStep("architecture");
    } finally {
      setBusy(false);
    }
  }

  async function saveScenePatch(sceneId: string, patch: Partial<Scene>) {
    const scene = project?.scenes.find(({ id }) => id === sceneId);
    if (!project || !scene) return;
    const next = { ...scene, ...patch, ...(patch.caption !== undefined ? { caption_cues: undefined } : {}) };
    if (typeof next.title === "string") {
      const title = next.title.trim();
      if (title) next.title = title.slice(0, 60);
      else delete next.title;
    }
    setProject({
      ...project,
      scenes: project.scenes.map((item) => item.id === sceneId ? next : item)
    });
    setStatus("Saving…");
    try {
      const updated = await api.command(project.id, project.revision, "update_scene", { scene: next });
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

  async function saveSoundtrack(soundtrack: Soundtrack | null) {
    if (!project) return false;
    setStatus("Saving…");
    try {
      const updated = await api.command(project.id, project.revision, "update_soundtrack", { soundtrack });
      setProject(updated);
      setStatus("✓ All changes saved");
      return true;
    } catch (error) {
      if (error instanceof ApiResponseError && error.status === 409) {
        openConflict(error.body.authoritative_snapshot as unknown as ProjectSnapshot, {
          operation: "music bed"
        });
        return false;
      }
      setStatus("Music bed could not be saved.");
      return false;
    }
  }

  async function saveVoiceover(voiceover: Voiceover | null) {
    if (!project) return false;
    setStatus("Saving…");
    try {
      const updated = await api.command(project.id, project.revision, "update_voiceover", { voiceover });
      setProject(updated);
      setStatus("✓ All changes saved");
      return true;
    } catch (error) {
      if (error instanceof ApiResponseError && error.status === 409) {
        openConflict(error.body.authoritative_snapshot as unknown as ProjectSnapshot, {
          operation: "voice-over"
        });
        return false;
      }
      setStatus("Voice-over could not be saved.");
      return false;
    }
  }

  async function snapScenesToBeat() {
    if (!project) return;
    const bpm = clampBpm(project.brief.soundtrack?.bpm);
    setStatus("Saving…");
    try {
      let current = project;
      for (const scene of project.scenes) {
        const duration_ms = snapDurationToBeat(scene.duration_ms, bpm);
        if (duration_ms === scene.duration_ms) continue;
        current = await api.command(current.id, current.revision, "update_scene", {
          scene: { ...scene, duration_ms }
        });
      }
      setProject(current);
      setStatus("✓ Scenes snapped to the beat");
    } catch (error) {
      if (error instanceof ApiResponseError && error.status === 409) {
        openConflict(error.body.authoritative_snapshot as unknown as ProjectSnapshot, {
          operation: "beat snap"
        });
        return;
      }
      setStatus("Scenes could not be snapped to the beat.");
    }
  }

  function stopMusicPreview() {
    previewAudio.current?.pause();
    setPreviewingId(undefined);
  }

  function toggleMusicPreview(hit: MixkitMatch) {
    const audio = previewAudio.current;
    if (!audio) return;
    if (previewingId === hit.id && !audio.paused) {
      stopMusicPreview();
      return;
    }
    if (livePlaying) pauseLivePreview();
    bedAudio.current?.pause();
    audio.src = hit.previewUrl;
    void audio.play().catch(() => undefined);
    setPreviewingId(hit.id);
  }

  async function searchLicensedMusic(query = musicQuery) {
    setMusicQuery(query);
    stopMusicPreview();
    setStatus("Finding licensed music…");
    try {
      const body = await api.request<{ results: MixkitMatch[] }>(
        `/api/music/search?q=${encodeURIComponent(query.trim() || "trendy")}`
      );
      setMusicHits(body.results);
      setStatus(body.results.length
        ? "Choose a licensed track, or upload your own."
        : "No licensed tracks for that search. Try another vibe.");
    } catch {
      setStatus("Licensed music search failed. Upload a track you have permission to use.");
    }
  }

  async function useMixkitTrack(hit: MixkitMatch) {
    if (!project) return;
    stopMusicPreview();
    setBusy(true);
    setStatus(`Copying ${hit.title} from Mixkit…`);
    try {
      const imported = await api.request<SceneMediaView>(`/api/projects/${project.id}/media/music`, {
        method: "POST",
        body: JSON.stringify({ mixkit_id: hit.id })
      });
      setSceneMedia((current) => ({ ...current, [imported.id]: imported }));
      if (await saveSoundtrack({
        kind: "upload",
        media_id: imported.id,
        bpm: clampBpm(project.brief.soundtrack?.bpm),
        offset_ms: 0,
        level: project.brief.soundtrack?.level ?? 0.8
      })) {
        setMusicOpen(false);
        setStatus(`Music bed: ${hit.title} · ${hit.artist} · Mixkit`);
      }
    } catch {
      setStatus("That licensed track could not be added. Try another.");
    } finally {
      setBusy(false);
    }
  }

  async function admitAudioFile(file: File, purpose: "music" | "voiceover" = "music") {
    if (!project) return;
    const declared = file.type === "audio/x-m4a" || file.type === "audio/mp4" || file.type === "audio/mpeg" || file.type === "audio/wav" || file.type === "audio/x-wav"
      ? (file.type === "audio/x-m4a" || file.type === "audio/mp4" ? "audio/mp4" : file.type === "audio/x-wav" ? "audio/wav" : file.type)
      : "";
    const fromName = file.name.toLowerCase().endsWith(".wav") ? "audio/wav"
      : file.name.toLowerCase().endsWith(".m4a") ? "audio/mp4"
        : file.name.toLowerCase().endsWith(".mp3") ? "audio/mpeg"
          : "";
    const type = declared || fromName;
    if (!type) {
      setStatus("Use an MP3, WAV, or M4A file you have permission to use.");
      return;
    }
    setBusy(true);
    setStatus(purpose === "voiceover" ? "Uploading voice-over…" : "Uploading music…");
    try {
      const admission = await api.request<{ asset_id: string; upload_url: string }>(
        `/api/projects/${project.id}/media/uploads`,
        {
          method: "POST",
          body: JSON.stringify({ content_type: type, bytes: file.size })
        }
      );
      const uploaded = await fetch(admission.upload_url, {
        method: "PUT",
        headers: { "content-type": type },
        body: file
      });
      if (!uploaded.ok) throw new Error("Upload failed");
      const ready = await api.request<SceneMediaView>(
        `/api/projects/${project.id}/media/${admission.asset_id}/complete`,
        { method: "POST" }
      );
      setSceneMedia((current) => ({ ...current, [ready.id]: ready }));
      if (purpose === "voiceover") {
        await saveVoiceover({
          media_id: ready.id,
          offset_ms: project.brief.voiceover?.offset_ms ?? 0,
          level: project.brief.voiceover?.level ?? 1
        });
        setVoiceOpen(false);
        if (voiceScript.trim()) void applyVoiceCaptions();
      } else {
        await saveSoundtrack({
          kind: "upload",
          media_id: ready.id,
          bpm: clampBpm(project.brief.soundtrack?.bpm),
          offset_ms: 0,
          level: project.brief.soundtrack?.level ?? 0.8
        });
        setMusicOpen(false);
      }
    } catch {
      setStatus(purpose === "voiceover"
        ? "Voice-over could not be uploaded. Check the file and try again."
        : "Music could not be uploaded. Check the file and try again.");
    } finally {
      setBusy(false);
    }
  }

  function releaseRecorder() {
    recorder.current = null;
    recordStream.current?.getTracks().forEach((track) => track.stop());
    recordStream.current = null;
  }

  async function startVoiceRecord() {
    if (!project || recording || busy) return;
    if (livePlaying) pauseLivePreview();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordStream.current = stream;
      recordChunks.current = [];
      const media = new MediaRecorder(stream);
      media.ondataavailable = (event) => {
        if (event.data.size) recordChunks.current.push(event.data);
      };
      media.onstop = () => {
        void finishVoiceRecord(media.mimeType);
      };
      recorder.current = media;
      media.start();
      setRecording(true);
      setVoiceOpen(true);
      setStatus("Recording voice-over…");
    } catch {
      releaseRecorder();
      setStatus("Microphone is blocked. Upload a WAV, MP3, or M4A instead.");
    }
  }

  function stopVoiceRecord() {
    if (recorder.current && recorder.current.state !== "inactive") recorder.current.stop();
    else releaseRecorder();
    setRecording(false);
  }

  function cancelVoiceRecord() {
    if (recorder.current) recorder.current.onstop = null;
    stopVoiceRecord();
    recordChunks.current = [];
    setStatus("Recording discarded.");
  }

  async function finishVoiceRecord(mimeType: string) {
    const blob = new Blob(recordChunks.current, { type: mimeType || "audio/webm" });
    recordChunks.current = [];
    releaseRecorder();
    if (blob.size < 800) {
      setStatus("Recording was too short.");
      return;
    }
    setBusy(true);
    setStatus("Saving voice-over…");
    try {
      const context = new AudioContext();
      const buffer = await context.decodeAudioData(await blob.arrayBuffer());
      await context.close();
      await admitAudioFile(new File([encodeWav(buffer)], "voiceover.wav", { type: "audio/wav" }), "voiceover");
    } catch {
      setStatus("Recording could not be saved. Upload a WAV, MP3, or M4A instead.");
      setBusy(false);
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

  async function fillPixabayGaps(snapshot: ProjectSnapshot): Promise<ProjectSnapshot> {
    let current = snapshot;
    const used = new Set<number>();
    for (const scene of [...current.scenes].sort((a, b) => a.order - b.order)) {
      if (scene.media_id) continue;
      const query = scene.visual_prompt?.trim().slice(0, 100);
      if (!query) {
        setSceneProgress((progress) => ({ ...progress, [scene.id]: "needs_media" }));
        noteAssemble(`Scene ${scene.order + 1} · no search text.`, true);
        continue;
      }
      setSceneProgress((progress) => ({ ...progress, [scene.id]: "finding" }));
      noteAssemble(`Searching Pixabay for scene ${scene.order + 1}…`);
      try {
        const page = await api.request<{ results: StockMatch[] }>(`/api/pixabay/search?q=${encodeURIComponent(query)}`);
        const hit = page.results.find((item) => item.kind !== "still" && !used.has(item.id))
          ?? page.results.find((item) => !used.has(item.id));
        if (!hit) {
          setSceneProgress((progress) => ({ ...progress, [scene.id]: "needs_media" }));
          noteAssemble(`Scene ${scene.order + 1} · no Pixabay clip.`, true);
          continue;
        }
        used.add(hit.id);
        setSceneProgress((progress) => ({ ...progress, [scene.id]: "inspecting" }));
        noteAssemble(`Scene ${scene.order + 1} · inspecting ${hit.creator}…`);
        const path = hit.kind === "still"
          ? `/api/projects/${current.id}/media/pixabay/photo`
          : `/api/projects/${current.id}/media/pixabay`;
        const copied = await api.request<{ asset: { id: string } }>(path, {
          method: "POST",
          body: JSON.stringify({ query, pixabay_id: hit.id })
        });
        if (!await attachMediaWhenReady(copied.asset.id, current.id, scene.id)) {
          setSceneProgress((progress) => ({ ...progress, [scene.id]: "needs_media" }));
          noteAssemble(`Scene ${scene.order + 1} · inspection did not finish.`, true);
        } else {
          noteAssemble(`Scene ${scene.order + 1} · Pixabay clip by ${hit.creator}.`, true);
        }
        current = (await api.getProject(current.id)).project;
        setProject(current);
      } catch {
        setSceneProgress((progress) => ({ ...progress, [scene.id]: "needs_media" }));
        noteAssemble(`Scene ${scene.order + 1} · Pixabay search failed.`, true);
      }
    }
    return current;
  }

  async function fillStockStoryboard(snapshot: ProjectSnapshot): Promise<void> {
    setSceneProgress(Object.fromEntries(
      snapshot.scenes.map((scene) => [scene.id, scene.media_id ? "ready" as const : "finding" as const])
    ));
    noteAssemble("Matching licensed clips…");
    let current = snapshot;
    const sceneOrder = (id: string) => (snapshot.scenes.find((scene) => scene.id === id)?.order ?? 0) + 1;
    if (pexelsCredential?.connected) {
      try {
        noteAssemble("Searching Pexels…");
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
          const label = `Scene ${sceneOrder(result.scene_id)}`;
          if (result.state === "skipped") {
            noteAssemble(`${label} already has media.`, true);
            continue;
          }
          if (result.state !== "matched" || !result.asset) {
            setSceneProgress((progress) => ({ ...progress, [result.scene_id]: "needs_media" }));
            noteAssemble(`${label} · no Pexels clip.`, true);
            continue;
          }
          setSceneProgress((progress) => ({ ...progress, [result.scene_id]: "inspecting" }));
          noteAssemble(`${label} · inspecting Pexels clip…`);
          const attached = await attachMediaWhenReady(result.asset.id, snapshot.id, result.scene_id);
          if (!attached) {
            setSceneProgress((progress) => ({ ...progress, [result.scene_id]: "needs_media" }));
            noteAssemble(`${label} · inspection did not finish.`, true);
          } else {
            noteAssemble(`${label} · Pexels clip attached.`, true);
          }
        }
        current = (await api.getProject(snapshot.id)).project;
        setProject(current);
      } catch (error) {
        noteAssemble("Pexels matching failed.");
        if (!pixabayCredential?.connected) throw error;
      }
    }
    if (pixabayCredential?.connected && current.scenes.some((scene) => !scene.media_id)) {
      noteAssemble("Filling remaining scenes from Pixabay…");
      current = await fillPixabayGaps(current);
    }
    const { project: refreshed } = await api.getProject(current.id);
    setProject(refreshed);
    setSceneMedia(await loadSceneMediaViews(api, refreshed));
    const readyCount = refreshed.scenes.filter((scene) => scene.media_id).length;
    const summary = readyCount === refreshed.scenes.length
      ? "Draft ready. Play it, export, or edit."
      : `${readyCount} of ${refreshed.scenes.length} scenes have media. Find or upload the rest before rendering.`;
    noteAssemble(summary);
    setStatus(summary);
  }

  async function fillRemainingScenes() {
    if (!project || busy || !(pexelsCredential?.connected || pixabayCredential?.connected)) return;
    setBusy(true);
    try {
      await fillStockStoryboard(project);
    } catch (error) {
      setStatus(stockFillStatus(error instanceof ApiResponseError ? error.type : undefined));
    } finally {
      setBusy(false);
    }
  }

  async function applyVoiceCaptions() {
    if (!project || !voiceScript.trim()) return;
    const parts = captionsFromVoiceScript(voiceScript, project.scenes);
    if (!parts.length) return;
    setBusy(true);
    try {
      let current = project;
      for (const part of parts) {
        const scene = current.scenes.find((item) => item.id === part.id);
        if (!scene || scene.caption === part.caption) continue;
        current = await api.command(current.id, current.revision, "update_scene", {
          scene: { ...scene, caption: part.caption, caption_cues: undefined }
        });
      }
      setProject(current);
      setOverlayCaption(current.scenes.find((scene) => scene.id === activeSceneId)?.caption ?? voiceScript);
      setStatus("Voice script applied as scene captions.");
    } catch {
      setStatus("Captions could not be applied from the voice script.");
    } finally {
      setBusy(false);
    }
  }

  function downloadCover() {
    const video = exportVideo.current;
    if (!video || !video.videoWidth) {
      setStatus("Play the export, then download a cover frame.");
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.drawImage(video, 0, 0);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "cover.jpg";
      link.click();
      URL.revokeObjectURL(url);
    }, "image/jpeg", 0.9);
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
      id: clientId(), order: activeIndex + 1, caption: "",
      visual_prompt: `${project.brief.purpose.slice(0, 210).trim()} — additional visual beat`,
      duration_ms: 3000, focal_x: 0.5, focal_y: 0.5, motion: "zoom", audio_level: 1, ducking: false
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

  async function searchStock(sceneId: string, kind: "video" | "still") {
    const scene = project?.scenes.find(({ id }) => id === sceneId);
    const query = scene?.visual_prompt?.trim().slice(0, 100);
    if (!query) return;
    searchAbort.current?.abort();
    const controller = new AbortController();
    searchAbort.current = controller;
    const transition = ++searchTransition.current;
    setCandidates([]);
    setStatus("Finding licensed options for this scene…");
    const paths: string[] = [];
    if (pexelsCredential?.connected) {
      paths.push(kind === "still" ? `/api/pexels/photos/search?q=${encodeURIComponent(query)}` : `/api/pexels/search?q=${encodeURIComponent(query)}`);
    }
    if (pixabayCredential?.connected) {
      paths.push(kind === "still" ? `/api/pixabay/photos/search?q=${encodeURIComponent(query)}` : `/api/pixabay/search?q=${encodeURIComponent(query)}`);
    }
    try {
      const pages = await Promise.all(paths.map((path) => api.request<{ results: StockMatch[] }>(path, { signal: controller.signal })));
      if (transition !== searchTransition.current || activeSceneId !== sceneId) return;
      const results = pages.flatMap((page) => page.results);
      setCandidates(results.slice(0, 6));
      setStatus(results.length
        ? (kind === "still" ? "Choose the still that fits this scene." : "Choose the footage that fits this scene.")
        : "No licensed options found. Refine the footage search.");
    } catch (error) {
      if (!controller.signal.aborted) {
        const type = error instanceof ApiResponseError ? error.body.type : undefined;
        setStatus(type === "pexels_not_connected" || type === "pixabay_not_connected"
          ? "Connect a Pexels or Pixabay API key in Settings, or upload your own media."
          : "Licensed media search failed. Your scene edits are safe.");
      }
    }
  }

  async function selectStock(sceneId: string, candidate: StockMatch) {
    if (!project) return;
    const scene = project.scenes.find(({ id }) => id === sceneId);
    const query = scene?.visual_prompt?.trim().slice(0, 100);
    if (!scene || !query) return;
    setBusy(true);
    setStatus(`Copying ${candidate.kind === "still" ? "still" : "video"} by ${candidate.creator} for inspection…`);
    const path = candidate.source === "pixabay"
      ? (candidate.kind === "still" ? `/api/projects/${project.id}/media/pixabay/photo` : `/api/projects/${project.id}/media/pixabay`)
      : (candidate.kind === "still" ? `/api/projects/${project.id}/media/pexels/photo` : `/api/projects/${project.id}/media/pexels`);
    const bodyJson = candidate.source === "pixabay"
      ? { query, pixabay_id: candidate.id }
      : { query, pexels_id: candidate.id };
    try {
      const body = await api.request<{ asset: { id: string } }>(path, {
        method: "POST",
        body: JSON.stringify(bodyJson)
      });
      if (await attachMediaWhenReady(body.asset.id, project.id, sceneId)) {
        const label = candidate.source === "pixabay" ? "Pixabay" : "Pexels";
        setStatus(`Scene media selected · ${candidate.kind === "still" ? "still" : "video"} by ${candidate.creator} on ${label}`);
      }
    } catch (error) {
      const type = error instanceof ApiResponseError ? error.body.type : undefined;
      setStatus(type === "pexels_not_connected" || type === "pixabay_not_connected"
        ? "Connect a Pexels or Pixabay API key in Settings, or upload your own media."
        : "That licensed visual could not be attached. Choose another or try again.");
    } finally {
      setBusy(false);
    }
  }

  async function uploadAndAttach(file: File, projectId: string, sceneId: string): Promise<boolean> {
    const admission = await api.request<{ asset_id: string; upload_url: string }>(
      `/api/projects/${projectId}/media/uploads`,
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
    await api.request(`/api/projects/${projectId}/media/${admission.asset_id}/complete`, { method: "POST" });
    return attachMediaWhenReady(admission.asset_id, projectId, sceneId);
  }

  async function attachPendingClips(snapshot: ProjectSnapshot): Promise<ProjectSnapshot> {
    const files = pendingClips.current.slice(0, snapshot.scenes.length);
    pendingClips.current = [];
    let current = snapshot;
    const scenes = [...current.scenes].sort((a, b) => a.order - b.order);
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const scene = scenes[index];
      if (!file || !scene) break;
      setStatus(`Uploading clip ${index + 1} of ${files.length}…`);
      await uploadAndAttach(file, current.id, scene.id);
      const found = await api.getProject(current.id);
      current = found.project;
      setProject(current);
    }
    return current;
  }

  async function admitFile(file: File, intendedSceneId: string) {
    if (!project || !project.scenes.some(({ id }) => id === intendedSceneId)) return;
    mediaTransition.current += 1;
    setBusy(true);
    setStatus("Uploading media…");
    try {
      if (await uploadAndAttach(file, project.id, intendedSceneId)) {
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
    const scenes = (source.scenes.length ? source.scenes : buildStoryboardDraft(brief.purpose, () => clientId())).map((scene, order) => {
      const { media_id: _mediaId, ...withoutMedia } = scene;
      return {
        ...withoutMedia,
        id: clientId(),
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

  async function loadPixabayCredential() {
    setPixabayBusy(true);
    try {
      const view = await api.request<PixabayCredentialView>("/api/providers/pixabay/credential");
      setPixabayCredential(view);
      setPixabayUnavailable(false);
    } catch (error) {
      setPixabayCredential(undefined);
      setPixabayUnavailable(error instanceof ApiResponseError && error.status === 503);
    } finally {
      setPixabayBusy(false);
    }
  }

  async function connectPixabay() {
    if (!pixabayKey.trim()) return;
    if (pixabayCredential?.connected && !window.confirm("Replace your saved Pixabay API key?")) return;
    setPixabayBusy(true);
    try {
      const view = await api.request<PixabayCredentialView>("/api/providers/pixabay/credential", {
        method: "PUT",
        body: JSON.stringify({ api_key: pixabayKey })
      });
      setPixabayCredential(view);
      setPixabayUnavailable(false);
      setStatus("Pixabay connected. Licensed searches now use your encrypted key.");
    } catch (error) {
      const type = error instanceof ApiResponseError ? error.body.type : undefined;
      setStatus(type === "invalid_provider_credential"
        ? "Pixabay rejected this API key. Check it and try again."
        : type === "provider_unavailable"
          ? "Pixabay could not be reached. Your existing projects are safe."
          : "Pixabay could not be connected.");
    } finally {
      setPixabayKey("");
      setPixabayBusy(false);
    }
  }

  async function testPixabay() {
    setPixabayBusy(true);
    try {
      const view = await api.request<PixabayCredentialView>("/api/providers/pixabay/credential/test", { method: "POST" });
      setPixabayCredential(view);
      setStatus("Pixabay connection verified.");
    } catch (error) {
      const type = error instanceof ApiResponseError ? error.body.type : undefined;
      setStatus(type === "invalid_provider_credential"
        ? "Pixabay rejected the saved key. Replace or disconnect it."
        : "Pixabay could not verify the saved key. Try again later.");
    } finally {
      setPixabayBusy(false);
    }
  }

  async function disconnectPixabay() {
    if (!window.confirm("Disconnect Pixabay and delete your saved encrypted key? Licensed search will stop working.")) return;
    setPixabayBusy(true);
    try {
      await api.request("/api/providers/pixabay/credential", { method: "DELETE" });
      setPixabayCredential({ provider: "pixabay", connected: false });
      setPixabayKey("");
      setStatus("Pixabay disconnected. You can still upload your own media.");
    } catch {
      setStatus("Pixabay could not be disconnected. Try again.");
    } finally {
      setPixabayBusy(false);
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
    setFeatureLock(pexelsUnavailable && pixabayUnavailable
      ? { title: "Pexels is unavailable", message: "This deployment cannot connect Pexels. Upload your own media instead." }
      : { title: "Pexels stock is locked", message: "Connect your Pexels API key to search real stock video.", action: "settings" });
  }

  function showStockLock() {
    if (pexelsUnavailable && pixabayUnavailable) {
      setFeatureLock({ title: "Licensed stock is unavailable", message: "This deployment cannot connect Pexels or Pixabay. Upload your own media instead." });
      return;
    }
    showPexelsLock();
  }

  function falJobStorageKey(projectId: string, sceneId: string) {
    return `fengine-fal-job:${projectId}:${sceneId}`;
  }

  function falGenerationActive(state: string) {
    return !["ready", "cancelled", "failed", "submission_uncertain", "quoted"].includes(state);
  }

  function falGenerationReviewable(job: GenerationJobView | undefined) {
    return Boolean(job?.state === "ready" && job.result_media?.state === "ready");
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
        return job.kind === "speech"
          ? "FAL voice-over failed. Your current voice-over was not changed."
          : "FAL generation failed. Your scene media was not changed.";
    }
  }

  function openFalGenerate(scene: Scene) {
    if (!falCredential?.connected || falUnavailable) {
      showFalLock();
      return;
    }
    if (falGenJob?.scene_id === scene.id) {
      setFalGenPrompt(falGenJob.prompt);
      setFalGenOpen(true);
      if (falGenerationActive(falGenJob.state) && falGenPollRef.current !== falGenJob.id) {
        void pollFalGeneration(falGenJob.id);
      }
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
        if (falGenerationActive(job.state) && falGenPollRef.current !== job.id) {
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
        body: JSON.stringify({ idempotency_key: clientId() })
      });
      setFalGenJob(job);
      localStorage.setItem(falJobStorageKey(project.id, activeScene.id), job.id);
      setFalGenOpen(false);
      setStatus(`Generating still for scene ${activeScene.order + 1} in the background. You can keep editing.`);
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
    if (falGenPollRef.current === jobId) return;
    falGenPollRef.current = jobId;
    const deadline = Date.now() + 12 * 60_000;
    try {
      while (Date.now() < deadline) {
        try {
          const job = await api.request<GenerationJobView>(`/api/generation-jobs/${jobId}`);
          setFalGenJob(job);
          if (["ready", "cancelled", "failed", "submission_uncertain"].includes(job.state)) {
            if (job.state === "ready") setStatus("AI still ready — open Generate AI image to review it.");
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
    } finally {
      if (falGenPollRef.current === jobId) falGenPollRef.current = undefined;
    }
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
    if (falVideoJob?.scene_id === scene.id) {
      setFalVideoPrompt(falVideoJob.prompt);
      setFalVideoOpen(true);
      if (falGenerationActive(falVideoJob.state) && falVideoPollRef.current !== falVideoJob.id) {
        void pollFalVideo(falVideoJob.id);
      }
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
        if (falGenerationActive(job.state) && falVideoPollRef.current !== job.id) {
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
      const detail = error instanceof ApiResponseError && typeof error.body.message === "string"
        ? error.body.message.trim()
        : "";
      setStatus(type === "fal_not_connected"
        ? "Connect your FAL API key in Settings first."
        : type === "fal_generation_busy"
          ? "Only one active FAL generation is allowed. Wait or cancel it."
          : type === "invalid_provider_credential"
            ? "FAL rejected the saved key. Replace it in Settings."
            : type === "validation" && detail
              ? detail
              : "FAL could not price this video. Check that the scene still has a ready JPEG, PNG, or WebP portrait.");
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
        body: JSON.stringify({ idempotency_key: clientId() })
      });
      setFalVideoJob(job);
      localStorage.setItem(falVideoStorageKey(project.id, activeScene.id), job.id);
      setFalVideoOpen(false);
      setStatus(`Animating scene ${activeScene.order + 1} in the background. You can keep editing.`);
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
    if (falVideoPollRef.current === jobId) return;
    falVideoPollRef.current = jobId;
    const deadline = Date.now() + 25 * 60_000;
    try {
      while (Date.now() < deadline) {
        try {
          const job = await api.request<GenerationJobView>(`/api/generation-jobs/${jobId}`);
          setFalVideoJob(job);
          if (["ready", "cancelled", "failed", "submission_uncertain"].includes(job.state)) {
            if (job.state === "ready") setStatus("AI video ready — open Animate this image to review it.");
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
    } finally {
      if (falVideoPollRef.current === jobId) falVideoPollRef.current = undefined;
    }
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

  function falSpeechStorageKey(projectId: string) {
    return `fengine-fal-speech:${projectId}`;
  }

  function defaultVoicePrompt(snapshot: ProjectSnapshot): string {
    return snapshot.scenes.map((scene) => scene.caption.trim()).filter(Boolean).join("\n").slice(0, 2000);
  }

  function openFalSpeech() {
    if (!project) return;
    if (!falCredential?.connected || falUnavailable) {
      showFalLock();
      return;
    }
    setFalSpeechPrompt(defaultVoicePrompt(project));
    setFalSpeechJob(undefined);
    setFalSpeechOpen(true);
    setVoiceOpen(true);
    const stored = localStorage.getItem(falSpeechStorageKey(project.id));
    if (!stored) return;
    void (async () => {
      try {
        const job = await api.request<GenerationJobView>(`/api/generation-jobs/${stored}`);
        if (job.kind !== "speech") {
          localStorage.removeItem(falSpeechStorageKey(project.id));
          return;
        }
        setFalSpeechJob(job);
        setFalSpeechPrompt(job.prompt);
        if (!["ready", "cancelled", "failed", "submission_uncertain", "quoted"].includes(job.state)) {
          void pollFalSpeech(job.id);
        }
      } catch {
        localStorage.removeItem(falSpeechStorageKey(project.id));
      }
    })();
  }

  async function quoteFalSpeech() {
    if (!project) return;
    const prompt = falSpeechPrompt.trim();
    if (!prompt || prompt.length > 2000) {
      setStatus("Enter a voice-over script between 1 and 2000 characters.");
      return;
    }
    setFalSpeechBusy(true);
    setStatus("Requesting FAL price…");
    try {
      const job = await api.request<GenerationJobView>(
        `/api/projects/${project.id}/fal/speech-quotes`,
        { method: "POST", body: JSON.stringify({ prompt }) }
      );
      setFalSpeechJob(job);
      localStorage.setItem(falSpeechStorageKey(project.id), job.id);
      setStatus("Review the FAL price, then confirm to generate voice-over.");
    } catch (error) {
      const type = error instanceof ApiResponseError ? error.body.type : undefined;
      setStatus(type === "fal_not_connected"
        ? "Connect your FAL API key in Settings first."
        : type === "fal_generation_busy"
          ? "Only one active FAL generation is allowed. Wait or cancel it."
          : type === "invalid_provider_credential"
            ? "FAL rejected the saved key. Replace it in Settings."
            : "FAL could not price this voice-over. Try again later.");
    } finally {
      setFalSpeechBusy(false);
    }
  }

  async function confirmFalSpeech() {
    if (!project || !falSpeechJob || falSpeechJob.state !== "quoted") return;
    if (falSpeechJob.quote.estimated_total === null) return;
    setFalSpeechBusy(true);
    setStatus("Confirming FAL voice-over…");
    try {
      const job = await api.request<GenerationJobView>(`/api/generation-jobs/${falSpeechJob.id}/confirm`, {
        method: "POST",
        body: JSON.stringify({ idempotency_key: clientId() })
      });
      setFalSpeechJob(job);
      localStorage.setItem(falSpeechStorageKey(project.id), job.id);
      setStatus("FAL voice-over queued.");
      void pollFalSpeech(job.id);
    } catch (error) {
      const type = error instanceof ApiResponseError ? error.body.type : undefined;
      setStatus(type === "quote_expired"
        ? "This quote expired. Request a new price."
        : type === "quote_incomplete"
          ? "FAL could not calculate a total for this model."
          : "FAL voice-over could not be confirmed.");
    } finally {
      setFalSpeechBusy(false);
    }
  }

  async function pollFalSpeech(jobId: string) {
    const deadline = Date.now() + 12 * 60_000;
    while (Date.now() < deadline) {
      try {
        const job = await api.request<GenerationJobView>(`/api/generation-jobs/${jobId}`);
        if (job.state === "ready" && job.result_media && project) {
          try {
            const media = await api.request<SceneMediaView>(
              `/api/projects/${project.id}/media/${job.result_media.id}`
            );
            setFalSpeechJob({ ...job, result_media: media });
          } catch {
            setFalSpeechJob(job);
          }
        } else {
          setFalSpeechJob(job);
        }
        if (["ready", "cancelled", "failed", "submission_uncertain"].includes(job.state)) {
          if (job.state === "ready") setStatus("AI voice-over ready — review it before attaching.");
          else if (job.state === "cancelled") setStatus("FAL voice-over cancelled.");
          else setStatus(falGenFailureMessage(job));
          return;
        }
        setStatus(`FAL voice-over · ${job.state.replaceAll("_", " ")}`);
      } catch {
        setStatus("Could not refresh FAL voice-over status.");
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    setStatus("FAL voice-over is still running. Reopen Generate with FAL to check again.");
  }

  async function cancelFalSpeech() {
    if (!falSpeechJob) return;
    setFalSpeechBusy(true);
    try {
      const job = await api.request<GenerationJobView>(`/api/generation-jobs/${falSpeechJob.id}/cancel`, { method: "POST" });
      setFalSpeechJob(job);
      setStatus(job.state === "cancelled"
        ? "FAL voice-over cancelled."
        : "Cancel requested. FAL may still bill work that already started.");
    } catch {
      setStatus("FAL voice-over could not be cancelled.");
    } finally {
      setFalSpeechBusy(false);
    }
  }

  async function useFalSpeechMedia() {
    if (!project || !falSpeechJob?.result_media || falSpeechJob.result_media.state !== "ready") return;
    setFalSpeechBusy(true);
    setBusy(true);
    try {
      const media = await api.request<SceneMediaView>(
        `/api/projects/${project.id}/media/${falSpeechJob.result_media.id}`
      );
      setSceneMedia((current) => ({ ...current, [media.id]: media }));
      const saved = await saveVoiceover({
        media_id: media.id,
        offset_ms: project.brief.voiceover?.offset_ms ?? 0,
        level: project.brief.voiceover?.level ?? 1
      });
      if (!saved) return;
      localStorage.removeItem(falSpeechStorageKey(project.id));
      setFalSpeechOpen(false);
      setStatus("Voice-over uses AI-generated FAL audio.");
    } catch {
      setStatus("Generated voice-over could not be attached.");
    } finally {
      setFalSpeechBusy(false);
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
  const activeVideoPreparing = Boolean(activeScene && falVideoJob?.scene_id === activeScene.id && falGenerationActive(falVideoJob.state));
  const activeImagePreparing = Boolean(activeScene && falGenJob?.scene_id === activeScene.id && falGenerationActive(falGenJob.state));
  const activePreparing = activeVideoPreparing || activeImagePreparing;
  const measuredActive = previewSize?.url === activePreviewUrl ? previewSize : undefined;
  const wideStill = isWideMedia(activeMedia?.detected?.width, activeMedia?.detected?.height)
    || isWideMedia(measuredActive?.width, measuredActive?.height);
  useEffect(() => {
    if (!project?.id) return;
    const projectId = project.id;
    let cancelled = false;
    void (async () => {
      for (const scene of project.scenes) {
        const stored = localStorage.getItem(falVideoStorageKey(projectId, scene.id));
        if (!stored) continue;
        try {
          const job = await api.request<GenerationJobView>(`/api/generation-jobs/${stored}`);
          if (cancelled || job.kind !== "image_to_video") return;
          setFalVideoJob((current) => (current?.id === job.id ? current : job));
          setFalVideoPrompt(job.prompt);
          if (falGenerationActive(job.state)) void pollFalVideo(job.id);
        } catch {
          if (!cancelled) localStorage.removeItem(falVideoStorageKey(projectId, scene.id));
        }
        return;
      }
    })();
    return () => { cancelled = true; };
  }, [project?.id]);
  useEffect(() => {
    if (!activeScene || previewPan.current) return;
    setCropFocus({ x: clampFocus(activeScene.focal_x), y: clampFocus(activeScene.focal_y) });
  }, [activeScene?.id, activeScene?.focal_x, activeScene?.focal_y]);
  useEffect(() => {
    setOverlayCaption(activeScene?.caption ?? "");
  }, [activeScene?.id, activeScene?.title, activeScene?.caption]);
  const allScenesHaveMedia = Boolean(project?.scenes.length && project.scenes.every(({ media_id }) =>
    media_id && sceneMedia[media_id]?.state === "ready"));
  const readyGaps = project ? exportGaps(project) : [];
  const missingMediaCount = project?.scenes.filter((scene) => !scene.media_id).length ?? 0;
  const allScenesHavePreview = Boolean(project?.scenes.length && project.scenes.every((scene) =>
    scenePreviewUrl(scene.media_id ? sceneMedia[scene.media_id] : undefined)));
  const previewScene = livePlaying
    ? (project?.scenes.find(({ id }) => id === playSceneId) ?? activeScene)
    : activeScene;
  const overlayLook = previewScene?.overlay_look === "title" || previewScene?.overlay_look === "poster"
    ? previewScene.overlay_look
    : "caption";
  const overlayPlace = previewScene?.overlay_place === "top" || previewScene?.overlay_place === "center"
    ? previewScene.overlay_place
    : overlayLook === "title" ? "center" : "bottom";
  const liveOverlay = previewScene?.id === activeScene?.id;
  const shownCaption = (liveOverlay ? overlayCaption : previewScene?.caption ?? "").trim();
  const overlayGhost = !shownCaption && !livePlaying;
  const previewMedia = previewScene?.media_id ? sceneMedia[previewScene.media_id] : undefined;
  const previewUrl = scenePreviewUrl(previewMedia);
  const measuredPreview = previewSize?.url === previewUrl ? previewSize : undefined;
  const previewFocus = {
    x: clampFocus(livePlaying ? previewScene?.focal_x ?? cropFocus.x : cropFocus.x),
    y: clampFocus(livePlaying ? previewScene?.focal_y ?? cropFocus.y : cropFocus.y)
  };
  const previewPosition = {
    objectPosition: `${previewFocus.x * 100}% ${previewFocus.y * 100}%`,
    ["--scene-ms" as string]: `${Math.max(500, previewScene?.duration_ms ?? 3000)}ms`,
    ["--focus-x" as string]: `${previewFocus.x * 100}%`,
    ["--focus-y" as string]: `${previewFocus.y * 100}%`
  };
  const previewWide = isWideMedia(previewMedia?.detected?.width, previewMedia?.detected?.height)
    || isWideMedia(measuredPreview?.width, measuredPreview?.height);
  const previewMotion = livePlaying && previewScene && previewScene.motion !== "none" ? previewScene.motion : undefined;
  const previewMotionClass = [
    previewMotion ? `motion-${previewMotion}` : "",
    previewWide ? "is-wide" : ""
  ].filter(Boolean).join(" ") || undefined;
  const sceneElapsedMs = livePlaying
    ? sceneClock.current.elapsedAtPause + Math.max(0, playTick - sceneClock.current.startedAt)
    : sceneClock.current.elapsedAtPause;
  const playhead = livePlayhead(project?.scenes ?? [], playSceneId || previewScene?.id || "", sceneElapsedMs);
  const timeline = liveTimeline(project?.scenes ?? []);
  const soundtrack = project?.brief.soundtrack;
  const soundtrackMedia = soundtrack?.kind === "upload" && soundtrack.media_id
    ? sceneMedia[soundtrack.media_id]
    : undefined;
  const soundtrackUrl = soundtrack?.kind === "upload" && soundtrack.media_id
    ? scenePreviewUrl(sceneMedia[soundtrack.media_id])
    : soundtrack?.kind === "stock"
      ? stockBedUrl(soundtrack.stock_id)
      : undefined;
  const beatMarks = soundtrack ? musicLaneBeats(playhead.totalMs, soundtrack.bpm) : [];
  const soundtrackHint = !soundtrack
    ? ""
    : soundtrack.kind === "stock"
      ? `${stockBeds.find((bed) => bed.id === soundtrack.stock_id)?.label ?? "Catalog"} · Export final mixes this bed`
      : soundtrackMedia?.attribution?.source === "Mixkit"
        ? `${soundtrackMedia.attribution.title ?? "Mixkit"} · ${soundtrackMedia.attribution.creator} · Mixkit · Export final mixes this bed`
        : `Uploaded · Export final mixes this bed`;
  const musicLabel = !soundtrack
    ? "Add music"
    : soundtrack.kind === "stock"
      ? (stockBeds.find((bed) => bed.id === soundtrack.stock_id)?.label ?? "Music bed")
      : soundtrackMedia?.attribution?.title ?? "Uploaded music";
  const voiceover = project?.brief.voiceover;
  const voiceoverUrl = voiceover?.media_id ? scenePreviewUrl(sceneMedia[voiceover.media_id]) : undefined;
  const spokenCue = previewScene && livePlaying
    ? (cueAtElapsed(cuesForScene(previewScene), playhead.sceneElapsedMs)?.text ?? "")
    : shownCaption;
  const overlayHeadline = overlayLook === "title"
    ? (shownCaption || (overlayGhost ? "Title" : ""))
    : "";
  const overlayLine = overlayLook === "title"
    ? ""
    : spokenCue || (overlayGhost ? "Your caption" : "");

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

  function notePreviewPixels(url: string | undefined, width: number, height: number) {
    if (!url || width <= 0 || height <= 0) return;
    setPreviewSize((current) => current?.url === url && current.width === width && current.height === height
      ? current
      : { url, width, height });
  }

  function beginPreviewPan(event: { currentTarget: HTMLElement; pointerId: number; button: number; clientX: number; clientY: number; preventDefault: () => void }) {
    if (!previewUrl || event.button !== 0) return;
    const scene = previewScene ?? activeScene;
    if (!scene) return;
    const wasPlaying = livePlaying;
    if (wasPlaying) pauseLivePreview();
    if (scene.id !== activeSceneId) {
      setActiveSceneId(scene.id);
      setPlaySceneId(scene.id);
    }
    const startFocus = {
      x: clampFocus(wasPlaying ? scene.focal_x : cropFocus.x),
      y: clampFocus(wasPlaying ? scene.focal_y : cropFocus.y)
    };
    previewPan.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startFocus,
      moved: false,
      sceneId: scene.id,
      wasPlaying
    };
    setCropFocus(startFocus);
    setPreviewPanning(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function movePreviewPan(event: { currentTarget: HTMLElement; pointerId: number; clientX: number; clientY: number }) {
    const pan = previewPan.current;
    if (!pan || event.pointerId !== pan.pointerId) return;
    const box = event.currentTarget.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return;
    if (!pan.moved && Math.hypot(event.clientX - pan.startX, event.clientY - pan.startY) < 4) return;
    pan.moved = true;
    setCropFocus(panFocus(pan.startFocus, {
      x: (event.clientX - pan.startX) / box.width,
      y: (event.clientY - pan.startY) / box.height
    }));
  }

  function endPreviewPan(event: { currentTarget: HTMLElement; pointerId: number; clientX: number; clientY: number }) {
    const pan = previewPan.current;
    if (!pan || event.pointerId !== pan.pointerId) return;
    previewPan.current = null;
    setPreviewPanning(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const box = event.currentTarget.getBoundingClientRect();
    const next = pan.moved
      ? panFocus(pan.startFocus, {
          x: box.width <= 0 ? 0 : (event.clientX - pan.startX) / box.width,
          y: box.height <= 0 ? 0 : (event.clientY - pan.startY) / box.height
        })
      : pan.wasPlaying
        ? pan.startFocus
        : focusFromPoint({ x: event.clientX - box.left, y: event.clientY - box.top }, box);
    setCropFocus(next);
    if (pan.moved || !pan.wasPlaying) {
      void saveScenePatch(pan.sceneId, { focal_x: next.x, focal_y: next.y });
    }
  }

  function seekLivePreview(sceneId: string, elapsedMs = 0, playing = livePlaying) {
    setActiveSceneId(sceneId);
    setPlaySceneId(sceneId);
    armSceneClock(elapsedMs, playing);
    setPlayTick(performance.now());
    setBedSeek((current) => current + 1);
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
    if ((step !== "editor" && step !== "review") || !allScenesHavePreview || userPausedPreview.current) return;
    if (livePlaying) return;
    armSceneClock(0, true);
    setLivePlaying(true);
    setPlayTick(performance.now());
  }, [step, project?.id, allScenesHavePreview]);
  useEffect(() => {
    if (!livePlaying || (step !== "editor" && step !== "review") || !project?.scenes.length) return;
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
    if (step !== "editor" && step !== "review") return;
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
  useEffect(() => {
    const audio = bedAudio.current;
    if (!audio) return;
    audio.volume = soundtrack ? soundtrack.level * (voiceover ? VOICEOVER_DUCK : 1) : 0;
    audio.loop = true;
    if (!livePlaying || !soundtrackUrl) {
      audio.pause();
      return;
    }
    const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
    if (duration) audio.currentTime = ((playhead.offsetMs + (soundtrack?.offset_ms ?? 0)) / 1000) % duration;
    void audio.play().catch(() => undefined);
  }, [livePlaying, soundtrackUrl, soundtrack?.kind, soundtrack?.level, soundtrack?.offset_ms, voiceover, bedSeek]);
  useEffect(() => {
    const audio = voiceAudio.current;
    if (!audio) return;
    audio.volume = voiceover ? voiceover.level : 0;
    audio.loop = false;
    if (!livePlaying || !voiceoverUrl) {
      audio.pause();
      return;
    }
    const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
    const at = (playhead.offsetMs + (voiceover?.offset_ms ?? 0)) / 1000;
    if (!duration || at >= duration) {
      audio.pause();
      return;
    }
    audio.currentTime = at;
    void audio.play().catch(() => undefined);
  }, [livePlaying, voiceoverUrl, voiceover?.level, voiceover?.offset_ms, bedSeek]);
  useEffect(() => {
    if (!recording) return;
    const started = Date.now();
    const timer = window.setInterval(() => {
      if (Date.now() - started >= 60_000) stopVoiceRecord();
    }, 250);
    return () => window.clearInterval(timer);
  }, [recording]);
  useEffect(() => {
    if (livePlaying) stopMusicPreview();
  }, [livePlaying]);
  const inApp = authReady && Boolean(token) && step !== "sign-in";
  const stockVideo = Boolean(pexelsCredential?.connected || pixabayCredential?.connected);
  const stockStill = stockVideo;
  const partnerBrands = showsPartnerBrands(token ?? "", String(import.meta.env.VITE_PARTNER_BRAND_EMAIL ?? ""));
  const createFlow = step === "brief" || step === "architecture" || step === "concepts" || step === "media" || step === "assemble" || step === "review" || step === "editor" || step === "render";
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

  const sourceModules = (
    <div className="source-modules" role="radiogroup" aria-label="Visual source">
      {sourceChoices.map(([id, title]) =>
        <button
          key={id}
          type="button"
          className="source-module"
          data-source={id}
          aria-pressed={architecture.media === id}
          onClick={() => setArchitecture({ ...architecture, media: id })}
        >
          <strong>{title}</strong>
        </button>)}
    </div>
  );

  return <div className={`app-shell${inApp ? " app-shell-signed" : ""}${(step === "editor" || step === "review") ? " app-shell-editor" : ""}`}>
    {inApp && <nav className="app-rail" aria-label="Primary">
      <a className="rail-brand" href="/">F-Motion</a>
      {appNav}
    </nav>}
    <div className="app-stage">
    {inApp && <input ref={gather} className="clip-start" hidden type="file" multiple accept="video/mp4,image/jpeg,image/png,image/webp" aria-label="Create from my clips" onChange={onGatherFiles} />}
    {((step === "editor" || step === "review") || !inApp || partnerBrands || !online) && <header>
      <div className="header-identity">
        {(step === "editor" || step === "review") && project ? <>
          <strong className="project-title">{projectTitle}</strong>
          <span className="save-pill" data-busy={saveBusy || undefined}>{saveLabel}</span>
        </> : inApp ? null : <strong>F-Motion</strong>}
      </div>
      <div className="header-actions">
        {partnerBrands && (
          <span className="partner-brands" aria-label="Your source brands">
            <button type="button" className={`brand-mark pexels${pexelsCredential?.connected ? " is-on" : ""}`} onClick={() => setStep("settings")}>Pexels</button>
            <button type="button" className={`brand-mark fal${falCredential?.connected && !falUnavailable ? " is-on" : ""}`} onClick={() => setStep("settings")}>FAL</button>
            <a className="brand-mark fotium is-on" href="https://fotium.vip" target="_blank" rel="noreferrer">Fotium</a>
          </span>
        )}
        {authReady && token && step !== "sign-in" && !inApp && <button className="secondary" onClick={() => setStep("settings")}>Settings</button>}
        <span role="status">{online ? "" : "Reconnecting — draft kept locally"}</span>
      </div>
    </header>}
    {!authReady && <section><p role="status">Checking session…</p></section>}
    {authReady && step === "sign-in" && <section>
      <h1>{import.meta.env.VITE_SELFHOST_AUTH === "1"
        ? selfhostGate === "setup" ? "Create your studio" : "Open your studio"
        : "Make a vertical preview"}</h1>
      <p>{pendingImportId
        ? "Sign in to open the imported draft from Fotium."
        : import.meta.env.VITE_SELFHOST_AUTH === "1"
          ? selfhostGate === "setup"
            ? "Step 1 of 2 — create the single owner for this install. No one else can join later."
            : selfhostGate === "checking"
              ? "Checking this install…"
              : "Sign in with the owner email and password you created on first open."
          : "Write a brief, pick a story, add your clips. Sign in to keep projects private. Nothing publishes itself."}</p>
      {import.meta.env.VITE_SELFHOST_AUTH === "1" ? (
        selfhostGate === "checking" ? null : selfhostGate === "setup" ? <>
          <label>Name<input type="text" autoComplete="name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label>
          <label>Email<input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <label>Password<input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          <label>Confirm password<input type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label>
          <button disabled={authBusy || !authSetup.gateway?.setupAccount || !email.trim() || password.length < 8} onClick={() => void setupOwner()}>Create owner and continue</button>
        </> : <>
          <label>Email<input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <label>Password<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          <button disabled={authBusy || !authSetup.gateway?.signInWithPassword || !email.trim() || password.length < 8} onClick={() => void passwordSignIn()}>Open studio</button>
        </>
      ) : <>
        <label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <button disabled={authBusy || !authSetup.gateway || (Boolean(import.meta.env.VITE_SUPABASE_URL) && !email.trim())} onClick={() => void magicLink()}>Email me a magic link</button>
        {Boolean(import.meta.env.VITE_SUPABASE_URL) && <p>{awaitingEmail
          ? "Email sent. Open the link to finish sign-in on this studio."
          : "Open the email link to finish sign-in."}</p>}
        {import.meta.env.VITE_ENABLE_GOOGLE_AUTH === "1"
          ? <button className="secondary" disabled={authBusy || !authSetup.gateway} onClick={() => void googleSignIn()}>Continue with Google</button>
          : null}
      </>}
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
        <button className="provider-preview-item" data-locked={!pixabayCredential?.connected} onClick={() => pixabayCredential?.connected ? setStep("settings") : showStockLock()}>
          <strong>Pixabay</strong><span>Stock video and stills · {pixabayCredential?.connected ? "unlocked" : "locked"}</span>
        </button>
        <button className="provider-preview-item" data-locked={!falCredential?.connected || falUnavailable} onClick={showFalLock}>
          <strong>FAL</strong><span>{falCredential?.connected && !falUnavailable ? "AI stills in storyboard" : "AI stills · locked"}</span>
        </button>
        {partnerBrands ? (
          <button className="provider-preview-item" type="button" onClick={() => setStep("settings")}>
            <strong>Fotium</strong><span>Galleries · unlocked</span>
          </button>
        ) : (
          <button className="provider-preview-item" data-locked onClick={showFutureLock}>
            <strong>More</strong><span>New providers · locked</span>
          </button>
        )}
        <button className="secondary" onClick={() => setStep("settings")}>Choose video sources</button>
      </aside>
      <button onClick={startCreate}>Create new video</button>
      <button className="secondary" onClick={startFromClips}>Create from my clips</button>
      {draftsLoading && <p role="status">Loading drafts…</p>}
      {!draftsLoading && drafts.length === 0 && <div className="empty-drafts">
        <p role="status">No drafts yet.</p>
        <p>Describe what you want to make — F-Motion will recommend a video plan and storyboard.</p>
        <button onClick={startCreate}>Create new video</button>
        <button className="secondary" onClick={startFromClips}>Create from my clips</button>
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
      <button disabled={!draft.trim() || busy} onClick={() => void continueToArchitecture()}>
        {busy ? "Writing the video plan…" : "Continue to video plan"}
      </button>
      <button className="secondary" onClick={startFromClips}>Create from my clips</button>
      <p role="status" aria-live="polite">{status}</p>
      <button className="secondary" disabled={busy} onClick={() => setStep("drafts")}>Back to drafts</button>
    </section>}
    {authReady && step === "architecture" && <section>
      <div className="stage-hero">
        <p className="settings-kicker">Plan</p>
        <h1>Plan the video</h1>
        <p>{conversationPlanKind === "fal"
          ? "F-Motion prepared this recommendation from your conversation. Build it as proposed, or unfold the details to edit any decision."
          : "This is a rule-based plan from your description. Connect FAL in Settings for smarter copy, or unfold the details to edit any decision."}</p>
      </div>
      <dl className="architecture-summary" aria-label="Recommended video plan">
        <div><dt>Goal</dt><dd>{architectureLabels.goal[architecture.goal]}</dd></div>
        <div><dt>Audience</dt><dd>{architectureLabels.audience[architecture.audience]}</dd></div>
        <div><dt>Story</dt><dd>{architectureLabels.structure[architecture.structure]}</dd></div>
        <div><dt>Style</dt><dd>{architectureLabels.tone[architecture.tone]} · {architectureLabels.pace[architecture.pace]}</dd></div>
        <div><dt>Length</dt><dd>About {architecture.durationSeconds} seconds</dd></div>
        <div><dt>Visuals</dt><dd>{architectureLabels.media[architecture.media]}</dd></div>
      </dl>
      {sourceModules}
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
    {authReady && step === "concepts" && project && <section className="concepts-stage">
      <div className="stage-hero">
        <p className="settings-kicker">Story</p>
        <h1>Choose a story approach</h1>
        <p>{architecture.media === "own"
          ? "Pick a story shape, then attach your media to each scene."
          : "Captions, licensed clips, and a music bed are assembled after you choose."}</p>
      </div>
      {sourceModules}
      <div className="concept-choices" aria-label="Story concepts">{conceptChoices.map((concept) => {
        const beats = beatSteps(concept.beat_summary, concept.scene_count);
        return (
        <button
          key={concept.id}
          className="concept-module"
          data-concept={concept.id}
          disabled={busy}
          aria-label={`Choose ${concept.title} concept. ${concept.hook}`}
          title={conceptDirection(concept.media_direction, architecture.media)}
          onClick={() => void chooseConcept(concept.id)}
        >
          <span className="concept-module-head">
            <strong>{concept.title}</strong>
            <span className="concept-meta">About {concept.duration_seconds} seconds · {concept.scene_count} scenes</span>
          </span>
          <p className="concept-hook">{concept.hook}</p>
          <p className="concept-treatment">{concept.treatment}</p>
          <ol className="beat-rail" aria-label={`${concept.title} beats: ${beats.join(", ")}`}>
            {beats.map((beat, index) => <li key={`${beat}-${index}`}>{beat}</li>)}
          </ol>
        </button>
        );
      })}</div>
      <p role="status" aria-live="polite">{status}</p>
      <button className="secondary" disabled={busy} onClick={() => setStep("architecture")}>Back to video plan</button>
    </section>}
    {authReady && step === "assemble" && <section className="assemble-stage">
      <div className="stage-hero">
        <p className="settings-kicker">Assembling</p>
        <h1>Building your draft</h1>
        <p>Captions, licensed clips, and music. This can take a minute.</p>
      </div>
      <progress max={Math.max(assembleTotal, 1)} value={Math.min(assembleDone, assembleTotal)} aria-label="Draft assembly progress" />
      <p role="status" aria-live="polite">{status || "Starting…"}</p>
      <ol ref={assembleLogEl} className="assemble-log" aria-label="Assembly log">
        {assembleLog.map((line, index) => <li key={`${index}-${line.slice(0, 24)}`}>{line}</li>)}
      </ol>
      {!busy && status.includes("could not be created") ? (
        <button className="secondary" onClick={() => setStep("concepts")}>Back to story approaches</button>
      ) : null}
    </section>}
    {authReady && step === "media" && project && <section>
      <h1>Upload your media</h1>
      <p>Choose one JPEG, PNG, or MP4 you have permission to use. It is inspected before it can be rendered.</p>
      <input ref={upload} className="scene-upload" hidden type="file" accept="video/mp4,image/jpeg,image/png,image/webp" onChange={(event) => {
        const file = event.target.files?.[0];
        if (file && activeScene) void admitFile(file, activeScene.id);
      }} />
      <button disabled={busy} onClick={() => upload.current?.click()}>Choose a file</button>
      <p role="status" aria-live="polite">{status}</p>
      <button className="secondary" disabled={busy} onClick={() => setStep("editor")}>Back to storyboard</button>
    </section>}
    {authReady && (step === "editor" || step === "review") && project && activeScene && <section className="editor" data-mode={step === "review" ? "review" : "edit"}>
      <div className="editor-toolbar">
        <div>
          <h1>{step === "review" ? "Your draft" : "Storyboard"}</h1>
          <p>{step === "review"
            ? (busy ? "Assembling captions, clips, and music…" : "Play the cut. Export if it works, or edit before export.")
            : (playhead.totalMs
              ? `Live cut · ${formatPlayTime(playhead.offsetMs)} / ${formatPlayTime(playhead.totalMs)}`
              : "Review each beat and replace a still only when another visual fits better.")}</p>
          <p className="export-gaps" data-ready={!readyGaps.length || undefined} aria-label="Ready to export">
            {readyGaps.length ? readyGaps.map((gap) => <span key={gap}>{gap}</span>) : <span>Ready to export</span>}
          </p>
          {step === "review" ? <p role="status" aria-live="polite">{status}</p> : null}
        </div>
        <div className="editor-toolbar-actions">
          <button className="secondary" disabled={!allScenesHaveMedia} onClick={() => void requestRender("final")}>Export final</button>
          {step === "review" ? (
            <>
              {falCredential?.connected && !falUnavailable ? (
                <button className="secondary" disabled={busy} onClick={() => openFalSpeech()}>Generate voice-over</button>
              ) : null}
              <button className="secondary" disabled={busy} onClick={() => setStep("editor")}>Edit storyboard</button>
            </>
          ) : null}
          {missingMediaCount > 0 && (pexelsCredential?.connected || pixabayCredential?.connected) ? (
            <button className="secondary" disabled={busy} onClick={() => void fillRemainingScenes()}>Fill remaining scenes</button>
          ) : null}
        </div>
      </div>

      <div className="studio-board">
      <nav className="scene-strip" aria-label="Storyboard scenes">{project.scenes.map((scene) => {
        const media = scene.media_id ? sceneMedia[scene.media_id] : undefined;
        const previewUrl = scenePreviewUrl(media);
        const videoPreparing = falVideoJob?.scene_id === scene.id && falGenerationActive(falVideoJob.state);
        const imagePreparing = falGenJob?.scene_id === scene.id && falGenerationActive(falGenJob.state);
        const preparing = videoPreparing || imagePreparing;
        const reviewReady = (!preparing && falVideoJob?.scene_id === scene.id && falGenerationReviewable(falVideoJob))
          || (!preparing && falGenJob?.scene_id === scene.id && falGenerationReviewable(falGenJob));
        return <button
          key={scene.id}
          className={`scene-card${scene.id === playSceneId ? " is-playing" : ""}${preparing ? " is-preparing" : ""}${reviewReady ? " is-ready-review" : ""}`}
          aria-pressed={scene.id === activeScene.id}
          aria-current={scene.id === playSceneId ? "true" : undefined}
          aria-label={preparing
            ? `Scene ${scene.order + 1} · ${videoPreparing ? "animating" : "generating"}`
            : reviewReady
              ? `Scene ${scene.order + 1} · ready to review`
              : `Edit scene ${scene.order + 1}`}
          onClick={() => {
            searchAbort.current?.abort();
            searchTransition.current += 1;
            setCandidates([]);
            seekLivePreview(scene.id, 0);
          }}
        >
          {previewUrl
            ? (media?.detected?.type === "video/mp4"
              ? <video src={previewUrl} muted playsInline preload="metadata" style={{ objectPosition: `${clampFocus(scene.focal_x) * 100}% ${clampFocus(scene.focal_y) * 100}%` }} />
              : <img src={previewUrl} alt="" style={{ objectPosition: `${clampFocus(scene.focal_x) * 100}% ${clampFocus(scene.focal_y) * 100}%` }} />)
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
          {preparing ? (
            <span className="scene-progress scene-preparing">{videoPreparing ? "Animating…" : "Generating…"}</span>
          ) : reviewReady ? (
            <span className="scene-progress">Ready — review</span>
          ) : sceneProgress[scene.id] && !previewUrl ? (
            <span className="scene-progress">
              {sceneProgress[scene.id] === "finding" ? "finding"
                : sceneProgress[scene.id] === "inspecting" ? "inspecting"
                  : sceneProgress[scene.id] === "ready" ? "ready"
                    : "needs media"}
            </span>
          ) : null}
        </button>;
      })}
          <div className="scene-strip-actions">
            <button className="secondary" disabled={activeScene.order === 0} aria-label={`Move scene ${activeSceneNumber} earlier`} onClick={() => void moveScene(activeScene.id, activeScene.order - 1)}>Up</button>
            <button className="secondary" disabled={activeScene.order === project.scenes.length - 1} aria-label={`Move scene ${activeSceneNumber} later`} onClick={() => void moveScene(activeScene.id, activeScene.order + 1)}>Down</button>
            <button className="secondary" disabled={project.scenes.length >= 8} onClick={() => void addScene()}>Add scene</button>
            <button className="secondary" disabled={project.scenes.length <= 1} aria-label={`Remove scene ${activeSceneNumber}`} onClick={() => void removeScene(activeScene.id)}>Remove</button>
          </div>
      </nav>

      <div className="editor-grid" key={`${activeScene.id}:${project.revision}`}>
        <div className="preview-panel">
          <div
            className={`preview${livePlaying ? " is-live" : ""}${previewPanning ? " is-panning" : ""}${previewUrl ? " is-frameable" : ""}${activePreparing && !livePlaying ? " is-preparing" : ""}`}
            aria-label={livePlaying
              ? `Live preview · scene ${(previewScene?.order ?? 0) + 1}`
              : `Live preview for scene ${activeSceneNumber}`}
            onPointerDown={beginPreviewPan}
            onPointerMove={movePreviewPan}
            onPointerUp={endPreviewPan}
            onPointerCancel={endPreviewPan}
          >
        {previewUrl && (previewMedia?.detected?.type === "video/mp4"
          ? <video key={previewScene?.id} src={previewUrl} muted playsInline autoPlay={livePlaying} loop={!livePlaying} controls={false} preload="metadata" draggable={false} className={previewMotionClass} style={previewPosition} onLoadedMetadata={(event) => notePreviewPixels(previewUrl, event.currentTarget.videoWidth, event.currentTarget.videoHeight)} />
          : <img key={previewScene?.id} src={previewUrl} alt={previewMedia?.attribution ? `Selected stock video by ${previewMedia.attribution.creator}` : "Selected gallery media"} draggable={false} className={previewMotionClass} style={previewPosition} onLoad={(event) => notePreviewPixels(previewUrl, event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)} />)}
        {previewMedia && !previewUrl && <span className="media-placeholder">{previewMedia.state === "ready" ? "Preview unavailable" : "Media processing…"}</span>}
            {!previewMedia && <span className="media-placeholder">Choose stock or upload media</span>}
            {activePreparing && !livePlaying ? (
              <span className="preview-preparing" aria-live="polite">
                {activeVideoPreparing ? "Animating this still…" : "Generating a still…"}
              </span>
            ) : null}
            <span className="preview-grade" aria-hidden="true" />
            {(overlayHeadline || overlayLine) ? (
              <div className={`caption-burn look-${overlayLook} overlay-${overlayPlace}${overlayGhost ? " is-ghost" : ""}`}>
                {overlayHeadline ? <strong className="overlay-title">{overlayHeadline}</strong> : null}
                {overlayLine ? <span className="overlay-caption">{overlayLine}</span> : null}
              </div>
            ) : null}
            {!livePlaying && <span
              className="crop-guide"
              style={{ left: `${cropFocus.x * 100}%`, top: `${cropFocus.y * 100}%` }}
              aria-hidden="true"
            />}
          </div>
          <div className="play-transport">
            <div className="play-transport-row">
              <button className="secondary" type="button" disabled={!project.scenes.length} onClick={() => restartLivePreview()}>Restart</button>
              <button className="secondary" type="button" aria-label="Previous scene" disabled={!project.scenes.length} onClick={() => stepLivePreview(-1)}>Prev</button>
              <button type="button" disabled={!allScenesHavePreview} onClick={() => livePlaying ? pauseLivePreview() : playLivePreview()}>{livePlaying ? "Pause preview" : "Play preview"}</button>
              <button className="secondary" type="button" aria-label="Next scene" disabled={!project.scenes.length} onClick={() => stepLivePreview(1)}>Next</button>
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
            {soundtrack ? (
            <div className="music-lane" aria-label="Music bed">
              {beatMarks.map((mark, index) =>
                <span key={index} className="music-beat" style={{ left: `${mark * 100}%` }} />)}
              <span className="music-lane-fill" style={{ width: playhead.totalMs ? `${(playhead.offsetMs / playhead.totalMs) * 100}%` : "0%" }} />
            </div>
            ) : null}
            {soundtrackUrl && <audio ref={bedAudio} src={soundtrackUrl} preload="auto" hidden />}
            {voiceoverUrl && <audio ref={voiceAudio} src={voiceoverUrl} preload="auto" hidden />}
          </div>
          <details
            className={`music-dock voice-dock${voiceover ? " has-bed" : ""}`}
            open={voiceOpen}
            onToggle={(event) => setVoiceOpen(event.currentTarget.open)}
          >
            <summary>{recording ? "Recording voice-over" : voiceover ? "Voice-over" : "Add voice-over"}</summary>
            <p className="crop-hint">Record, upload, or generate with FAL. Captions time as spoken subtitles on Play and Export. Music ducks under the voice.</p>
            <label htmlFor="voice-script">What you'll say
              <textarea id="voice-script" maxLength={1800} value={voiceScript} disabled={busy || recording} onChange={(event) => setVoiceScript(event.target.value)} />
            </label>
            <div className="scene-actions">
              <button
                type="button"
                className={recording ? undefined : "secondary"}
                disabled={busy}
                aria-pressed={recording}
                onClick={() => recording ? stopVoiceRecord() : void startVoiceRecord()}
              >{recording ? "Stop recording" : "Record voice-over"}</button>
              {recording ? <button className="secondary" type="button" onClick={() => cancelVoiceRecord()}>Discard</button> : null}
              <button className="secondary" type="button" disabled={busy || recording} onClick={() => voiceUpload.current?.click()}>Upload voice-over</button>
              <button className="secondary" type="button" disabled={busy || recording} onClick={() => openFalSpeech()}>Generate with FAL</button>
              <button className="secondary" type="button" disabled={busy || recording || !voiceScript.trim()} onClick={() => void applyVoiceCaptions()}>Use as captions</button>
            </div>
            <input ref={voiceUpload} hidden type="file" accept="audio/mpeg,audio/wav,audio/mp4,audio/x-m4a,.mp3,.wav,.m4a" onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void admitAudioFile(file, "voiceover");
            }} />
            {voiceover ? (
              <>
                <label htmlFor="voice-level">Level · {Math.round(voiceover.level * 100)}%
                  <input id="voice-level" type="range" min="0" max="1" step="0.05" defaultValue={voiceover.level}
                    onBlur={(event) => {
                      void saveVoiceover({ ...voiceover, level: event.currentTarget.valueAsNumber });
                    }} />
                </label>
                <button className="secondary" type="button" disabled={busy} onClick={() => void saveVoiceover(null)}>Remove voice-over</button>
              </>
            ) : null}
          </details>
          <details
            className={`music-dock${soundtrack ? " has-bed" : ""}`}
            open={musicOpen}
            onToggle={(event) => {
              const next = event.currentTarget.open;
              setMusicOpen(next);
              if (!next) stopMusicPreview();
              else if (!musicHits.length) void searchLicensedMusic(musicQuery);
            }}
          >
            <summary>{musicLabel}</summary>
            <form
              className="music-search"
              onSubmit={(event) => {
                event.preventDefault();
                void searchLicensedMusic(musicQuery);
              }}
            >
              <input
                aria-label="Search licensed music"
                placeholder="Search music"
                value={musicQuery}
                onChange={(event) => setMusicQuery(event.target.value)}
              />
              <button className="secondary" type="submit">Search</button>
              <button className="secondary" type="button" disabled={busy} onClick={() => audioUpload.current?.click()}>Upload music</button>
            </form>
            <input ref={audioUpload} hidden type="file" accept="audio/mpeg,audio/wav,audio/mp4,audio/x-m4a,.mp3,.wav,.m4a" onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void admitAudioFile(file);
            }} />
            <div className="music-moods" role="group" aria-label="Licensed music catalog">
              {musicMoods.map(([label, query]) =>
                <button
                  key={query}
                  type="button"
                  className={musicQuery === query ? undefined : "secondary"}
                  aria-pressed={musicQuery === query}
                  onClick={() => void searchLicensedMusic(query)}
                >{label}</button>)}
            </div>
            {musicHits.length ? (
              <ul className="music-results">
                {musicHits.map((hit) => (
                  <li key={hit.id} className="music-hit">
                    <span>{hit.title} · {hit.artist} · {hit.duration}</span>
                    <button
                      type="button"
                      className="secondary"
                      aria-pressed={previewingId === hit.id}
                      aria-label={`${previewingId === hit.id ? "Stop" : "Play"} ${hit.title}`}
                      onClick={() => toggleMusicPreview(hit)}
                    >{previewingId === hit.id ? "Stop" : "Play"}</button>
                    <button type="button" disabled={busy} onClick={() => void useMixkitTrack(hit)}>Use</button>
                  </li>
                ))}
              </ul>
            ) : null}
            <audio ref={previewAudio} preload="none" hidden onEnded={() => setPreviewingId(undefined)} />
            <details className="music-classic">
              <summary>Classic beds</summary>
              <div className="music-beds" role="group" aria-label="Classic Kevin MacLeod beds">
                {stockBeds.map((bed) =>
                  <button
                    key={bed.id}
                    type="button"
                    className={soundtrack?.kind === "stock" && soundtrack.stock_id === bed.id ? undefined : "secondary"}
                    aria-pressed={soundtrack?.kind === "stock" && soundtrack.stock_id === bed.id}
                    disabled={busy}
                    title={`${bed.label} · ${bed.hint}`}
                    onClick={() => {
                      void saveSoundtrack({
                        kind: "stock",
                        stock_id: bed.id,
                        bpm: clampBpm(soundtrack?.bpm ?? bed.bpm),
                        offset_ms: 0,
                        level: soundtrack?.level ?? 0.8
                      });
                      setMusicOpen(false);
                    }}
                  >{bed.label}</button>)}
              </div>
              <p className="crop-hint">Music by <a href="https://incompetech.com" target="_blank" rel="noreferrer">Kevin MacLeod</a>
                {" · "}<a href="https://creativecommons.org/licenses/by/3.0/" target="_blank" rel="noreferrer">CC BY 3.0</a></p>
            </details>
            {soundtrack ? (
              <>
                <p className="crop-hint">{soundtrackHint}</p>
                <div className="inspector-pair">
                  <label htmlFor="music-bpm">BPM
                    <input id="music-bpm" type="number" min="60" max="200" step="1" defaultValue={clampBpm(soundtrack.bpm)}
                      onBlur={(event) => {
                        const bpm = clampBpm(event.currentTarget.valueAsNumber);
                        event.currentTarget.value = String(bpm);
                        void saveSoundtrack({ ...soundtrack, bpm });
                      }} />
                  </label>
                  <label htmlFor="music-level">Level · {Math.round(soundtrack.level * 100)}%
                    <input id="music-level" type="range" min="0" max="1" step="0.05" defaultValue={soundtrack.level}
                      onBlur={(event) => {
                        void saveSoundtrack({ ...soundtrack, level: event.currentTarget.valueAsNumber });
                      }} />
                  </label>
                </div>
                <div className="scene-actions">
                  <button className="secondary" type="button" disabled={busy || !project.scenes.length} onClick={() => void snapScenesToBeat()}>Snap scenes to beat</button>
                  <button className="secondary" type="button" disabled={busy} onClick={() => void saveSoundtrack(null)}>Remove bed</button>
                </div>
              </>
            ) : null}
          </details>
          <p className="crop-hint">{livePlaying
            ? "Space plays or pauses · click the bar to scrub."
            : wideStill
            ? "Wide still — drag to keep the subject in the 9:16 frame."
            : "Drag the still to frame it."}</p>
          {activeMedia?.attribution && <p>
            Video by <a href={activeMedia.attribution.attributionUrl} target="_blank" rel="noreferrer">{activeMedia.attribution.creator}</a>
            {" · "}<a href={activeMedia.attribution.source === "Pixabay" ? "https://pixabay.com" : "https://www.pexels.com"} target="_blank" rel="noreferrer">{activeMedia.attribution.source === "Pixabay" ? "Pixabay" : "Pexels"}</a>
          </p>}
          {activeMedia?.generation?.source === "FAL" && <p>AI-generated with FAL{activeMedia.generation.derivedFromImage ? " · from your still" : ""} · {activeMedia.generation.model}</p>}
        </div>

        <div className="scene-controls">
          <h2>Scene {activeSceneNumber}</h2>
          <div className="inspector-block">
          <p className="crop-hint">Text on the clip</p>
          <div className="overlay-looks" role="group" aria-label="Overlay look">
            {overlayLooks.map(([label, look, place]) =>
              <button
                key={look}
                type="button"
                className={`overlay-look-tile look-${look}${(activeScene.overlay_look ?? "caption") === look ? " is-on" : ""}`}
                aria-pressed={(activeScene.overlay_look ?? "caption") === look}
                aria-label={label}
                onClick={() => void saveScenePatch(activeScene.id, { overlay_look: look, overlay_place: place })}
              >
                {look === "title" ? <strong>Title</strong> : null}
                {look === "poster" ? <><strong>Title</strong><span>Lower third</span></> : null}
                {look === "caption" ? <span>Caption</span> : null}
              </button>)}
          </div>
          <label htmlFor={`caption-${activeScene.id}`}>Caption
            <input id={`caption-${activeScene.id}`} aria-label={`Scene ${activeSceneNumber} caption`} maxLength={180} value={overlayCaption} onChange={(event) => setOverlayCaption(event.target.value)} onBlur={(event) => void saveScenePatch(activeScene.id, { caption: event.currentTarget.value })} />
          </label>
          <p className="crop-hint">Play and Export time this caption as spoken subtitles.</p>
          <div className="overlay-places" role="group" aria-label="Overlay place">
            {([["Top", "top"], ["Middle", "center"], ["Bottom", "bottom"]] as const).map(([label, place]) =>
              <button
                key={place}
                type="button"
                className={overlayPlace === place ? undefined : "secondary"}
                aria-pressed={overlayPlace === place}
                onClick={() => void saveScenePatch(activeScene.id, { overlay_place: place })}
              >{label}</button>)}
          </div>
          </div>
          <div className="inspector-block">
          {!activeMedia && (
          <label htmlFor={`prompt-${activeScene.id}`}>Search
            <textarea id={`prompt-${activeScene.id}`} maxLength={100} defaultValue={activeScene.visual_prompt ?? ""} onBlur={(event) => void saveScenePatch(activeScene.id, { visual_prompt: event.currentTarget.value.trim() })} />
          </label>
          )}
          <div className="inspector-pair">
          <label htmlFor={`duration-${activeScene.id}`}>Seconds
            <input id={`duration-${activeScene.id}`} type="number" min="0.5" max="15" step="0.1" defaultValue={activeScene.duration_ms / 1000} onBlur={(event) => void saveScenePatch(activeScene.id, { duration_ms: Math.round(event.currentTarget.valueAsNumber * 1000) })} />
          </label>
          <label htmlFor={`motion-${activeScene.id}`}>{wideStill ? "Pan" : "Motion"}
            <select id={`motion-${activeScene.id}`} aria-label={`Scene ${activeSceneNumber} motion`} value={activeScene.motion} onChange={(event) => void saveScenePatch(activeScene.id, { motion: event.target.value as Scene["motion"] })}>
              <option value="none">None</option><option value="push">{wideStill ? "Pan sideways" : "Push"}</option><option value="zoom">Zoom</option>
            </select>
          </label>
          </div>
          </div>
          <div className="inspector-block">
          <label htmlFor={`audio-${activeScene.id}`}>Clip audio · {Math.round(activeScene.audio_level * 100)}%
            <input id={`audio-${activeScene.id}`} type="range" min="0" max="1" step="0.05" defaultValue={activeScene.audio_level} onBlur={(event) => void saveScenePatch(activeScene.id, { audio_level: event.currentTarget.valueAsNumber })} />
          </label>
          <button className="secondary" onClick={() => void saveScenePatch(activeScene.id, { audio_level: activeScene.audio_level === 0 ? 1 : 0 })}>{activeScene.audio_level === 0 ? `Unmute scene ${activeSceneNumber}` : `Mute scene ${activeSceneNumber}`}</button>
          </div>
          <div className="inspector-block">
          <button className={!stockVideo ? "locked-feature" : undefined}
            disabled={busy || (stockVideo && !activeScene.visual_prompt)}
            aria-label={activeMedia
              ? `Find another licensed video for scene ${activeSceneNumber}`
              : `Find licensed media for scene ${activeSceneNumber}`}
            onClick={() => stockVideo ? void searchStock(activeScene.id, "video") : showStockLock()}>
            {!stockVideo ? "🔒 " : ""}{activeMedia ? "Find another licensed video" : "Find licensed media"}
          </button>
          <button className={!stockStill ? "locked-feature" : undefined}
            disabled={busy || (stockStill && !activeScene.visual_prompt)}
            aria-label={`Find licensed still for scene ${activeSceneNumber}`}
            onClick={() => stockStill ? void searchStock(activeScene.id, "still") : showStockLock()}>
            {!stockStill ? "🔒 " : ""}Find licensed still
          </button>
          <button className={!falCredential?.connected || falUnavailable ? "locked-feature" : undefined}
            disabled={busy || falGenBusy}
            aria-label={`Generate AI image for scene ${activeSceneNumber}`}
            onClick={() => openFalGenerate(activeScene)}>
            {!falCredential?.connected || falUnavailable ? "🔒 " : ""}Generate AI image
          </button>
          {activeMedia?.state === "ready" && activeMedia.detected?.type !== "video/mp4" && (
            <button className={!falCredential?.connected || falUnavailable ? "locked-feature" : undefined}
              disabled={busy || falVideoBusy}
              aria-label={`Animate this image for scene ${activeSceneNumber}`}
              onClick={() => openFalAnimate(activeScene)}>
              {!falCredential?.connected || falUnavailable ? "🔒 " : ""}Animate this image
            </button>
          )}
          </div>
          <input ref={upload} className="scene-upload" hidden type="file" accept="video/mp4,image/jpeg,image/png,image/webp" onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void admitFile(file, activeScene.id);
          }} />
          <button className="secondary" disabled={busy} aria-label={`Upload media for scene ${activeSceneNumber}`} onClick={() => upload.current?.click()}>Upload media</button>
          <p role="status">{status || "✓ All changes saved"}</p>
          {!allScenesHavePreview && <p>{project.scenes.every(({ media_id }) => media_id)
            ? "Media is processing. Live preview starts when every scene is ready."
            : "Add media to every scene to play the live preview."}</p>}
          </div>
        </div>
      </div>

      {candidates.length > 0 && <div className="candidates" aria-label={`Licensed media options for scene ${activeSceneNumber}`}>{candidates.map((candidate) => <article key={`${candidate.source}-${candidate.kind}-${candidate.id}`} className="candidate">
        <img src={candidate.previewUrl} alt={`${candidate.source === "pixabay" ? "Pixabay" : "Pexels"} preview by ${candidate.creator}`} />
        <a href={candidate.attributionUrl} target="_blank" rel="noreferrer">{candidate.creator} on {candidate.source === "pixabay" ? "Pixabay" : "Pexels"}</a>
        <button disabled={busy} onClick={() => void selectStock(activeScene.id, candidate)}>Select for scene {activeSceneNumber}</button>
      </article>)}</div>}

      <div className="editor-foot">
      {downloadUrl && <button className="secondary" onClick={() => setStep("render")}>{renderKind === "final" ? "View final export" : "View accurate preview"}{previewRevision !== project.revision ? " · older" : ""}</button>}
      <button className="secondary" onClick={() => setStep("brief")}>Start a different description</button>
      <button className="secondary" onClick={() => setStep("drafts")}>Back to drafts</button>
      </div>
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
          {(!falGenJob || ["failed", "cancelled", "submission_uncertain", "ready"].includes(falGenJob.state)
            || (falGenJob.state === "quoted" && falGenJob.quote.estimated_total === null)) && (
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
          <button className="secondary" disabled={falGenBusy} onClick={() => setFalGenOpen(false)}>
            {falGenJob && falGenerationActive(falGenJob.state) ? "Continue editing" : "Close"}
          </button>
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
          {(!falVideoJob || ["failed", "cancelled", "submission_uncertain", "ready"].includes(falVideoJob.state)
            || (falVideoJob.state === "quoted" && falVideoJob.quote.estimated_total === null)) && (
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
          <button className="secondary" disabled={falVideoBusy} onClick={() => setFalVideoOpen(false)}>
            {falVideoJob && falGenerationActive(falVideoJob.state) ? "Continue editing" : "Close"}
          </button>
        </div>
      </dialog>}
      {falSpeechOpen && project && <dialog open aria-labelledby="fal-speech-title">
        <h2 id="fal-speech-title">Generate voice-over</h2>
        <p>Uses Kokoro American English on FAL. Charged directly to your FAL account. F-Motion copies the result into private storage.</p>
        <label htmlFor="fal-speech-prompt">Voice-over script
          <textarea id="fal-speech-prompt" maxLength={2000} value={falSpeechPrompt} disabled={falSpeechBusy || (falSpeechJob && !["quoted", "failed", "cancelled", "submission_uncertain", "ready"].includes(falSpeechJob.state))} onChange={(event) => setFalSpeechPrompt(event.target.value)} />
        </label>
        {falSpeechJob && <div className="notice">
          <p>Model · Kokoro American English</p>
          <p>{falSpeechJob.quote.currency} {falSpeechJob.quote.unit_price} per {falSpeechJob.quote.unit}
            {falSpeechJob.quote.estimated_total !== null
              ? ` · estimated total ${falSpeechJob.quote.currency} ${falSpeechJob.quote.estimated_total}`
              : ` · ${falSpeechJob.quote.estimated_total_explanation ?? "FAL could not calculate a total"}`}</p>
          <p>Status · {falSpeechJob.state.replaceAll("_", " ")}</p>
        </div>}
        {falSpeechJob?.state === "ready" && falSpeechJob.result_media && (
          <div>
            {falSpeechJob.result_media.previewUrl
              ? <button type="button" onClick={() => {
                const url = falSpeechJob.result_media?.previewUrl;
                if (!url) return;
                const audio = new Audio(url);
                void audio.play();
              }}>Play generated voice-over</button>
              : <p>Generated voice-over is ready for review.</p>}
            <p>AI-generated with FAL</p>
          </div>
        )}
        <div className="dialog-actions">
          {(!falSpeechJob || ["failed", "cancelled", "submission_uncertain", "ready"].includes(falSpeechJob.state)
            || (falSpeechJob.state === "quoted" && falSpeechJob.quote.estimated_total === null)) && (
            <button disabled={falSpeechBusy || !falSpeechPrompt.trim()} onClick={() => void quoteFalSpeech()}>Get FAL price</button>
          )}
          {falSpeechJob?.state === "quoted" && (
            <button disabled={falSpeechBusy || falSpeechJob.quote.estimated_total === null} onClick={() => void confirmFalSpeech()}>Generate voice-over</button>
          )}
          {falSpeechJob && !["ready", "cancelled", "failed", "submission_uncertain", "quoted"].includes(falSpeechJob.state) && (
            <button className="secondary" disabled={falSpeechBusy} onClick={() => void cancelFalSpeech()}>Cancel generation</button>
          )}
          {falSpeechJob?.state === "ready" && falSpeechJob.result_media?.state === "ready" && (
            <>
              <button disabled={falSpeechBusy || busy} onClick={() => void useFalSpeechMedia()}>Use as voice-over</button>
              <button className="secondary" disabled={falSpeechBusy} onClick={() => {
                setFalSpeechJob(undefined);
                setStatus("Current voice-over kept.");
              }}>Keep current audio</button>
              <button className="secondary" disabled={falSpeechBusy} onClick={() => {
                setFalSpeechJob(undefined);
                setStatus("Request a new FAL price to generate another voice-over.");
              }}>Generate another</button>
            </>
          )}
          <button className="secondary" disabled={falSpeechBusy} onClick={() => setFalSpeechOpen(false)}>Close</button>
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
      {downloadUrl && <video ref={exportVideo} controls playsInline preload="metadata" src={downloadUrl} onError={() => void refreshPreviewUrl()}>
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
        {downloadUrl && progress.phase === "complete" && <button className="secondary" type="button" onClick={downloadCover}>Download cover</button>}
      </div>
      <button className="secondary" onClick={() => setStep("editor")}>Keep editing</button>
    </section>}
    {authReady && step === "settings" && <section className="settings-stage">
      <div className="settings-hero">
        <p className="settings-kicker">{onboardSources ? "Optional" : "Workspace"}</p>
        <h1>Sources</h1>
        <p>{onboardSources
          ? "Connect a key only if you want stock or AI stills. Skip this and use your own uploads."
          : "Keys stay on this install. Uploads, editing, and preview work without them."}</p>
      </div>
      <div className="source-list" aria-label="Video sources">
        <article className={`source-panel${pexelsCredential?.connected ? " is-on" : ""}`} aria-labelledby="pexels-settings-title">
          <div className="source-head">
            <div>
              <h2 id="pexels-settings-title">Pexels</h2>
              <p>Licensed stock video and stills. Connect your own Pexels API key. F-Motion does not supply or share a Pexels key.</p>
            </div>
            <span className="source-state">{pexelsCredential?.connected ? "Connected" : "Optional"}</span>
          </div>
          {pexelsUnavailable && <p className="notice">Pexels is not enabled on this install.</p>}
          {!pexelsUnavailable && pexelsCredential?.connected && <p className="source-meta">
            Key ending …{pexelsCredential.hint}
            {pexelsCredential.validated_at ? ` · verified ${new Date(pexelsCredential.validated_at).toLocaleString()}` : ""}
          </p>}
          {!pexelsUnavailable && <>
            <div className="source-connect">
              <label htmlFor="pexels-key">{pexelsCredential?.connected ? "Replace key" : "API key"}
                <input id="pexels-key" type="password" autoComplete="new-password" spellCheck={false}
                  value={pexelsKey} onChange={(event) => setPexelsKey(event.target.value)} placeholder="Paste your Pexels API key" />
              </label>
              <button disabled={pexelsBusy || !pexelsKey.trim()} onClick={() => void connectPexels()}>{pexelsCredential?.connected ? "Replace key" : "Connect Pexels"}</button>
            </div>
            <div className="settings-actions">
              {pexelsCredential?.connected && <button className="secondary" disabled={pexelsBusy} onClick={() => void testPexels()}>Test Pexels</button>}
              {pexelsCredential?.connected && <button className="secondary" disabled={pexelsBusy} onClick={() => void disconnectPexels()}>Disconnect Pexels</button>}
              <a href="https://www.pexels.com/api/" target="_blank" rel="noreferrer">Get a Pexels API key</a>
            </div>
            <p className="source-note">Added clips keep on-product attribution in the editor.</p>
          </>}
        </article>
        <article className={`source-panel${pixabayCredential?.connected ? " is-on" : ""}`} aria-labelledby="pixabay-settings-title">
          <div className="source-head">
            <div>
              <h2 id="pixabay-settings-title">Pixabay</h2>
              <p>Licensed stock video and stills. Connect your own Pixabay API key. F-Motion does not supply or share a Pixabay key.</p>
            </div>
            <span className="source-state">{pixabayCredential?.connected ? "Connected" : "Optional"}</span>
          </div>
          {pixabayUnavailable && <p className="notice">Pixabay is not enabled on this install.</p>}
          {!pixabayUnavailable && pixabayCredential?.connected && <p className="source-meta">
            Key ending …{pixabayCredential.hint}
            {pixabayCredential.validated_at ? ` · verified ${new Date(pixabayCredential.validated_at).toLocaleString()}` : ""}
          </p>}
          {!pixabayUnavailable && <>
            <div className="source-connect">
              <label htmlFor="pixabay-key">{pixabayCredential?.connected ? "Replace key" : "API key"}
                <input id="pixabay-key" type="password" autoComplete="new-password" spellCheck={false}
                  value={pixabayKey} onChange={(event) => setPixabayKey(event.target.value)} placeholder="Paste your Pixabay API key" />
              </label>
              <button disabled={pixabayBusy || !pixabayKey.trim()} onClick={() => void connectPixabay()}>{pixabayCredential?.connected ? "Replace key" : "Connect Pixabay"}</button>
            </div>
            <div className="settings-actions">
              {pixabayCredential?.connected && <button className="secondary" disabled={pixabayBusy} onClick={() => void testPixabay()}>Test Pixabay</button>}
              {pixabayCredential?.connected && <button className="secondary" disabled={pixabayBusy} onClick={() => void disconnectPixabay()}>Disconnect Pixabay</button>}
              <a href="https://pixabay.com/api/docs/" target="_blank" rel="noreferrer">Get a Pixabay API key</a>
            </div>
            <p className="source-note">Added clips keep on-product attribution in the editor.</p>
          </>}
        </article>
        <article className={`source-panel${falCredential?.connected && !falUnavailable ? " is-on" : ""}`} aria-labelledby="fal-settings-title">
          <div className="source-head">
            <div>
              <h2 id="fal-settings-title">FAL</h2>
              <p>Connect your own FAL API-scope key for AI stills, video, voice, and Create-video copy. Each image is quoted, then charged directly to your FAL account. F-Motion does not supply or share a FAL key.</p>
            </div>
            <span className="source-state">{falCredential?.connected && !falUnavailable ? "Connected" : "Optional"}</span>
          </div>
          {falUnavailable && <p className="notice">FAL is not enabled on this install.</p>}
          {!falUnavailable && falCredential?.connected && <p className="source-meta">
            Key ending …{falCredential.hint}
            {falCredential.validated_at ? ` · verified ${new Date(falCredential.validated_at).toLocaleString()}` : ""}
          </p>}
          {!falUnavailable && <>
            <div className="source-connect">
              <label htmlFor="fal-key">{falCredential?.connected ? "Replace key" : "API key"}
                <input id="fal-key" type="password" autoComplete="new-password" spellCheck={false}
                  value={falKey} onChange={(event) => setFalKey(event.target.value)} placeholder="Paste an API-scope key" />
              </label>
              <button disabled={falBusy || !falKey.trim()} onClick={() => void connectFal()}>{falCredential?.connected ? "Replace key" : "Connect FAL"}</button>
            </div>
            <div className="settings-actions">
              {falCredential?.connected && <button className="secondary" disabled={falBusy} onClick={() => void testFal()}>Test connection</button>}
              {falCredential?.connected && <button className="secondary" disabled={falBusy} onClick={() => void disconnectFal()}>Disconnect</button>}
              <a href="https://fal.ai/dashboard/keys" target="_blank" rel="noreferrer">Open FAL API keys</a>
            </div>
          </>}
        </article>
        {partnerBrands && (
          <article className="source-panel is-on">
            <div className="source-head">
              <div>
                <h2>Fotium</h2>
                <p>Your galleries open as drafts on this studio.</p>
              </div>
              <span className="source-state">Connected</span>
            </div>
            <a href="https://fotium.vip" target="_blank" rel="noreferrer">Open Fotium</a>
          </article>
        )}
      </div>
      <p role="status" aria-live="polite">{status}</p>
      <div className="settings-foot">
        <button onClick={() => { setFalKey(""); setPexelsKey(""); setPixabayKey(""); setOnboardSources(false); setStep("drafts"); }}>{onboardSources ? "Continue to drafts" : "Done"}</button>
        <button className="ghost" disabled={authBusy} onClick={() => void signOut()}>Sign out</button>
      </div>
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

function studioPath(pathname: string): boolean {
  return pathname === "/studio" || pathname.startsWith("/studio/")
    || pathname === "/app" || pathname.startsWith("/app/");
}

const pageTitles: Record<string, string> = {
  "/": "F-Motion — Vertical reels from your own media",
  "/self-host": "F-Motion — Self-host",
  "/hosted": "F-Motion — Hosted studio"
};

function documentTitleFor(pathname: string): string {
  if (import.meta.env.VITE_SELFHOST_AUTH === "1" || studioPath(pathname)) return "F-Motion — Studio";
  return pageTitles[pathname] ?? "F-Motion";
}

function leftoverMarketingPath(pathname: string): boolean {
  return pathname === "/self-host" || pathname === "/self-host/" || pathname === "/self-host.html"
    || pathname === "/hosted" || pathname === "/hosted/" || pathname === "/hosted.html";
}

function Root() {
  const selfhost = import.meta.env.VITE_SELFHOST_AUTH === "1";
  const [path, setPath] = useState(() => window.location.pathname);

  useEffect(() => {
    const sync = () => setPath(window.location.pathname);
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  useEffect(() => {
    document.title = documentTitleFor(path);
  }, [path]);

  useEffect(() => {
    if (!selfhost || !leftoverMarketingPath(path)) return;
    const here = new URL(window.location.href);
    history.replaceState(null, "", `/${here.search}${here.hash}`);
    setPath("/");
  }, [path, selfhost]);

  useEffect(() => {
    if (selfhost) return;
    const here = new URL(window.location.href);
    const params = here.searchParams;
    const hash = new URLSearchParams(here.hash.replace(/^#/, ""));
    const id = params.get("project") ?? "";
    const code = params.get("code") ?? "";
    const error = params.get("error_code") ?? params.get("error") ?? hash.get("error_code") ?? hash.get("error") ?? "";
    const fromMarketing = path === "/" && (/^[0-9a-f-]{36}$/i.test(id) || code || error);
    const fromLegacy = path === "/app" || path.startsWith("/app/");
    if (!fromMarketing && !fromLegacy) return;
    const next = new URL("/studio", here.origin);
    if (/^[0-9a-f-]{36}$/i.test(id)) next.searchParams.set("project", id);
    if (code) next.searchParams.set("code", code);
    if (error) next.searchParams.set("error_code", error);
    history.replaceState(null, "", `${next.pathname}${next.search}${here.hash}`);
    setPath("/studio");
  }, [path, selfhost]);

  if (selfhost || studioPath(path)) return <App />;
  return <MarketingApp path={path} />;
}

createRoot(document.getElementById("root")!).render(<StrictMode><Root /></StrictMode>);
