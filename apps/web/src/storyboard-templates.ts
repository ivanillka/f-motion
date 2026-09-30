import type { ProjectSnapshot, Scene } from "./api";

export const STORYBOARD_TEMPLATES_KEY = "fengine-storyboard-templates";

export interface StoryboardTemplateScene {
  order: number;
  caption: string;
  duration_ms: number;
  focal_x: number;
  focal_y: number;
  motion: Scene["motion"];
  audio_level: number;
  ducking: boolean;
  visual_prompt?: string;
  title?: string;
  overlay_place?: Scene["overlay_place"];
  overlay_look?: Scene["overlay_look"];
}

export interface StoryboardTemplate {
  id: string;
  name: string;
  updatedAt: string;
  brief: ProjectSnapshot["brief"];
  selected_concept_id?: string;
  scenes: StoryboardTemplateScene[];
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `tpl-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Drop footage refs; keep text, timing, overlay, architecture, stock music pick. */
export function templateBriefFromProject(brief: ProjectSnapshot["brief"]): ProjectSnapshot["brief"] {
  const next: ProjectSnapshot["brief"] = {
    purpose: brief.purpose,
    audience: brief.audience,
    tone: brief.tone,
    ...(brief.architecture ? { architecture: brief.architecture } : {}),
    ...(brief.media_glance ? { media_glance: brief.media_glance } : {})
  };
  if (brief.soundtrack?.kind === "stock" && brief.soundtrack.stock_id) {
    next.soundtrack = {
      kind: "stock",
      bpm: brief.soundtrack.bpm,
      offset_ms: brief.soundtrack.offset_ms,
      level: brief.soundtrack.level,
      stock_id: brief.soundtrack.stock_id
    };
  }
  return next;
}

export function templateScenesFromProject(scenes: Scene[]): StoryboardTemplateScene[] {
  return scenes.map((scene, order) => {
    const {
      media_id: _mediaId,
      id: _id,
      caption_cues: _cues,
      ...rest
    } = scene as Scene & { caption_cues?: unknown };
    return {
      order,
      caption: rest.caption,
      duration_ms: rest.duration_ms,
      focal_x: rest.focal_x,
      focal_y: rest.focal_y,
      motion: rest.motion,
      audio_level: rest.audio_level,
      ducking: rest.ducking,
      ...(rest.visual_prompt !== undefined ? { visual_prompt: rest.visual_prompt } : {}),
      ...(rest.title !== undefined ? { title: rest.title } : {}),
      ...(rest.overlay_place !== undefined ? { overlay_place: rest.overlay_place } : {}),
      ...(rest.overlay_look !== undefined ? { overlay_look: rest.overlay_look } : {})
    };
  });
}

export function snapshotToTemplate(
  project: ProjectSnapshot,
  name: string,
  id = newId(),
  updatedAt = new Date().toISOString()
): StoryboardTemplate {
  return {
    id,
    name: name.trim() || "Untitled template",
    updatedAt,
    brief: templateBriefFromProject(project.brief),
    ...(project.selected_concept_id ? { selected_concept_id: project.selected_concept_id } : {}),
    scenes: templateScenesFromProject(project.scenes)
  };
}

export function scenesFromTemplate(
  template: StoryboardTemplate,
  newSceneId: () => string
): Scene[] {
  return template.scenes.map((scene, order) => ({
    id: newSceneId(),
    order,
    caption: scene.caption,
    duration_ms: scene.duration_ms,
    focal_x: scene.focal_x,
    focal_y: scene.focal_y,
    motion: scene.motion,
    audio_level: scene.audio_level,
    ducking: scene.ducking,
    visual_prompt: scene.visual_prompt
      || `${template.brief.purpose.slice(0, 210).trim()} — scene ${order + 1}`,
    ...(scene.title !== undefined ? { title: scene.title } : {}),
    ...(scene.overlay_place !== undefined ? { overlay_place: scene.overlay_place } : {}),
    ...(scene.overlay_look !== undefined ? { overlay_look: scene.overlay_look } : {})
  }));
}

export function readStoryboardTemplates(storage: Pick<Storage, "getItem"> = localStorage): StoryboardTemplate[] {
  try {
    const raw = storage.getItem(STORYBOARD_TEMPLATES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isStoryboardTemplate).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } catch {
    return [];
  }
}

export function writeStoryboardTemplates(
  templates: StoryboardTemplate[],
  storage: Pick<Storage, "setItem"> = localStorage
): void {
  storage.setItem(STORYBOARD_TEMPLATES_KEY, JSON.stringify(templates));
}

export function upsertStoryboardTemplate(
  template: StoryboardTemplate,
  storage: Pick<Storage, "getItem" | "setItem"> = localStorage
): StoryboardTemplate[] {
  const current = readStoryboardTemplates(storage);
  const index = current.findIndex((item) => item.id === template.id);
  const next = index >= 0
    ? current.map((item, i) => (i === index ? template : item))
    : [template, ...current];
  writeStoryboardTemplates(next, storage);
  return readStoryboardTemplates(storage);
}

export function deleteStoryboardTemplate(
  id: string,
  storage: Pick<Storage, "getItem" | "setItem"> = localStorage
): StoryboardTemplate[] {
  const next = readStoryboardTemplates(storage).filter((item) => item.id !== id);
  writeStoryboardTemplates(next, storage);
  return next;
}

function isStoryboardTemplate(value: unknown): value is StoryboardTemplate {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === "string"
    && typeof row.name === "string"
    && typeof row.updatedAt === "string"
    && row.brief !== null
    && typeof row.brief === "object"
    && Array.isArray(row.scenes);
}
