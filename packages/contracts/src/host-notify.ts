import { createHmac, timingSafeEqual } from "node:crypto";

export const renderNotifyQueue = "notify-render";
export const renderNotifySignatureHeader = "x-f-motion-signature";
export const renderNotifyMaxSkewMs = 5 * 60_000;

export interface RenderCompleteNotify {
  event: "render.complete";
  job_id: string;
  project_id: string;
  kind: "preview" | "final";
  download_path: string;
  external_id?: string;
}

export interface RenderNotifyJob {
  notifyUrl: string;
  jobId: string;
  projectId: string;
  kind: "preview" | "final";
  externalId?: string;
}

export function parseNotifyUrl(value: unknown, allowedOrigins: readonly string[]): string | undefined {
  if (typeof value !== "string" || value.length > 2_048) return undefined;
  try {
    const url = new URL(value.trim());
    if (url.username || url.password || url.hash) return undefined;
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    if (!allowedOrigins.includes(url.origin)) return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

export function buildRenderCompleteNotify(input: {
  jobId: string;
  projectId: string;
  kind: "preview" | "final";
  externalId?: string;
}): RenderCompleteNotify {
  return {
    event: "render.complete",
    job_id: input.jobId,
    project_id: input.projectId,
    kind: input.kind,
    download_path: `/v1/render-jobs/${input.jobId}/download`,
    ...(input.externalId ? { external_id: input.externalId } : {})
  };
}

export function signRenderNotify(rawBody: string, secret: string, timestampUnixSeconds: number): string {
  const digest = createHmac("sha256", secret).update(`${timestampUnixSeconds}.${rawBody}`).digest("hex");
  return `t=${timestampUnixSeconds},v1=${digest}`;
}

export function verifyRenderNotify(
  rawBody: string,
  header: string | undefined,
  secret: string,
  nowMs = Date.now()
): boolean {
  const match = header?.trim().match(/^t=(\d+),v1=([0-9a-f]{64})$/i);
  if (!match) return false;
  const timestamp = Number(match[1]);
  if (!Number.isFinite(timestamp) || Math.abs(nowMs - timestamp * 1000) > renderNotifyMaxSkewMs) return false;
  const expected = Buffer.from(signRenderNotify(rawBody, secret, timestamp));
  const received = Buffer.from(header!.trim());
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export interface RenderNotifyConfig {
  secret: string;
  origins: string[];
}

function parseNotifyOrigins(raw: string, hosted: boolean): string[] {
  return [...new Set(raw.split(",").map((value) => {
    const origin = new URL(value.trim());
    if (origin.username || origin.password || origin.pathname !== "/") {
      throw new Error("invalid FENGINE_RENDER_NOTIFY_ORIGINS");
    }
    if (origin.protocol === "https:") return origin.origin;
    const loopback = origin.hostname === "127.0.0.1" || origin.hostname === "localhost";
    if (origin.protocol === "http:" && loopback && !hosted) return origin.origin;
    throw new Error("invalid FENGINE_RENDER_NOTIFY_ORIGINS");
  }))];
}

export function renderNotifyConfigFromEnv(
  env: Record<string, string | undefined>
): RenderNotifyConfig | undefined {
  const rawOrigins = env.FENGINE_RENDER_NOTIFY_ORIGINS?.trim();
  const secret = (env.FENGINE_RENDER_NOTIFY_SECRET ?? env.FENGINE_IMPORT_TOKEN)?.trim();
  if (!rawOrigins && !env.FENGINE_RENDER_NOTIFY_SECRET?.trim()) return undefined;
  if (!rawOrigins) throw new Error("missing FENGINE_RENDER_NOTIFY_ORIGINS");
  if (!secret || secret.length < 32) {
    throw new Error("FENGINE_RENDER_NOTIFY_SECRET must contain at least 32 characters");
  }
  return {
    secret,
    origins: parseNotifyOrigins(rawOrigins, env.FENGINE_ENV === "hosted")
  };
}

export async function deliverRenderNotify(
  job: RenderNotifyJob,
  secret: string,
  allowedOrigins: readonly string[],
  fetchImpl: typeof fetch = fetch,
  now = new Date()
): Promise<void> {
  const notifyUrl = parseNotifyUrl(job.notifyUrl, allowedOrigins);
  if (!notifyUrl) throw new Error("notify url is not allowed");
  const payload = buildRenderCompleteNotify({
    jobId: job.jobId,
    projectId: job.projectId,
    kind: job.kind,
    ...(job.externalId ? { externalId: job.externalId } : {})
  });
  const rawBody = JSON.stringify(payload);
  const signature = signRenderNotify(rawBody, secret, Math.floor(now.getTime() / 1000));
  const response = await fetchImpl(notifyUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [renderNotifySignatureHeader]: signature
    },
    body: rawBody,
    redirect: "error",
    signal: AbortSignal.timeout(8_000)
  });
  if (!response.ok) throw new Error(`notify ${response.status}`);
}
