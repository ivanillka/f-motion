/**
 * After Vite build: SPA owns /, /self-host, /hosted, /studio.
 * Keep legal pages from public/web/ and send /app to /studio.
 */
import { copyFile, writeFile, access } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");

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

  // Cloudflare Pages Pretty URLs 308 /index.html → /. A 200 rewrite to
  // /index.html therefore bounces /studio (and friends) to /. Copy the SPA
  // shell to the pretty-URL filenames so those paths stay 200.
  const spa = resolve(dist, "index.html");
  for (const page of ["self-host", "hosted", "studio"]) {
    await copyFile(spa, resolve(dist, `${page}.html`));
  }

  await writeFile(
    resolve(dist, "_redirects"),
    [
      "/app /studio 301",
      "/app/ /studio 301",
      "/app/* /studio 301",
      "/web / 301",
      "/web/ / 301",
      "/web/index.html / 301",
      "/web/integrate.html /self-host 301",
      ""
    ].join("\n")
  );

  await writeFile(
    resolve(dist, "_routes.json"),
    JSON.stringify({ version: 1, include: ["/api/*"], exclude: [] }, null, 2) + "\n"
  );

  console.log("Site root = SPA marketing; studio at /studio; /app redirects to /studio");
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
