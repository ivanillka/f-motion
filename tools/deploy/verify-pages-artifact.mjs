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

export async function verifyPagesArtifact(root = repositoryRoot) {
  const indexPath = resolve(root, "apps/web/dist/index.html");
  const functionPath = resolve(root, "apps/web/functions/api/[[path]].js");

  await requireFile(indexPath, "Pages build entrypoint");
  await requireFile(functionPath, "Pages API Function");

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
