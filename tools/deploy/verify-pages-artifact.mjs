import { readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

async function requireFile(path, label) {
  let details;
  try {
    details = await stat(path);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(`Missing ${label}: ${path}`);
    }
    throw error;
  }

  if (!details.isFile()) {
    throw new Error(`${label} is not a file: ${path}`);
  }
}

function studioScriptPath(appDir, src) {
  const cleaned = src.split("?")[0].split("#")[0];
  if (cleaned.startsWith("/app/")) return resolve(appDir, cleaned.slice("/app/".length));
  if (!cleaned.startsWith("/")) return resolve(appDir, cleaned);
  throw new Error(`Studio entry script is outside /app/: ${src}`);
}

/** The public /app entry must load the studio, not a compiled coming-soon gate. */
export async function verifyStudioEntry(root = repositoryRoot) {
  const appDir = resolve(root, "apps/web/dist/app");
  const appIndex = resolve(appDir, "index.html");
  await requireFile(appIndex, "Studio entry");
  const html = await readFile(appIndex, "utf8");
  const src = html.match(/<script type="module"[^>]*\ssrc="([^"]+)"/)?.[1];
  if (!src) throw new Error("Studio entry does not load a module script");
  const scriptPath = studioScriptPath(appDir, src);
  await requireFile(scriptPath, "Studio script");
  const script = await readFile(scriptPath, "utf8");
  if (script.includes("Coming soon on f-motion.com.")) {
    throw new Error("Studio entry renders Coming soon instead of the studio");
  }
  const mainImport = script.match(/import\((?:"|')(\.\/main-[^"']+)(?:"|')/);
  const applicationPath = mainImport
    ? resolve(dirname(scriptPath), mainImport[1])
    : scriptPath;
  if (mainImport) await requireFile(applicationPath, "Studio application");
  const application = applicationPath === scriptPath ? script : await readFile(applicationPath, "utf8");
  if (!application.includes("Email me a magic link") || !application.includes("Reel 9:16")) {
    throw new Error("Studio application is missing sign-in or Create controls");
  }
  return { appIndex, scriptPath, applicationPath };
}

export async function verifyPagesArtifact(root = repositoryRoot) {
  const indexPath = resolve(root, "apps/web/dist/index.html");
  const functionPath = resolve(root, "apps/web/functions/api/[[path]].js");

  await requireFile(indexPath, "Pages build entrypoint");
  await requireFile(functionPath, "Pages API Function");
  await verifyStudioEntry(root);

  const source = await readFile(functionPath, "utf8");
  const exportsOnRequest = /\bexport\s+(?:async\s+)?function\s+onRequest\b/.test(source)
    || /\bexport\s+(?:const|let|var)\s+onRequest\b/.test(source)
    || /\bexport\s*\{[^}]*\bonRequest\b[^}]*\}/s.test(source);
  if (!exportsOnRequest) {
    throw new Error(`Pages API Function does not export onRequest: ${functionPath}`);
  }

  return { indexPath, functionPath };
}

async function main() {
  const result = await verifyPagesArtifact();
  console.log(`Verified Pages build entrypoint: ${result.indexPath}`);
  console.log(`Verified Pages API Function: ${result.functionPath}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
