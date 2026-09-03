import { mkdir, readFile, stat } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { FmotionApiError, FmotionClient } from "./client.js";
import { composeReel, type ComposeOptions } from "./compose.js";

export type BatchItem = {
  purpose: string;
  audience?: string;
  tone?: string;
  mediaPaths?: string[];
  fillStock?: boolean;
  out?: string;
};

export type BatchOptions = {
  render?: "preview" | "final";
  keepOnFailure?: boolean;
  failFast?: boolean;
  outDir?: string;
};

export type BatchItemResult = {
  index: number;
  purpose: string;
  ok: boolean;
  path?: string;
  project_id?: string;
  job_id?: string;
  purged?: boolean;
  error?: string;
  quota_exceeded?: boolean;
};

export type BatchResult = {
  ok: boolean;
  render: "preview" | "final";
  items: BatchItemResult[];
  succeeded: number;
  failed: number;
};

function slug(purpose: string): string {
  const cleaned = purpose.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return (cleaned || "reel").slice(0, 40);
}

function projectIdOf(error: unknown): string | undefined {
  if (error && typeof error === "object" && "project_id" in error) {
    const value = (error as { project_id?: unknown }).project_id;
    return typeof value === "string" && value ? value : undefined;
  }
  return undefined;
}

function asItems(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object" && Array.isArray((raw as { items?: unknown }).items)) {
    return (raw as { items: unknown[] }).items;
  }
  throw new Error("Batch manifest must be an array or { items: [...] }");
}

function itemFromUnknown(value: unknown, index: number): BatchItem {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Item ${index} must be an object`);
  }
  const row = value as Record<string, unknown>;
  const purpose = typeof row.purpose === "string" ? row.purpose.trim() : "";
  if (!purpose) throw new Error(`Item ${index} is missing purpose`);
  const media = row.mediaPaths ?? row.media_paths;
  return {
    purpose,
    ...(typeof row.audience === "string" ? { audience: row.audience } : {}),
    ...(typeof row.tone === "string" ? { tone: row.tone } : {}),
    ...(Array.isArray(media) ? { mediaPaths: media.map(String) } : {}),
    ...(row.fillStock === true || row.fill_stock === true ? { fillStock: true } : {}),
    ...(typeof row.out === "string" ? { out: row.out } : {})
  };
}

function resolveMedia(paths: string[] | undefined, baseDir: string): string[] | undefined {
  if (!paths?.length) return paths;
  return paths.map((path) => isAbsolute(path) ? path : join(baseDir, path));
}

export async function loadBatchManifest(target: string): Promise<BatchItem[]> {
  const info = await stat(target);
  const file = info.isDirectory() ? join(target, "manifest.json") : target;
  const baseDir = dirname(file);
  const raw = JSON.parse(await readFile(file, "utf8")) as unknown;
  return asItems(raw).map((item, index) => {
    const parsed = itemFromUnknown(item, index);
    return { ...parsed, mediaPaths: resolveMedia(parsed.mediaPaths, baseDir) };
  });
}

async function purgeIfNeeded(
  client: FmotionClient,
  projectId: string | undefined,
  keep: boolean
): Promise<boolean> {
  if (!projectId || keep) return false;
  await client.deleteProject(projectId);
  return true;
}

export async function batchReels(
  client: FmotionClient,
  items: BatchItem[],
  options: BatchOptions = {}
): Promise<BatchResult> {
  if (!items.length) throw new Error("Batch manifest has no items");
  const render = options.render === "preview" ? "preview" : "final";
  const outDir = options.outDir || "out";
  await mkdir(outDir, { recursive: true });
  const results: BatchItemResult[] = [];

  for (const [index, item] of items.entries()) {
    const composeOptions: ComposeOptions = {
      purpose: item.purpose,
      audience: item.audience,
      tone: item.tone,
      mediaPaths: item.mediaPaths,
      fillStock: item.fillStock,
      render
    };
    const dest = item.out
      ? (isAbsolute(item.out) ? item.out : join(outDir, item.out))
      : join(outDir, `${String(index + 1).padStart(2, "0")}-${slug(item.purpose)}.mp4`);
    let projectId: string | undefined;
    try {
      const composed = await composeReel(client, composeOptions);
      projectId = composed.project_id;
      if (!composed.render || composed.render.phase !== "complete" || !composed.render.job_id) {
        throw new Error(
          composed.next === "preview_ready"
            ? "render did not complete"
            : composed.next === "needs_media"
              ? "storyboard still needs media"
              : "no ready media to render"
        );
      }
      const file = await client.downloadToFile(composed.render.job_id, dest);
      const purged = await purgeIfNeeded(client, projectId, false);
      results.push({
        index,
        purpose: item.purpose,
        ok: true,
        path: file.path,
        project_id: projectId,
        job_id: composed.render.job_id,
        purged
      });
    } catch (error) {
      const id = projectId || projectIdOf(error);
      let purged = false;
      try {
        purged = await purgeIfNeeded(client, id, Boolean(options.keepOnFailure));
      } catch {
        purged = false;
      }
      const quota = error instanceof FmotionApiError && error.body.type === "quota_exceeded";
      results.push({
        index,
        purpose: item.purpose,
        ok: false,
        project_id: id,
        purged,
        quota_exceeded: quota || undefined,
        error: error instanceof Error ? error.message : String(error)
      });
      if (options.failFast || quota) break;
    }
  }

  return {
    ok: results.every((item) => item.ok),
    render,
    items: results,
    succeeded: results.filter((item) => item.ok).length,
    failed: results.filter((item) => !item.ok).length
  };
}

export function batchUsage(): string {
  return `Usage: fmotion batch <manifest.json|dir> [--out dir] [--render preview|final] [--fail-fast] [--keep-on-failure]
  dir must contain manifest.json; mediaPaths are relative to that file.
  Each item is one composeReel call — there is no second bulk pipeline.`;
}
