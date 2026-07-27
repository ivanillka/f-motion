import test from "node:test";
import assert from "node:assert/strict";
import { maximumMediaBytes, readBoundedBody } from "../dist/media-storage.js";

function streamResponse(chunks, headers = {}) {
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    }
  }), { headers });
}

test("readBoundedBody rejects oversized content-length before reading", async () => {
  const response = new Response(null, { headers: { "content-length": String(maximumMediaBytes + 1) } });
  await assert.rejects(() => readBoundedBody(response, maximumMediaBytes), /Pexels media rejected/);
});

test("readBoundedBody aborts once the stream exceeds the ceiling", async () => {
  const chunk = new Uint8Array(1024).fill(7);
  const chunks = Array.from({ length: 8 }, () => chunk);
  await assert.rejects(
    () => readBoundedBody(streamResponse(chunks), 3000),
    /Pexels media rejected/
  );
});

test("readBoundedBody returns the concatenated body under the ceiling", async () => {
  const bytes = await readBoundedBody(streamResponse([
    new Uint8Array([1, 2]),
    new Uint8Array([3])
  ]), 10);
  assert.deepEqual([...bytes], [1, 2, 3]);
});
