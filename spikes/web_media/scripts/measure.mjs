import { mkdir, writeFile } from "node:fs/promises";

const endpoint = "http://127.0.0.1:9223";
const targets = await fetch(`${endpoint}/json`).then(response => response.json());
const matches = targets.filter(target => target.type === "page" && target.url.startsWith("http://127.0.0.1:4173"));
if (matches.length !== 1) throw new Error(`expected one spike target, found ${matches.length}`);
const socket = new WebSocket(matches[0].webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
let nextId = 0;
const pending = new Map();
socket.addEventListener("message", ({ data }) => {
  const message = JSON.parse(data);
  if (!message.id) return;
  const handler = pending.get(message.id);
  pending.delete(message.id);
  message.error ? handler.reject(new Error(message.error.message)) : handler.resolve(message.result);
});
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expression => (await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result.value;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
await call("Page.enable");
await call("Runtime.enable");
await call("Emulation.setFocusEmulationEnabled", { enabled: true });
await call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
const visibility = await evaluate("document.visibilityState");
if (visibility !== "visible") throw new Error(`target is ${visibility}`);

const startups = [];
for (let index = 0; index < 3; index++) {
  await call("Network.clearBrowserCache");
  await call("Page.reload", { ignoreCache: true });
  for (let tries = 0; tries < 100; tries++) {
    await wait(100);
    const startup = await evaluate("window.__fmotion?.metrics.startup || 0");
    if (startup) { startups.push(startup); break; }
  }
  if (startups.length !== index + 1) throw new Error("cold load failed to initialize");
}
const expectedDraft = {
  selected: "green",
  order: ["green", "purple"],
  caption: "Draft restore proves every editor value.",
  focalX: 0.75,
  focalY: -0.6,
  volume: 0.35,
  ducking: false,
};
await evaluate(`localStorage.setItem("fmotion-draft", ${JSON.stringify(JSON.stringify(expectedDraft))})`);
await call("Page.reload");
for (let tries = 0; tries < 100; tries++) {
  await wait(100);
  if (await evaluate("Boolean(window.__fmotion?.snapshot)")) break;
}
const restoredDraft = await evaluate("window.__fmotion.snapshot().draft");
if (JSON.stringify(restoredDraft) !== JSON.stringify(expectedDraft)) {
  throw new Error(`draft restore mismatch: ${JSON.stringify(restoredDraft)}`);
}
for (let index = 0; index < 20; index++) { await evaluate("window.__fmotion.interact()"); await wait(40); }
for (let index = 0; index < 20; index++) { await evaluate(`window.__fmotion.seek(${(index % 15) / 5})`); await wait(80); }
for (let index = 0; index < 4; index++) {
  await evaluate(`document.querySelectorAll("button")[2].click()`);
  await wait(100);
}
await evaluate(`[...document.querySelectorAll("button")].find(button => button.textContent === "Mock upload").click()`);
await wait(600);
const failedAt = await evaluate("window.__fmotion.snapshot().upload.progress");
if (failedAt !== 40) throw new Error(`upload did not fail at 40: ${failedAt}`);
await evaluate(`[...document.querySelectorAll("button")].find(button => button.textContent === "Retry from 40%").click()`);
await wait(600);
const completedAt = await evaluate("window.__fmotion.snapshot().upload.progress");
if (completedAt !== 100) throw new Error(`upload did not complete at 100: ${completedAt}`);
await evaluate(`document.querySelector("video").play()`);
await wait(300_000);
const metrics = await evaluate("window.__fmotion.metrics");
const snapshot = await evaluate("window.__fmotion.snapshot()");
const heap = await call("Runtime.getHeapUsage");
await mkdir("measurements", { recursive: true });
await call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
await wait(500);
const desktop = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
await writeFile("measurements/desktop-1440.png", Buffer.from(desktop.data, "base64"));
await call("Emulation.setDeviceMetricsOverride", { width: 320, height: 900, deviceScaleFactor: 1, mobile: true });
await wait(500);
const mobileOverflow = await evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth");
const mobile = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
await writeFile("measurements/mobile-320.png", Buffer.from(mobile.data, "base64"));
const result = { browserTargets: matches.length, visibility, startups, restoredDraft, metrics, snapshot, heap, mobileOverflow, completedAt: new Date().toISOString() };
await writeFile("measurements/results.json", JSON.stringify(result, null, 2));
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
socket.close();
