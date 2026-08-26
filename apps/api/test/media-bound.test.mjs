import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  audioTypeFromBytes,
  maximumMediaBytes,
  mediaTypeFromBytes,
  resolveImportedMediaType,
  spoolBoundedBody,
  stillSize
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
  assert.equal(audioTypeFromBytes(new Uint8Array([0x49, 0x44, 0x33])), "audio/mpeg");
  assert.equal(audioTypeFromBytes(new Uint8Array([0xff, 0xfb, 0x90, 0x00])), "audio/mpeg");
  assert.equal(audioTypeFromBytes(new Uint8Array([
    0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45
  ])), "audio/wav");
  assert.equal(audioTypeFromBytes(mp4, "audio/mp4"), "audio/mp4");
  assert.equal(audioTypeFromBytes(mp4), undefined);
  assert.equal(resolveImportedMediaType("image/jpg; charset=binary", new Uint8Array([1])), "image/jpeg");
  assert.equal(resolveImportedMediaType("application/octet-stream", webp), "image/webp");
  assert.throws(() => resolveImportedMediaType("text/html", new Uint8Array([1, 2, 3])), /type rejected/);
});

test("stillSize reads PNG IHDR and WebP VP8X without ffprobe", () => {
  const png = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d,
    0x49, 0x48, 0x44, 0x52, 0, 0, 0x04, 0x00, 0, 0, 0x03, 0x00, 8, 2, 0, 0, 0
  ]);
  assert.deepEqual(stillSize("image/png", png), { width: 1024, height: 768 });
  const webp = new Uint8Array([
    0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
    0x56, 0x50, 0x38, 0x58, 0, 0, 0, 0, 0, 0, 0, 0, 0x3f, 0, 0, 0x2b, 0, 0
  ]);
  assert.deepEqual(stillSize("image/webp", webp), { width: 64, height: 44 });
  const vp8 = new Uint8Array([
    0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
    0x56, 0x50, 0x38, 0x20, 10, 0, 0, 0, 0, 0, 0, 0x9d, 0x01, 0x2a, 2, 0, 3, 0
  ]);
  assert.deepEqual(stillSize("image/webp", vp8), { width: 2, height: 3 });
  assert.deepEqual(stillSize("image/jpeg", vp8), { width: 2, height: 3 });
  assert.equal(stillSize("image/png", new Uint8Array([1, 2, 3])), undefined);
});

test("Mixkit catalog search ranks hip hop and aliases trendy", async () => {
  const {
    musicSearchQuery,
    mixkitTrackById,
    publicMixkitTrack,
    searchMixkitCatalog
  } = await import("../dist/mixkit-music.js");
  const hip = searchMixkitCatalog("hip hop");
  assert.ok(hip.length >= 8);
  assert.ok(hip.some((track) => track.tags.includes("hip hop")));
  const trendy = searchMixkitCatalog("trendy");
  assert.ok(trendy.length >= 8);
  assert.equal(musicSearchQuery("trendy"), musicSearchQuery(""));
  assert.equal(musicSearchQuery("lofi"), "lo-fi");
  assert.equal(mixkitTrackById(999999), undefined);
  assert.ok(mixkitTrackById(hip[0].id));
  assert.match(publicMixkitTrack(hip[0]).previewUrl, /^https:\/\/assets\.mixkit\.co\/music\/\d+\/\d+\.mp3$/);
});

test("importMixkitTrack seals allowlisted MP3 and rejects other origins", async () => {
  const { importMixkitTrack, mixkitTrackById, mixkitAudioUrl } = await import("../dist/mixkit-music.js");
  const { ExternalMediaImportError, sceneMediaView } = await import("../dist/media-storage.js");
  const track = mixkitTrackById(445);
  assert.ok(track);
  const mp3 = Buffer.from("ID3" + "x".repeat(64));
  const inserted = [];
  const store = {
    async put(key, _body, type, bytes) {
      inserted.push({ key, type, bytes });
      return { etag: "etag" };
    },
    async copy() {
      return { etag: "copied", versionId: "v1" };
    }
  };
  const repository = {
    async insert(asset) { this.asset = asset; },
    async markImportedStillReady(_owner, _project, _id, sealed, detected) {
      this.sealed = sealed;
      return { ...this.asset, state: "ready", sealedObjectKey: sealed.objectKey, detected };
    }
  };
  const ready = await importMixkitTrack(
    "owner",
    "project",
    track,
    store,
    repository,
    async () => new Response(mp3, { status: 200, headers: { "content-type": "audio/mpeg" } })
  );
  assert.equal(ready.attribution.source, "Mixkit");
  assert.equal(ready.attribution.title, track.title);
  assert.equal(ready.attribution.previewUrl, mixkitAudioUrl(track.id));
  assert.equal(sceneMediaView(ready).attribution.previewUrl, mixkitAudioUrl(track.id));
  assert.equal(ready.detected.type, "audio/mpeg");
  assert.equal(inserted[0].type, "audio/mpeg");
  const { createHash } = await import("node:crypto");
  assert.equal(repository.sealed.sha256, createHash("sha256").update(mp3).digest("hex"));
  await assert.rejects(
    () => importMixkitTrack(
      "owner",
      "project",
      track,
      store,
      repository,
      async () => {
        const response = new Response(mp3, { status: 200 });
        Object.defineProperty(response, "url", { value: "https://evil.example/x.mp3" });
        return response;
      }
    ),
    (error) => error instanceof ExternalMediaImportError && /origin is not allowed/.test(error.message)
  );
  assert.match(mixkitAudioUrl(445), /445\/445\.mp3$/);
});

test("GET /api/music/search returns Mixkit preview URLs without fetching audio", async () => {
  const { createServer } = await import("node:http");
  const { createTestApp } = await import("../dist/server.js");
  const { ProjectService } = await import("../dist/domain.js");
  const server = createServer(createTestApp({ ownerId: "owner", projects: new ProjectService() }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    const origin = `http://127.0.0.1:${address.port}`;
    const response = await fetch(`${origin}/api/music/search?q=hip+hop`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.ok(body.results.length >= 8);
    assert.match(body.results[0].previewUrl, /^https:\/\/assets\.mixkit\.co\/music\//);
    assert.ok(body.results[0].title);
    assert.ok(body.results[0].artist);
    const unknown = await fetch(`${origin}/api/projects/missing/media/music`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mixkit_id: 1 })
    });
    assert.equal(unknown.status, 503);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
