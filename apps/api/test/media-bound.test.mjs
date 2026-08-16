import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  maximumMediaBytes,
  mediaTypeFromBytes,
  resolveImportedMediaType,
  spoolBoundedBody
} from "../dist/media-storage.js";

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

test("imported media types prefer allowlisted headers and sniff still/video magic", () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const webp = new Uint8Array([
    0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50
  ]);
  const mp4 = new Uint8Array([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
  assert.equal(mediaTypeFromBytes(jpeg), "image/jpeg");
  assert.equal(mediaTypeFromBytes(png), "image/png");
  assert.equal(mediaTypeFromBytes(webp), "image/webp");
  assert.equal(mediaTypeFromBytes(mp4), "video/mp4");
  assert.equal(mediaTypeFromBytes(new Uint8Array([1, 2, 3])), undefined);
  assert.equal(resolveImportedMediaType("image/jpg; charset=binary", new Uint8Array([1])), "image/jpeg");
  assert.equal(resolveImportedMediaType("application/octet-stream", webp), "image/webp");
  assert.throws(() => resolveImportedMediaType("text/html", new Uint8Array([1, 2, 3])), /type rejected/);
});
