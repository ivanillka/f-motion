import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { draftUrl, purposeFromMedia, readMedia } from "../dist/index.js";

const png1x1 = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000a49444154789c6360000000020001e221bc330000000049454e44ae426082",
  "hex"
);

test("read_media sniffs a PNG and draft URLs stay on /app/", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fmotion-media-"));
  const path = join(directory, "still.png");
  await writeFile(path, png1x1);
  const [item] = await readMedia([path]);
  assert.equal(item.kind, "image");
  assert.equal(item.mime, "image/png");
  assert.equal(item.width, 1);
  assert.equal(item.height, 1);
  assert.equal(item.orientation, "square");
  assert.equal(purposeFromMedia([item]), "Video from 1 photo");
  assert.equal(
    draftUrl("proj-1", "https://f-motion.example"),
    "https://f-motion.example/app/?project=proj-1"
  );
});
