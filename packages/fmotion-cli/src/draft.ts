export function draftUrl(projectId: string, webOrigin?: string): string {
  const origin = (webOrigin || "").trim();
  if (!origin) return `/app/?project=${encodeURIComponent(projectId)}`;
  const url = new URL("/app/", origin.endsWith("/") ? origin : `${origin}/`);
  url.searchParams.set("project", projectId);
  return url.toString();
}

export function webOriginFromEnv(env: Record<string, string | undefined> = process.env): string | undefined {
  const raw = env.FMOTION_WEB_ORIGIN?.trim() || env.FENGINE_WEB_ORIGIN?.trim();
  return raw || undefined;
}
