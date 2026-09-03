/**
 * After Vite build: SPA-at-root (f-motion.com) or legacy static marketing + /app studio.
 */
import { writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");

async function writePagesMeta() {
  await writeFile(
    resolve(dist, "_redirects"),
    [
      "/web/assets/* /web/assets/:splat 200",
      "/web/fonts/* /web/fonts/:splat 200",
      "/web/vendor/* /web/vendor/:splat 200",
      "/web / 301",
      "/web/ / 301",
      "/web/* /:splat 301",
      "/app /studio 301",
      "/app/ /studio 301",
      "/app/* /studio/:splat 301",
      ""
    ].join("\n")
  );
  await writeFile(
    resolve(dist, "_routes.json"),
    `${JSON.stringify({ version: 1, include: ["/api/*"], exclude: [] }, null, 2)}\n`
  );
}

async function main() {
  if (process.env.VITE_SITE_AT_ROOT === "1") {
    await writePagesMeta();
    console.log("SPA at site root; studio at /studio; legacy /app → /studio");
    return;
  }
  await import("./promote-marketing-root.mjs");
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
