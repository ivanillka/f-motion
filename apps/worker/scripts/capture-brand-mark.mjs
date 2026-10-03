// Regenerates apps/worker/assets/brand/f-motion-mark.webm from the landing lockup.
// Chrome + ffmpeg only. The studio iframe plays mark.html live; the reel burns this loop.
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFile } from "node:fs/promises";

const html = fileURLToPath(new URL("../../web/public/brand/mark.html", import.meta.url));
const markCss = await readFile(html, "utf8");
const width = Number(markCss.match(/--lock-w:\s*(\d+)px/)?.[1]);
const height = Number(markCss.match(/--lock-h:\s*(\d+)px/)?.[1]);
if (!width || !height) throw new Error("mark.html lockup size missing");
const fps = 12;
const seconds = 36;
const frames = fps * seconds;
const output = fileURLToPath(new URL("../assets/brand/f-motion-mark.webm", import.meta.url));
const port = 9341;

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "inherit", "inherit"] });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)));
  });
}

const directory = await mkdtemp(join(tmpdir(), "fmotion-mark-"));
const chrome = spawn("/usr/local/bin/google-chrome", [
  "--headless=new",
  "--hide-scrollbars",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-background-networking",
  "--disable-dev-shm-usage",
  "--allow-file-access-from-files",
  "--use-gl=angle",
  "--use-angle=swiftshader",
  "--enable-unsafe-swiftshader",
  "--ignore-gpu-blocklist",
  "--force-device-scale-factor=1",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${join(directory, "chrome")}`,
  `--window-size=${width},${height}`,
  `file://${html}?t=0`
], { stdio: ["ignore", "ignore", "ignore"] });

try {
  let page;
  for (let i = 0; i < 50; i += 1) {
    try {
      const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then((res) => res.json());
      page = pages.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
      if (page) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (!page) throw new Error("chrome debug port never came up");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  let next = 0;
  const pending = new Map();
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const waiter = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
    else waiter.resolve(message.result);
  });
  const call = (method, params = {}) => {
    const id = ++next;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  };
  await call("Page.enable");
  await call("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });
  await call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  await call("Runtime.evaluate", {
    expression: "new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))",
    awaitPromise: true
  });
  for (let index = 0; index < frames; index += 1) {
    const t = (index / fps).toFixed(4);
    await call("Runtime.evaluate", {
      expression: `document.documentElement.classList.add('is-frame'); document.documentElement.style.setProperty('--frame', '${t}');`
    });
    await call("Runtime.evaluate", {
      expression: "new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))",
      awaitPromise: true
    });
    const shot = await call("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
    await writeFile(join(directory, `frame-${String(index + 1).padStart(4, "0")}.png`), Buffer.from(shot.data, "base64"));
    if (index % 36 === 0) console.log(`frame ${index + 1}/${frames}`);
  }
  ws.close();
  await mkdir(join(output, ".."), { recursive: true });
  await run("ffmpeg", [
    "-y",
    "-framerate", String(fps),
    "-i", join(directory, "frame-%04d.png"),
    "-an",
    "-c:v", "libvpx-vp9",
    "-pix_fmt", "yuva420p",
    "-auto-alt-ref", "0",
    "-b:v", "0",
    "-crf", "32",
    "-row-mt", "1",
    output
  ]);
  console.log(output);
} finally {
  chrome.kill("SIGKILL");
  await rm(directory, { recursive: true, force: true });
}
