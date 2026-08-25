export type ApiErrorBody = {
  type?: string;
  message?: string;
  [key: string]: unknown;
};

export class FmotionApiError extends Error {
  readonly status: number;
  readonly body: ApiErrorBody;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message || body.type || `HTTP ${status}`);
    this.status = status;
    this.body = body;
  }
}

export type ProjectView = {
  id: string;
  revision: number;
  brief?: { purpose?: string; audience?: string; tone?: string };
  selected_concept_id?: string;
  scenes: Array<{
    id: string;
    order: number;
    duration_ms: number;
    media_id?: string;
    caption?: string;
    visual_prompt?: string;
    [key: string]: unknown;
  }>;
};

export type ConceptView = { id: string; title?: string };

export type FmotionClientOptions = {
  apiOrigin: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
  putImpl?: typeof fetch;
};

export class FmotionClient {
  readonly apiOrigin: string;
  readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly putImpl: typeof fetch;

  constructor(options: FmotionClientOptions) {
    this.apiOrigin = options.apiOrigin.replace(/\/$/, "");
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.putImpl = options.putImpl ?? options.fetchImpl ?? fetch;
  }

  commandEnvelope(
    projectId: string,
    revision: number,
    kind: string,
    payload: Record<string, unknown>
  ): Record<string, unknown> {
    return {
      command_id: crypto.randomUUID(),
      project_id: projectId,
      base_revision: revision,
      client_timestamp: new Date().toISOString(),
      kind,
      payload
    };
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await this.fetchImpl(`${this.apiOrigin}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        ...(body !== undefined ? { "content-type": "application/json" } : {})
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    let parsed: unknown = undefined;
    if (text) {
      try { parsed = JSON.parse(text); }
      catch { parsed = { message: text }; }
    }
    if (!response.ok) {
      throw new FmotionApiError(
        response.status,
        (parsed && typeof parsed === "object" ? parsed : { message: text }) as ApiErrorBody
      );
    }
    return parsed as T;
  }

  usage() {
    return this.request<{
      unit: string;
      balance: number;
      free_grant: number;
      costs: { preview: number; final: number };
    }>("GET", "/v1/me/usage");
  }

  listProjects() {
    return this.request<{ projects: Array<{ id: string; revision: number; brief: unknown }> }>(
      "GET",
      "/v1/projects"
    );
  }

  createProject(brief: { purpose: string; audience?: string; tone?: string }) {
    return this.request<{ project: ProjectView; concepts?: ConceptView[] }>(
      "POST",
      "/v1/projects",
      brief
    );
  }

  getProject(projectId: string) {
    return this.request<{ project: ProjectView; concepts?: ConceptView[] }>("GET", `/v1/projects/${projectId}`);
  }

  command(projectId: string, envelope: Record<string, unknown>) {
    return this.request<ProjectView>("POST", `/v1/projects/${projectId}/commands`, envelope);
  }

  admitUpload(projectId: string, declaration: { content_type: string; bytes: number }) {
    return this.request<{ asset_id: string; upload_url: string; method?: string; expires_in_seconds?: number }>(
      "POST",
      `/v1/projects/${projectId}/media/uploads`,
      declaration
    );
  }

  completeUpload(projectId: string, assetId: string) {
    return this.request<{ asset_id?: string; state?: string; id?: string; detected?: { duration_ms?: number } }>(
      "POST",
      `/v1/projects/${projectId}/media/${assetId}/complete`
    );
  }

  getMedia(projectId: string, assetId: string) {
    return this.request<{
      id: string;
      state: string;
      detected?: { duration_ms?: number };
    }>("GET", `/v1/projects/${projectId}/media/${assetId}`);
  }

  fillStock(projectId: string) {
    return this.request<{
      results: Array<{ scene_id: string; state: string; asset?: { id: string } }>;
    }>("POST", `/v1/projects/${projectId}/media/pexels/storyboard`, {});
  }

  async putUpload(uploadUrl: string, body: Buffer, contentType: string): Promise<void> {
    const response = await this.putImpl(uploadUrl, {
      method: "PUT",
      headers: { "content-type": contentType },
      body
    });
    if (!response.ok) {
      throw new FmotionApiError(response.status, { type: "upstream", message: "upload put failed" });
    }
  }

  render(projectId: string, kind: "preview" | "final") {
    return this.request<{
      job_id: string;
      project_id: string;
      revision: number;
      kind: string;
      state: string;
    }>("POST", `/v1/projects/${projectId}/render`, { kind });
  }

  async wait(jobId: string, options: { timeoutMs?: number } = {}): Promise<{
    job_id: string;
    phase: string;
    percent: number;
  }> {
    const timeoutMs = options.timeoutMs ?? 15 * 60_000;
    const deadline = Date.now() + timeoutMs;
    const response = await this.fetchImpl(`${this.apiOrigin}/v1/render-jobs/${jobId}/events`, {
      headers: { authorization: `Bearer ${this.apiKey}`, accept: "text/event-stream" }
    });
    if (!response.ok || !response.body) {
      const text = await response.text();
      let parsed: ApiErrorBody = { message: text };
      try { parsed = JSON.parse(text) as ApiErrorBody; } catch { /* keep */ }
      throw new FmotionApiError(response.status, parsed);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let last = { job_id: jobId, phase: "queued", percent: 0 };
    const terminal = new Set(["complete", "cancelled", "failed"]);
    while (Date.now() < deadline) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split("\n\n");
      buffer = chunks.pop() ?? "";
      for (const chunk of chunks) {
        const dataLine = chunk.split("\n").find((line) => line.startsWith("data: "));
        if (!dataLine) continue;
        const data = JSON.parse(dataLine.slice(6)) as {
          job_id?: string;
          phase?: string;
          percent?: number;
        };
        last = {
          job_id: data.job_id || jobId,
          phase: data.phase || last.phase,
          percent: typeof data.percent === "number" ? data.percent : last.percent
        };
        if (terminal.has(last.phase)) {
          await reader.cancel().catch(() => undefined);
          return last;
        }
      }
    }
    await reader.cancel().catch(() => undefined);
    throw new FmotionApiError(504, { type: "timeout", message: "render wait timed out", ...last });
  }

  download(jobId: string) {
    return this.request<{
      url: string;
      expires_at: string;
      kind: string;
      stale: boolean;
      metadata: Record<string, unknown>;
    }>("GET", `/v1/render-jobs/${jobId}/download`);
  }
}

export { loadCredentials, saveCredentials, credentialsPath, type FmotionCredentials } from "./config.js";
