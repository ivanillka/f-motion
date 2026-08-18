import { isSoundtrack, isVoiceover, isStoryboardScenes, type CaptionCue, type CommandEnvelope, type ProjectSnapshot, type Scene } from "@f-engine/contracts";

const MAX_STORYBOARD_SCENES = 8;

export interface Concept {
  id: string;
  title: string;
  treatment: string;
  hook: string;
  beat_summary: string;
  duration_seconds: 15 | 30 | 45;
  scene_count: 4 | 5 | 6;
  media_direction: string;
}

export interface RenderProfile {
  width: number;
  height: number;
  watermark?: string;
}

export interface RenderPlan {
  revision: number;
  width: number;
  height: number;
  watermark?: string;
  scenes: Array<Scene & { caption_cues: CaptionCue[] }>;
}

export interface VideoArchitecture {
  goal: "story" | "explain" | "promote" | "educate";
  audience: "general" | "social" | "customers" | "internal";
  structure: "story_arc" | "mystery" | "problem_solution" | "chronological";
  tone: "cinematic" | "documentary" | "energetic" | "calm";
  pace: "slow" | "balanced" | "fast";
  durationSeconds: 15 | 30 | 45;
  media: "stock" | "own" | "mixed";
}

export interface StoryboardSource {
  caption?: string;
  callToAction?: string;
  visualHint?: string;
}

export const defaultVideoArchitecture: VideoArchitecture = {
  goal: "story",
  audience: "general",
  structure: "story_arc",
  tone: "cinematic",
  pace: "balanced",
  durationSeconds: 15,
  media: "stock"
};

const STORY_ROLES = [
  "wide establishing view",
  "closer environmental detail",
  "key reveal or change",
  "closing wide shot"
] as const;

const ARCHITECTURE_FOOTAGE: Record<VideoArchitecture["structure"], string[]> = {
  story_arc: ["wide aerial establishing", "human detail close up", "people in motion", "dramatic turning point", "hopeful outcome", "memorable wide closing"],
  mystery: ["fog wide aerial establishing", "ancient symbol stone close up", "shadowy figure walking", "old documents map investigation", "dramatic silhouette reveal", "empty street dusk fog"],
  problem_solution: ["real environment wide", "person struggling close up", "difficult process detail", "solution demonstration", "visible improvement", "confident outcome wide"],
  chronological: ["historic location wide", "early activity detail", "people making progress", "major change in action", "finished result detail", "modern location wide"]
};

const FOOTAGE_STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "by", "create", "for", "from", "in", "into", "is", "it", "make",
  "of", "on", "or", "story", "the", "this", "through", "to", "video", "with", "without"
]);

const FOOTAGE_ALIASES = new Map([
  ["cult", "hooded people"], ["cults", "hooded people"], ["culs", "hooded people"],
  ["europe", "european old town"], ["european", "european old town"],
  ["mystery", "mysterious"], ["mysteries", "mysterious"],
  ["sea", "ocean"], ["seas", "ocean"], ["mist", "fog"], ["misty", "fog"], ["foggy", "fog"]
]);

const TONE_FOOTAGE_WORD: Record<VideoArchitecture["tone"], string> = {
  cinematic: "cinematic",
  documentary: "documentary",
  energetic: "dynamic",
  calm: "peaceful"
};

function architectureIndexes(sceneCount: number): number[] {
  if (sceneCount === 4) return [0, 1, 4, 5];
  if (sceneCount === 5) return [0, 1, 2, 4, 5];
  return [0, 1, 2, 3, 4, 5];
}

function footageSubject(brief: string): string {
  const words = brief.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const result: string[] = [];
  const seen = new Set<string>();
  for (const word of words) {
    if (FOOTAGE_STOP_WORDS.has(word)) continue;
    for (const candidate of (FOOTAGE_ALIASES.get(word) ?? word).split(" ")) {
      if (candidate.length < 2 || seen.has(candidate)) continue;
      seen.add(candidate);
      result.push(candidate);
      if (result.length === 6) return result.join(" ");
    }
  }
  return result.join(" ") || "cinematic subject";
}

function footagePrompt(brief: string, cue: string, tone: VideoArchitecture["tone"]): string {
  const words = `${footageSubject(brief)} ${cue} ${TONE_FOOTAGE_WORD[tone]}`.split(" ");
  const unique = words.filter((word, index) => words.indexOf(word) === index);
  const query = unique.join(" ");
  if (query.length <= 100) return query;
  return query.slice(0, 101).replace(/\s+\S*$/u, "").trim();
}

function subjectCaption(brief: string): string {
  const subject = brief.trim().replace(/[.!?]+$/u, "");
  if (!subject) return "";
  return `${subject.charAt(0).toLocaleUpperCase()}${subject.slice(1)}.`.slice(0, 180);
}

function stripOverlayNoise(value: string): string {
  return value.replace(/https?:\/\/\S+/gi, "").replace(/\s+/gu, " ").trim();
}

function splitTitleParts(value: string): string[] {
  return value.split(/\s*[—–|:]\s+/u).map((part) => part.trim()).filter((part) => part.length >= 2);
}

const QUEUE_WRAPPER = /^(?:still\s+worth(?:\s+the)?\s+two\s+minutes|worth(?:\s+the)?\s+two\s+minutes|weekly\s+recap|daily\s+recap|recap|(?:day|week)\s*\d+)\s*[:—–-]\s*/i;
const GENERIC_CTA = /^(open|see|visit|view|watch|revisit)\s+(the\s+)?((full|complete|entire)\s+)?(gallery|piece|post|album)\b/i;

function isGenericCta(value: string): boolean {
  return GENERIC_CTA.test(stripOverlayNoise(value).replace(/[.!?]+$/u, ""));
}

function unwrapHostCopy(value: string, title: string): string {
  let text = stripOverlayNoise(value);
  text = text.replace(QUEUE_WRAPPER, "").trim();
  text = text.replace(/^["“']+/u, "").replace(/["”']+[.,!?]*$/u, "").trim();
  text = text.replace(/[.!?]+$/u, "").trim();
  const titleNorm = stripOverlayNoise(title).replace(/[.!?]+$/u, "").toLocaleLowerCase();
  const textNorm = text.toLocaleLowerCase();
  if (!textNorm || textNorm === titleNorm) return "";
  return text;
}

function tailoredCallToAction(callToAction: string | undefined, title: string): string | undefined {
  const name = (splitTitleParts(title)[0] ?? title.trim()).slice(0, 48).replace(/[.!?]+$/u, "");
  const trimmed = callToAction?.trim();
  if (!trimmed) return undefined;
  if (isGenericCta(trimmed) || !stripOverlayNoise(trimmed)) return name ? `See ${name}.` : undefined;
  return stripOverlayNoise(trimmed).slice(0, 180);
}

function overlayHeadline(brief: string): string | undefined {
  const parts = splitTitleParts(brief.trim());
  if (parts.length > 1 && parts[0] && parts[0].length <= 60) return parts[0];
  return undefined;
}

function fillCaptions(brief: string, source: StoryboardSource, sceneCount: number): string[] {
  const lastCta = tailoredCallToAction(source.callToAction, brief);
  const bodyCount = lastCta ? sceneCount - 1 : sceneCount;
  const unwrapped = unwrapHostCopy(source.caption ?? "", brief);
  const narrative = unwrapped || brief.trim();
  const fragments = narrative
    .split(/(?:[.!?]+(?:\s+|$)|[,;]\s*)/u)
    .map((part) => part.trim())
    .filter((part) => part.length >= 12 && !isGenericCta(part));
  const titleParts = splitTitleParts(brief.trim());
  const unique: string[] = [];
  const seen = new Set<string>();
  const push = (value: string, asSentence: boolean) => {
    const text = stripOverlayNoise(value).replace(/[.!?]+$/u, "").trim();
    const key = text.toLocaleLowerCase();
    if (text.length < 2 || seen.has(key) || isGenericCta(text)) return;
    seen.add(key);
    unique.push(asSentence ? subjectCaption(text) : text.slice(0, 180));
  };
  const joinedTitle = titleParts.join(" ").toLocaleLowerCase();
  const briefNorm = stripOverlayNoise(brief).replace(/[.!?]+$/u, "").toLocaleLowerCase();
  for (const fragment of fragments) {
    const normalized = stripOverlayNoise(fragment).replace(/[.!?]+$/u, "").trim().toLocaleLowerCase();
    if (normalized === briefNorm || normalized === joinedTitle) continue;
    push(fragment, true);
  }
  for (const part of titleParts) push(part, titleParts.length === 1);
  if (!unique.length && narrative) push(narrative, true);
  const captions: string[] = [];
  for (let order = 0; order < bodyCount; order += 1) {
    captions.push(unique[order] ?? "");
  }
  if (lastCta) captions.push(lastCta);
  return captions;
}

function promptWithRole(brief: string, role: string): string {
  const subject = brief.trim() || "Untitled subject";
  const suffix = ` — ${role}`;
  return `${subject.slice(0, 240 - suffix.length).trim()}${suffix}`;
}

/** Deterministic host-neutral storyboard used by browser and trusted imports. */
export function buildStoryboardDraft(
  brief: string,
  makeId: () => string,
  architecture?: VideoArchitecture,
  source: StoryboardSource = {}
): Scene[] {
  const narrative = unwrapHostCopy(source.caption ?? "", brief) || brief;
  const visualSubject = [source.visualHint?.trim(), brief].filter(Boolean).join(" ");
  const fragments = narrative
    .split(/(?:[.!?]+(?:\s+|$)|[,;]\s*)/u)
    .map((part) => part.trim())
    .filter((part) => part.length >= 12 && !isGenericCta(part))
    .slice(0, 6);
  const sceneCount = architecture ? (architecture.durationSeconds === 15 ? 4 : architecture.durationSeconds === 30 ? 5 : 6) : 0;
  const architectureSceneIndexes = architecture ? architectureIndexes(sceneCount) : [];
  const visualPrompts = architecture
    ? architectureSceneIndexes.map((roleIndex, index) => footagePrompt(
      `${source.visualHint?.trim() || fragments[index] || visualSubject}`,
      ARCHITECTURE_FOOTAGE[architecture.structure][roleIndex] ?? "cinematic scene",
      architecture.tone
    ))
    : fragments.length >= 3
      ? fragments.map((fragment) => fragment.slice(0, 240).trim())
      : STORY_ROLES.map((role) => promptWithRole(visualSubject, role));
  const words = narrative.trim() ? narrative.trim().split(/\s+/u) : [];
  const base = Math.floor(words.length / visualPrompts.length);
  let remainder = words.length % visualPrompts.length;
  let cursor = 0;
  const totalDurationMs = (architecture?.durationSeconds ?? visualPrompts.length * 3) * 1000;
  const durationBase = Math.floor(totalDurationMs / visualPrompts.length);
  const overlayCaptions = architecture ? fillCaptions(brief, source, visualPrompts.length) : [];
  const headline = architecture ? overlayHeadline(brief) : undefined;
  return visualPrompts.map((visual_prompt, order) => {
    const count = base + (remainder-- > 0 ? 1 : 0);
    const isLast = order === visualPrompts.length - 1;
    const caption = architecture
      ? overlayCaptions[order] ?? ""
      : isLast && source.callToAction?.trim()
        ? (tailoredCallToAction(source.callToAction, brief) ?? source.callToAction.trim().slice(0, 180))
        : words.slice(cursor, cursor + count).join(" ").slice(0, 180);
    cursor += count;
    const titled = Boolean(headline && order === 0);
    return {
      id: makeId(),
      order,
      caption,
      visual_prompt,
      duration_ms: durationBase + (order < totalDurationMs % visualPrompts.length ? 1 : 0),
      focal_x: 0.5,
      focal_y: 0.5,
      motion: "zoom",
      audio_level: 1,
      ducking: false,
      ...(titled ? { overlay_look: "title" as const, overlay_place: "center" as const } : {})
    };
  });
}

export function conceptsFor(brief: ProjectSnapshot["brief"]): [Concept, Concept, Concept] {
  const subject = brief.purpose.trim().slice(0, 80) || "your subject";
  const short = subject.slice(0, 48);
  return [
    {
      id: "direct",
      title: "Direct",
      treatment: `${subject}: lead with the result`,
      hook: `Lead with the outcome, then show how ${short} gets there.`,
      beat_summary: "Problem → impact → friction → solution → proof → result",
      duration_seconds: 15,
      scene_count: 4,
      media_direction: "Concrete people and product shots; search for the result early."
    },
    {
      id: "story",
      title: "Story",
      treatment: `${subject}: establish, turn, resolve`,
      hook: `Establish the world of ${short}, turn once, then resolve.`,
      beat_summary: "Establish → detail → develop → turn → close",
      duration_seconds: 30,
      scene_count: 5,
      media_direction: "Wide establishing frames, human detail, then a decisive visual turn."
    },
    {
      id: "rhythm",
      title: "Rhythm",
      treatment: `${subject}: concise visual beats`,
      hook: `Cut through ${short} as short, punchy visual beats.`,
      beat_summary: "Start → progress → momentum → turn → result → today",
      duration_seconds: 45,
      scene_count: 6,
      media_direction: "Chronological places and action; keep every beat imageable and brief."
    }
  ];
}

/**
 * Deterministic first storyboard from a chosen concept and brief.
 * ponytail: formulaic concept→architecture mapping is the ceiling; upgrade to a
 * host-owned planner only after this licensed-stock journey is measured.
 */
export function planStoryboardScenes(
  brief: ProjectSnapshot["brief"],
  conceptId: string,
  makeId: () => string
): Scene[] {
  const concept = conceptsFor(brief).find(({ id }) => id === conceptId);
  if (!concept) throw new Error("unknown concept");
  const architecture: VideoArchitecture = {
    goal: conceptId === "direct" ? "promote" : "story",
    audience: "general",
    structure: conceptId === "story" ? "story_arc" : conceptId === "rhythm" ? "chronological" : "problem_solution",
    tone: "cinematic",
    pace: conceptId === "rhythm" ? "fast" : "balanced",
    durationSeconds: concept.duration_seconds,
    media: "stock"
  };
  return buildStoryboardDraft(brief.purpose, makeId, architecture);
}

function boundedScene(scene: Scene): Scene {
  if (scene.caption.length > 180) throw new Error("caption exceeds 180 characters");
  if (!Number.isFinite(scene.duration_ms) || scene.duration_ms < 500 || scene.duration_ms > 15_000) {
    throw new Error("duration out of bounds");
  }
  if (![scene.focal_x, scene.focal_y, scene.audio_level].every((value) => Number.isFinite(value) && value >= 0 && value <= 1)) {
    throw new Error("normalized value out of bounds");
  }
  if (scene.visual_prompt !== undefined && (
    !scene.visual_prompt
    || scene.visual_prompt !== scene.visual_prompt.trim()
    || scene.visual_prompt.length > 240
  )) throw new Error("invalid visual prompt");
  if (scene.title !== undefined && (
    !scene.title
    || scene.title !== scene.title.trim()
    || scene.title.length > 60
  )) throw new Error("invalid title");
  if (scene.overlay_place !== undefined && scene.overlay_place !== "bottom"
    && scene.overlay_place !== "center" && scene.overlay_place !== "top") {
    throw new Error("invalid overlay place");
  }
  if (scene.overlay_look !== undefined && scene.overlay_look !== "caption"
    && scene.overlay_look !== "title" && scene.overlay_look !== "poster") {
    throw new Error("invalid overlay look");
  }
  if (scene.caption_cues && scene.caption_cues.length) validateCues(scene.caption_cues, scene.duration_ms);
  return scene;
}

/** Throws a `validation`-style error when explicit cues are malformed, overlap, or escape `[0, duration_ms]`. */
export function validateCues(cues: CaptionCue[], duration_ms: number): void {
  let previousEnd = 0;
  for (const cue of cues) {
    if (typeof cue.text !== "string" || !cue.text.trim()) throw new Error("invalid caption cue text");
    if (
      !Number.isFinite(cue.start_ms)
      || !Number.isFinite(cue.end_ms)
      || cue.start_ms < 0
      || cue.end_ms > duration_ms
      || cue.start_ms >= cue.end_ms
    ) {
      throw new Error("invalid caption cue range");
    }
    if (cue.start_ms < previousEnd) throw new Error("overlapping caption cues");
    previousEnd = cue.end_ms;
  }
}

const MIN_FRAGMENT_CHARS = 8;
const LONG_SENTENCE_CHARS = 60;

function splitCaption(caption: string): string[] {
  const trimmed = caption.trim();
  if (!trimmed) return [];
  const sentences = trimmed.split(/(?<=[.?!])\s+/).map((part) => part.trim()).filter(Boolean);
  const segments = sentences.flatMap((sentence) =>
    sentence.length > LONG_SENTENCE_CHARS
      ? sentence.split(/,\s*/).map((part) => part.trim()).filter(Boolean)
      : [sentence]
  );
  const merged: string[] = [];
  for (const segment of segments) {
    if (merged.length && segment.length < MIN_FRAGMENT_CHARS) {
      merged[merged.length - 1] = `${merged[merged.length - 1]} ${segment}`;
    } else {
      merged.push(segment);
    }
  }
  return merged.length ? merged : [trimmed];
}

/** Largest-remainder apportionment: durations sum to exactly `total_ms`. */
function proportionalDurations(weights: number[], total_ms: number): number[] {
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const raw = weights.map((weight) => (weight / totalWeight) * total_ms);
  const durations = raw.map(Math.floor);
  const remainder = total_ms - durations.reduce((sum, value) => sum + value, 0);
  const order = raw
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction);
  for (const { index } of order.slice(0, remainder)) {
    durations[index] = (durations[index] ?? 0) + 1;
  }
  return durations;
}

function deriveCues(caption: string, duration_ms: number): CaptionCue[] {
  const segments = splitCaption(caption);
  if (!segments.length) return [];
  const [only] = segments;
  if (segments.length === 1 && only !== undefined) {
    return [{ text: only, start_ms: 0, end_ms: duration_ms }];
  }

  const weights = segments.map((segment) => segment.length || 1);
  const durations = proportionalDurations(weights, duration_ms);

  const cues: CaptionCue[] = [];
  let cursor = 0;
  segments.forEach((text, index) => {
    const duration = durations[index] ?? 0;
    // ponytail: fragments too short to earn a whole millisecond fold into the
    // previous cue rather than emitting a zero-length Dialogue line. Ceiling:
    // this only bites when duration_ms is near the segment count (rare given
    // the 180-char caption cap and 500ms scene floor); real captions/durations
    // stay far from that edge.
    const previous = cues[cues.length - 1];
    if (duration <= 0 && previous) {
      previous.text += ` ${text}`;
      return;
    }
    const start = cursor;
    const end = Math.min(duration_ms, start + Math.max(duration, 1));
    cues.push({ text, start_ms: start, end_ms: end });
    cursor = end;
  });
  const last = cues[cues.length - 1];
  if (last) last.end_ms = duration_ms;
  return cues;
}

/** Resolved timed cue schedule for a scene: explicit (validated) or derived from `caption` + `duration_ms`. */
export function cuesForScene(scene: Scene): CaptionCue[] {
  if (scene.caption_cues && scene.caption_cues.length) {
    validateCues(scene.caption_cues, scene.duration_ms);
    return scene.caption_cues;
  }
  return deriveCues(scene.caption, scene.duration_ms);
}

/** Active spoken subtitle at scene-local elapsed time. */
export function cueAtElapsed(cues: CaptionCue[], elapsedMs: number): CaptionCue | undefined {
  if (!cues.length) return undefined;
  const t = Math.max(0, elapsedMs);
  const last = cues[cues.length - 1];
  return cues.find((cue) => t >= cue.start_ms && t < cue.end_ms) ?? (last && t >= last.start_ms ? last : undefined);
}

/** Music-bed gain while a voice-over is attached. ponytail: constant duck; upgrade to sidechain. */
export const VOICEOVER_DUCK = 0.22;

function isValidCueShape(value: unknown): boolean {
  return Array.isArray(value) && value.every((cue) =>
    cue
    && typeof cue === "object"
    && typeof (cue as Record<string, unknown>).text === "string"
    && typeof (cue as Record<string, unknown>).start_ms === "number"
    && typeof (cue as Record<string, unknown>).end_ms === "number"
  );
}

function validatedScene(value: unknown): Scene {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid scene");
  const scene = value as Record<string, unknown>;
  if (typeof scene.id !== "string"
    || !scene.id
    || !Number.isInteger(scene.order)
    || (scene.order as number) < 0
    || typeof scene.caption !== "string"
    || typeof scene.duration_ms !== "number"
    || typeof scene.focal_x !== "number"
    || typeof scene.focal_y !== "number"
    || !["none", "push", "zoom"].includes(String(scene.motion))
    || typeof scene.audio_level !== "number"
    || typeof scene.ducking !== "boolean"
    || ("media_id" in scene && (typeof scene.media_id !== "string" || !scene.media_id))
    || ("visual_prompt" in scene && typeof scene.visual_prompt !== "string")
    || ("title" in scene && typeof scene.title !== "string")
    || ("overlay_place" in scene && scene.overlay_place !== "bottom"
      && scene.overlay_place !== "center" && scene.overlay_place !== "top")
    || ("overlay_look" in scene && scene.overlay_look !== "caption"
      && scene.overlay_look !== "title" && scene.overlay_look !== "poster")
    || ("caption_cues" in scene && !isValidCueShape(scene.caption_cues))) {
    throw new Error("invalid scene");
  }
  return boundedScene(scene as unknown as Scene);
}

function copyScene(scene: Scene): Scene {
  return {
    ...scene,
    ...(scene.caption_cues ? { caption_cues: scene.caption_cues.map((cue) => ({ ...cue })) } : {})
  };
}

function validatedStoryboard(value: unknown, requireVisualPrompt: boolean): Scene[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_STORYBOARD_SCENES) {
    throw new Error("storyboard must contain 1 to 8 scenes");
  }
  const scenes = value.map(validatedScene);
  if (!isStoryboardScenes(scenes, requireVisualPrompt)) throw new Error("invalid storyboard scenes");
  return scenes.map(copyScene);
}

export function applyCommand(snapshot: ProjectSnapshot, command: CommandEnvelope): ProjectSnapshot {
  if (command.project_id !== snapshot.id) throw new Error("project mismatch");
  if (command.base_revision !== snapshot.revision) throw new Error("stale revision");
  if (command.kind === "select_concept") {
    const conceptId = String(command.payload.concept_id ?? "");
    if (!conceptsFor(snapshot.brief).some(({ id }) => id === conceptId)) throw new Error("unknown concept");
    let sceneSerial = 0;
    const scenes = snapshot.scenes.length
      ? snapshot.scenes
      : planStoryboardScenes(snapshot.brief, conceptId, () => `${snapshot.id}-scene-${++sceneSerial}`);
    return { ...snapshot, selected_concept_id: conceptId, scenes, revision: snapshot.revision + 1 };
  }
  if (command.kind === "update_scene") {
    const scene = validatedScene(command.payload.scene);
    if (!snapshot.scenes.some(({ id }) => id === scene.id)) throw new Error("unknown scene");
    return { ...snapshot, scenes: snapshot.scenes.map((item) => item.id === scene.id ? scene : item), revision: snapshot.revision + 1 };
  }
  if (command.kind === "reorder_scene") {
    const sceneId = String(command.payload.scene_id ?? "");
    const to = Number(command.payload.to);
    if (!Number.isInteger(to) || to < 0 || to >= snapshot.scenes.length) throw new Error("invalid order");
    const scenes = snapshot.scenes.filter(({ id }) => id !== sceneId);
    const moved = snapshot.scenes.find(({ id }) => id === sceneId);
    if (!moved) throw new Error("unknown scene");
    scenes.splice(to, 0, moved);
    return { ...snapshot, scenes: scenes.map((scene, order) => ({ ...scene, order })), revision: snapshot.revision + 1 };
  }
  if (command.kind === "replace_storyboard") {
    return {
      ...snapshot,
      scenes: validatedStoryboard(command.payload.scenes, true),
      revision: snapshot.revision + 1
    };
  }
  if (command.kind === "add_scene") {
    if (snapshot.scenes.length >= MAX_STORYBOARD_SCENES) throw new Error("storyboard already has 8 scenes");
    const at = command.payload.at;
    if (!Number.isInteger(at) || (at as number) < 0 || (at as number) > snapshot.scenes.length) {
      throw new Error("invalid insertion order");
    }
    const scene = validatedScene(command.payload.scene);
    if (!scene.visual_prompt) throw new Error("visual prompt required");
    if (snapshot.scenes.some(({ id }) => id === scene.id)) throw new Error("duplicate scene id");
    const scenes = snapshot.scenes.map(copyScene);
    scenes.splice(at as number, 0, copyScene(scene));
    return {
      ...snapshot,
      scenes: scenes.map((item, order) => ({ ...item, order })),
      revision: snapshot.revision + 1
    };
  }
  if (command.kind === "remove_scene") {
    if (snapshot.scenes.length <= 1) throw new Error("storyboard must retain one scene");
    const sceneId = command.payload.scene_id;
    if (typeof sceneId !== "string" || !sceneId) throw new Error("invalid scene id");
    if (!snapshot.scenes.some(({ id }) => id === sceneId)) throw new Error("unknown scene");
    return {
      ...snapshot,
      scenes: snapshot.scenes
        .filter(({ id }) => id !== sceneId)
        .map((scene, order) => ({ ...copyScene(scene), order })),
      revision: snapshot.revision + 1
    };
  }
  if (command.kind === "update_soundtrack") {
    const raw = command.payload.soundtrack;
    const brief = { ...snapshot.brief };
    if (raw === null) {
      delete brief.soundtrack;
    } else if (isSoundtrack(raw)) {
      brief.soundtrack = raw;
    } else {
      throw new Error("invalid soundtrack");
    }
    return { ...snapshot, brief, revision: snapshot.revision + 1 };
  }
  if (command.kind === "update_voiceover") {
    const raw = command.payload.voiceover;
    const brief = { ...snapshot.brief };
    if (raw === null) {
      delete brief.voiceover;
    } else if (isVoiceover(raw)) {
      brief.voiceover = raw;
    } else {
      throw new Error("invalid voiceover");
    }
    return { ...snapshot, brief, revision: snapshot.revision + 1 };
  }
  throw new Error("unknown command");
}

export function coverCropFilter(width: number, height: number, focal_x: number, focal_y: number): string[] {
  return [
    `scale=${width}:${height}:force_original_aspect_ratio=increase`,
    `crop=${width}:${height}:(iw-ow)*${focal_x}:(ih-oh)*${focal_y}`
  ];
}

export function validateRenderProfile(profile: RenderProfile): RenderProfile {
  if (
    !Number.isInteger(profile?.width)
    || !Number.isInteger(profile?.height)
    || profile.width < 16
    || profile.width > 7680
    || profile.height < 16
    || profile.height > 7680
  ) {
    throw new Error("render dimensions out of bounds");
  }
  if (profile.watermark !== undefined && (
    typeof profile.watermark !== "string"
    || !profile.watermark
    || profile.watermark !== profile.watermark.trim()
    || profile.watermark.length > 120
  )) {
    throw new Error("invalid render watermark");
  }
  return profile;
}

export function renderPlan(snapshot: ProjectSnapshot, profile: RenderProfile): RenderPlan {
  validateRenderProfile(profile);
  return {
    revision: snapshot.revision,
    width: profile.width,
    height: profile.height,
    ...(profile.watermark === undefined ? {} : { watermark: profile.watermark }),
    scenes: snapshot.scenes.map(boundedScene).map((scene) => ({ ...scene, caption_cues: cuesForScene(scene) }))
  };
}
