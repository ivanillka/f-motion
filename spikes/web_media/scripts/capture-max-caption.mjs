import { writeFile } from "node:fs/promises";

const target = (await fetch("http://127.0.0.1:9223/json").then(response => response.json()))
  .find(item => item.type === "page" && item.url.startsWith("http://127.0.0.1:4173"));
if (!target) throw new Error("spike target missing");
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let id = 0;
const pending = new Map();
socket.onmessage = ({ data }) => {
  const message = JSON.parse(data);
  if (!message.id) return;
  pending.get(message.id)(message.result);
  pending.delete(message.id);
};
const call = (method, params = {}) => new Promise(resolve => {
  const request = ++id;
  pending.set(request, resolve);
  socket.send(JSON.stringify({ id: request, method, params }));
});
await call("Emulation.setDeviceMetricsOverride", { width: 320, height: 900, deviceScaleFactor: 1, mobile: true });
await call("Runtime.evaluate", { expression: `const area=document.querySelector("textarea"); const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set; setter.call(area,"Maximum captions remain readable and safely inside the video overlay on small screens."); area.dispatchEvent(new Event("input",{bubbles:true}));` });
await new Promise(resolve => setTimeout(resolve, 300));
const image = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
await writeFile("measurements/mobile-320-max-caption.png", Buffer.from(image.data, "base64"));
socket.close();
