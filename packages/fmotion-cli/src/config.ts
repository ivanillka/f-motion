import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export type FmotionCredentials = {
  api_origin: string;
  api_key: string;
};

export function credentialsPath(home = homedir()): string {
  return join(home, ".fmotion", "credentials");
}

export async function loadCredentials(
  env: Record<string, string | undefined> = process.env,
  home = homedir()
): Promise<FmotionCredentials | undefined> {
  const fromEnvOrigin = env.FMOTION_API_ORIGIN?.trim() || env.FENGINE_API_ORIGIN?.trim();
  const fromEnvKey = env.FMOTION_API_KEY?.trim();
  if (fromEnvKey) {
    return {
      api_origin: (fromEnvOrigin || "http://127.0.0.1:3000").replace(/\/$/, ""),
      api_key: fromEnvKey
    };
  }
  try {
    const raw = await readFile(credentialsPath(home), "utf8");
    const parsed = JSON.parse(raw) as Partial<FmotionCredentials>;
    if (typeof parsed.api_key !== "string" || !parsed.api_key.startsWith("fm_")) return undefined;
    const origin = typeof parsed.api_origin === "string" && parsed.api_origin
      ? parsed.api_origin
      : "http://127.0.0.1:3000";
    return { api_origin: origin.replace(/\/$/, ""), api_key: parsed.api_key };
  } catch {
    return undefined;
  }
}

export async function saveCredentials(
  credentials: FmotionCredentials,
  home = homedir()
): Promise<string> {
  if (!credentials.api_key.startsWith("fm_")) {
    throw new Error("API key must start with fm_");
  }
  const dir = join(home, ".fmotion");
  await mkdir(dir, { mode: 0o700, recursive: true });
  const path = credentialsPath(home);
  const body = JSON.stringify({
    api_origin: credentials.api_origin.replace(/\/$/, ""),
    api_key: credentials.api_key
  }, null, 2) + "\n";
  await writeFile(path, body, { mode: 0o600 });
  await chmod(path, 0o600);
  return path;
}
