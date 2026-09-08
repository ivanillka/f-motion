#!/usr/bin/env node
/**
 * Minimal stdio MCP server for Hermes / Cursor.
 * Tools wrap the same /v1 client as `fmotion` CLI.
 */
import { createInterface } from "node:readline";
import {
  FmotionApiError,
  FmotionClient,
  composeReel,
  draftUrl,
  loadCredentials,
  readMedia,
  webOriginFromEnv
} from "@f-engine/fmotion-cli";

type JsonRpc = {
  jsonrpc: "2.0";
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

const TOOLS = [
  {
    name: "read_media",
    description: "Inspect local image/video files (kind, size, dimensions). Does not upload.",
    inputSchema: {
      type: "object",
      required: ["paths"],
      properties: {
        paths: { type: "array", items: { type: "string" }, description: "Local file paths" }
      }
    }
  },
  {
    name: "compose_reel",
    description: "Create a draft from a short brief and/or local media. Optionally fill Pexels stock and preview-render. Always returns draft_url.",
    inputSchema: {
      type: "object",
      properties: {
        purpose: { type: "string", description: "Brief including the few answered questions" },
        audience: { type: "string" },
        tone: { type: "string" },
        media_paths: { type: "array", items: { type: "string" } },
        concept_id: { type: "string" },
        fill_stock: { type: "boolean", description: "Match Pexels when the user has no files (BYOK)" },
        render: { type: "string", enum: ["preview", "final", "none"], default: "preview" }
      }
    }
  },
  {
    name: "open_draft",
    description: "Return the studio draft URL for selective editing in the app or skill.",
    inputSchema: {
      type: "object",
      required: ["project_id"],
      properties: { project_id: { type: "string" } }
    }
  },
  {
    name: "create_project",
    description: "Create an F-Motion project from a brief purpose string.",
    inputSchema: {
      type: "object",
      required: ["purpose"],
      properties: {
        purpose: { type: "string" },
        audience: { type: "string" },
        tone: { type: "string" }
      }
    }
  },
  {
    name: "run_command",
    description: "Apply a versioned command envelope to a project (select_concept, replace_storyboard, …).",
    inputSchema: {
      type: "object",
      required: ["project_id", "envelope"],
      properties: {
        project_id: { type: "string" },
        envelope: { type: "object" }
      }
    }
  },
  {
    name: "request_render",
    description: "Queue a preview or final render. Consumes host usage units; may return quota_exceeded.",
    inputSchema: {
      type: "object",
      required: ["project_id"],
      properties: {
        project_id: { type: "string" },
        kind: { type: "string", enum: ["preview", "final"], default: "preview" }
      }
    }
  },
  {
    name: "wait_render",
    description: "Wait on SSE progress until the render job reaches a terminal phase.",
    inputSchema: {
      type: "object",
      required: ["job_id"],
      properties: {
        job_id: { type: "string" },
        timeout_seconds: { type: "number" }
      }
    }
  },
  {
    name: "download_render",
    description: "Fetch signed download metadata for a completed render job.",
    inputSchema: {
      type: "object",
      required: ["job_id"],
      properties: { job_id: { type: "string" } }
    }
  },
  {
    name: "usage",
    description: "Return remaining host render_unit balance and costs.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "delete_project",
    description: "Hard-delete a project and its object-storage blobs. Refuse if a render or generation job is still running. Use after a result-only bulk item is downloaded.",
    inputSchema: {
      type: "object",
      required: ["project_id"],
      properties: { project_id: { type: "string" } }
    }
  }
] as const;

async function client(): Promise<FmotionClient> {
  const credentials = await loadCredentials();
  if (!credentials) {
    throw new Error("Set FMOTION_API_KEY (and optional FMOTION_API_ORIGIN) or run `fmotion login`.");
  }
  return new FmotionClient({ apiOrigin: credentials.api_origin, apiKey: credentials.api_key });
}

function textResult(value: unknown) {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    structuredContent: value
  };
}

async function callTool(name: string, args: Record<string, unknown>) {
  switch (name) {
    case "read_media": {
      const paths = Array.isArray(args.paths) ? args.paths.map(String) : [];
      return textResult(await readMedia(paths));
    }
    case "open_draft": {
      const projectId = String(args.project_id || "");
      const projectUrl = draftUrl(projectId, webOriginFromEnv());
      return textResult({ project_id: projectId, draft_url: projectUrl, projectUrl });
    }
  }
  const api = await client();
  switch (name) {
    case "compose_reel": {
      const mediaPaths = Array.isArray(args.media_paths) ? args.media_paths.map(String) : [];
      return textResult(await composeReel(api, {
        purpose: args.purpose ? String(args.purpose) : undefined,
        audience: args.audience ? String(args.audience) : undefined,
        tone: args.tone ? String(args.tone) : undefined,
        mediaPaths,
        conceptId: args.concept_id ? String(args.concept_id) : undefined,
        fillStock: Boolean(args.fill_stock),
        render: args.render === "none" ? "none" : args.render === "final" ? "final" : "preview",
        webOrigin: webOriginFromEnv()
      }));
    }
    case "create_project": {
      const created = await api.createProject({
        purpose: String(args.purpose || ""),
        ...(args.audience ? { audience: String(args.audience) } : {}),
        ...(args.tone ? { tone: String(args.tone) } : {})
      });
      const projectUrl = draftUrl(created.project.id, webOriginFromEnv());
      return textResult({ ...created, draft_url: projectUrl, projectUrl });
    }
    case "run_command":
      return textResult(await api.command(String(args.project_id), args.envelope as Record<string, unknown>));
    case "request_render": {
      const kind = args.kind === "final" ? "final" : "preview";
      return textResult(await api.render(String(args.project_id), kind));
    }
    case "wait_render":
      return textResult(await api.wait(String(args.job_id), {
        timeoutMs: args.timeout_seconds ? Number(args.timeout_seconds) * 1000 : undefined
      }));
    case "download_render":
      return textResult(await api.download(String(args.job_id)));
    case "usage":
      return textResult(await api.usage());
    case "delete_project":
      return textResult(await api.deleteProject(String(args.project_id)));
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function write(message: JsonRpc): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

async function handle(message: JsonRpc): Promise<void> {
  if (message.method === "notifications/initialized" || message.id === undefined || message.id === null) {
    return;
  }
  try {
    switch (message.method) {
      case "initialize":
        write({
          jsonrpc: "2.0",
          id: message.id,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: { name: "fmotion-mcp", version: "0.1.0" }
          }
        });
        return;
      case "ping":
        write({ jsonrpc: "2.0", id: message.id, result: {} });
        return;
      case "tools/list":
        write({ jsonrpc: "2.0", id: message.id, result: { tools: TOOLS } });
        return;
      case "tools/call": {
        const name = String(message.params?.name || "");
        const args = (message.params?.arguments && typeof message.params.arguments === "object"
          ? message.params.arguments
          : {}) as Record<string, unknown>;
        const result = await callTool(name, args);
        write({ jsonrpc: "2.0", id: message.id, result });
        return;
      }
      default:
        write({
          jsonrpc: "2.0",
          id: message.id,
          error: { code: -32601, message: `Method not found: ${message.method}` }
        });
    }
  } catch (error) {
    const data = error instanceof FmotionApiError
      ? { status: error.status, body: error.body }
      : undefined;
    write({
      jsonrpc: "2.0",
      id: message.id,
      error: {
        code: error instanceof FmotionApiError && error.body.type === "quota_exceeded" ? -32001 : -32000,
        message: error instanceof Error ? error.message : String(error),
        data
      }
    });
  }
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of rl) {
  const trimmed = line.trim();
  if (!trimmed) continue;
  let message: JsonRpc;
  try {
    message = JSON.parse(trimmed) as JsonRpc;
  } catch {
    continue;
  }
  await handle(message);
}
