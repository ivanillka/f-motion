/**
 * After Vite build: SPA lives under /app/, marketing from public/web/ is the site root.
 * Vite already copied public/ → dist/ (including web/). We nest the SPA and lift marketing.
 */
import { mkdir, rename, cp, writeFile, rm, access } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");
const app = resolve(dist, "app");
const web = resolve(dist, "web");

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (!(await exists(resolve(dist, "index.html")))) {
    throw new Error("Missing dist/index.html — run vite build first");
  }
  if (!(await exists(web))) {
    throw new Error("Missing dist/web/ — marketing public/web was not copied");
  }

  await mkdir(app, { recursive: true });
  await rename(resolve(dist, "index.html"), resolve(app, "index.html"));
  if (await exists(resolve(dist, "assets"))) {
    await rename(resolve(dist, "assets"), resolve(app, "assets"));
  }

  // Lift marketing to site root (overwrite nothing critical; SPA already moved)
  await cp(web, dist, { recursive: true });

  // Keep /web/ working via redirects for old links
  await writeFile(
    resolve(dist, "_redirects"),
    [
      "/web / 301",
      "/web/ / 301",
      "/web/* /:splat 301",
      ""
    ].join("\n")
  );

  // Functions only on /api; static marketing + /app SPA otherwise
  await writeFile(
    resolve(dist, "_routes.json"),
    JSON.stringify({ version: 1, include: ["/api/*"], exclude: [] }, null, 2) + "\n"
  );

  console.log("Site root = marketing; studio at /app/; /web/* redirects to /*");
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
