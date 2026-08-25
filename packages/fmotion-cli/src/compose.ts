import { readFile } from "node:fs/promises";
import { FmotionClient, type ProjectView } from "./client.js";
import { draftUrl } from "./draft.js";
import { purposeFromMedia, readMedia, type MediaRead } from "./media.js";

export type ComposeOptions = {
  purpose?: string;
  audience?: string;
  tone?: string;
  mediaPaths?: string[];
  conceptId?: string;
  fillStock?: boolean;
  render?: "preview" | "none";
  webOrigin?: string;
};

export type ComposeResult = {
  project_id: string;
  revision: number;
  draft_url: string;
  projectUrl: string;
  media: MediaRead[];
  assets: string[];
  ready_scenes: number;
  scene_count: number;
  render?: {
    job_id: string;
    phase: string;
    kind: string;
    download?: { url: string; expires_at: string; kind: string };
  };
  next: "preview_ready" | "draft_only" | "needs_media";
};

function sceneDuration(detectedMs: unknown, fallback: number): number {
  if (typeof detectedMs !== "number" || !Number.isFinite(detectedMs)) return fallback;
  return Math.min(15_000, Math.max(500, Math.round(detectedMs)));
}

async function waitReady(
  client: FmotionClient,
  projectId: string,
  assetId: string,
  timeoutMs = 60_000
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const media = await client.getMedia(projectId, assetId);
    if (media.state === "ready") return media;
    if (media.state !== "admitted" && media.state !== "inspecting") {
      throw new Error(`media ${assetId} ${media.state}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`media ${assetId} still inspecting`);
}

async function attachAsset(
  client: FmotionClient,
  project: ProjectView,
  sceneId: string,
  assetId: string
): Promise<ProjectView> {
  const scene = project.scenes.find((item) => item.id === sceneId);
  if (!scene) return project;
  const media = await waitReady(client, project.id, assetId);
  return client.command(project.id, client.commandEnvelope(project.id, project.revision, "update_scene", {
    scene: {
      ...scene,
      media_id: assetId,
      duration_ms: sceneDuration(media.detected?.duration_ms, scene.duration_ms)
    }
  }));
}

export async function composeReel(client: FmotionClient, options: ComposeOptions): Promise<ComposeResult> {
  const media = options.mediaPaths?.length ? await readMedia(options.mediaPaths) : [];
  const purpose = (options.purpose?.trim() || purposeFromMedia(media)).slice(0, 500);
  if (!purpose) throw new Error("Missing purpose (chat answers or media files)");

  const created = await client.createProject({
    purpose,
    ...(options.audience ? { audience: options.audience } : {}),
    ...(options.tone ? { tone: options.tone } : {})
  });
  let project = created.project;
  const concepts = created.concepts ?? [];
  if (!project.scenes.length) {
    const conceptId = options.conceptId
      || concepts.find((item) => item.id === "story")?.id
      || concepts[0]?.id
      || "story";
    project = await client.command(
      project.id,
      client.commandEnvelope(project.id, project.revision, "select_concept", { concept_id: conceptId })
    );
  }

  const assets: string[] = [];
  const scenes = [...project.scenes].sort((left, right) => left.order - right.order);
  for (const [index, item] of media.entries()) {
    const scene = scenes[index];
    if (!scene || !item.mime) continue;
    const bytes = await readFile(item.path);
    const admission = await client.admitUpload(project.id, { content_type: item.mime, bytes: bytes.length });
    await client.putUpload(admission.upload_url, bytes, item.mime);
    await client.completeUpload(project.id, admission.asset_id);
    project = await attachAsset(client, project, scene.id, admission.asset_id);
    assets.push(admission.asset_id);
  }

  if (options.fillStock && !media.length) {
    const filled = await client.fillStock(project.id);
    for (const result of filled.results) {
      if (result.state !== "matched" || !result.asset) continue;
      project = await attachAsset(client, project, result.scene_id, result.asset.id);
      assets.push(result.asset.id);
    }
  }

  const latest = await client.getProject(project.id);
  project = latest.project;
  const readyScenes = project.scenes.filter((scene) => scene.media_id).length;
  const url = draftUrl(project.id, options.webOrigin);
  const result: ComposeResult = {
    project_id: project.id,
    revision: project.revision,
    draft_url: url,
    projectUrl: url,
    media,
    assets,
    ready_scenes: readyScenes,
    scene_count: project.scenes.length,
    next: readyScenes === 0
      ? "draft_only"
      : readyScenes < project.scenes.length
        ? "needs_media"
        : "preview_ready"
  };

  if (options.render !== "none" && readyScenes > 0 && readyScenes === project.scenes.length) {
    const job = await client.render(project.id, "preview");
    const waited = await client.wait(job.job_id);
    const download = waited.phase === "complete" ? await client.download(job.job_id) : undefined;
    result.render = {
      job_id: job.job_id,
      phase: waited.phase,
      kind: job.kind,
      ...(download ? { download } : {})
    };
  }
  return result;
}
