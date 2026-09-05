import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
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

function destFor(item: BatchItem, index: number, outDir: string): string {
  if (!item.out) return join(outDir, `${String(index + 1).padStart(2, "0")}-${slug(item.purpose)}.mp4`);
  return isAbsolute(item.out) ? item.out : join(outDir, item.out);
}

async function saveUrl(url: string, dest: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new FmotionApiError(response.status, { type: "upstream", message: "download failed" });
  }
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, Buffer.from(await response.arrayBuffer()));
}

async function batchLocalItem(
  client: FmotionClient,
  item: BatchItem,
  index: number,
  outDir: string,
  render: "preview" | "final",
  keepOnFailure: boolean
): Promise<BatchItemResult> {
  const composeOptions: ComposeOptions = {
    purpose: item.purpose,
    audience: item.audience,
    tone: item.tone,
    mediaPaths: item.mediaPaths,
    fillStock: item.fillStock,
    render
  };
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
    const file = await client.downloadToFile(composed.render.job_id, destFor(item, index, outDir));
    await client.deleteProject(projectId);
    return {
      index,
      purpose: item.purpose,
      ok: true,
      path: file.path,
      project_id: projectId,
      job_id: composed.render.job_id,
      purged: true
    };
  } catch (error) {
    if (projectId && !keepOnFailure) {
      await client.deleteProject(projectId).catch(() => undefined);
    }
    const quota = error instanceof FmotionApiError && error.body.type === "quota_exceeded";
    return {
      index,
      purpose: item.purpose,
      ok: false,
      project_id: projectId,
      purged: Boolean(projectId) && !keepOnFailure,
      quota_exceeded: quota || undefined,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Serial bulk. Brief/stock items call POST /v1/batches so the API loops
 * composeOne — the same function as POST /v1/compose. Local files still go
 * through composeReel because the bytes live on the client.
 */
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

  const remote = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => !item.mediaPaths?.length);
  if (remote.length) {
    const remoteResult = await client.runBatch({
      items: remote.map(({ item }) => ({
        purpose: item.purpose,
        audience: item.audience,
        tone: item.tone,
        fill_stock: item.fillStock
      })),
      render,
      keep_on_failure: options.keepOnFailure,
      fail_fast: options.failFast
    });
    for (const [offset, row] of remoteResult.items.entries()) {
      const mapped = remote[offset];
      if (!mapped) continue;
      if (row.ok && row.download?.url) {
        const dest = destFor(mapped.item, mapped.index, outDir);
        await saveUrl(row.download.url, dest);
        results[mapped.index] = { ...row, index: mapped.index, path: dest };
      } else {
        results[mapped.index] = { ...row, index: mapped.index };
        if (options.failFast || row.quota_exceeded) {
          return summarize(results, render);
        }
      }
    }
  }

  for (const [index, item] of items.entries()) {
    if (!item.mediaPaths?.length) continue;
    results[index] = await batchLocalItem(
      client,
      item,
      index,
      outDir,
      render,
      Boolean(options.keepOnFailure)
    );
    if ((options.failFast || results[index]?.quota_exceeded) && !results[index]?.ok) {
      return summarize(results, render);
    }
  }

  return summarize(results, render);
}

function summarize(results: BatchItemResult[], render: "preview" | "final"): BatchResult {
  const items = results.filter(Boolean);
  return {
    ok: items.every((item) => item.ok),
    render,
    items,
    succeeded: items.filter((item) => item.ok).length,
    failed: items.filter((item) => !item.ok).length
  };
}

export function batchUsage(): string {
  return `Usage: fmotion batch <manifest.json|dir> [--out dir] [--render preview|final] [--fail-fast] [--keep-on-failure]
  dir must contain manifest.json; mediaPaths are relative to that file.
  Brief/stock items call POST /v1/batches (composeOne in a loop). Local files still use composeReel.`;
}
