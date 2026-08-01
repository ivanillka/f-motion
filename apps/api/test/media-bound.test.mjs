import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { maximumMediaBytes, spoolBoundedBody } from "../dist/media-storage.js";

function streamResponse(chunks, headers = {}) {
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    }
  }), { headers });
}

test("spoolBoundedBody enforces declared and streamed limits without combining chunks", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fengine-spool-test-"));
  try {
    await assert.rejects(
      () => spoolBoundedBody(
        new Response(null, { headers: { "content-length": String(maximumMediaBytes + 1) } }),
        join(directory, "declared"),
        maximumMediaBytes
      ),
      /Pexels media rejected/
    );

    const chunk = new Uint8Array(1024).fill(7);
    await assert.rejects(
      () => spoolBoundedBody(
        streamResponse(Array.from({ length: 8 }, () => chunk)),
        join(directory, "streamed"),
        3000
      ),
      /Pexels media rejected/
    );

    const destination = join(directory, "valid");
    assert.equal(await spoolBoundedBody(streamResponse([
      new Uint8Array([1, 2]),
      new Uint8Array([3])
    ]), destination, 10), 3);
    assert.deepEqual([...await readFile(destination)], [1, 2, 3]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("spoolBoundedBody rejects empty and provider-aborted bodies", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fengine-spool-test-"));
  try {
    await assert.rejects(
      () => spoolBoundedBody(streamResponse([]), join(directory, "empty"), 10),
      /Pexels media rejected/
    );
    const aborted = new Response(new ReadableStream({
      start(controller) { controller.error(new Error("provider aborted")); }
    }));
    await assert.rejects(
      () => spoolBoundedBody(aborted, join(directory, "aborted"), 10),
      /provider aborted/
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
