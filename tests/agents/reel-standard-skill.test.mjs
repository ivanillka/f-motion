import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const EM_DASH = "\u2014";
const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("fmotion skill teaches the reel standard and checks before render", async () => {
  const skill = await read("skills/fmotion/SKILL.md");
  const standard = await read("skills/fmotion/references/reel-standard.md");
  const captions = await read("skills/fmotion/references/captions.md");

  assert.match(skill, /fmotion check/);
  assert.match(skill, /GET \/v1\/projects\/\{id\}\/check/);
  assert.match(skill, /after compose and before `request_render`/);
  assert.match(skill, /1\.00 to 1\.06/);
  assert.match(skill, /references\/reel-standard\.md/);

  assert.match(standard, /1\.00 to 1\.06/);
  assert.match(standard, /6% safe inset/);
  assert.match(standard, /sentence case/i);
  assert.match(standard, /spoken shot lasts as long as its voice take/i);
  assert.match(standard, /preview must match the export/i);
  assert.match(standard, /No paid FAL or Kokoro call unless the user already confirmed/);

  for (const text of [skill, standard, captions]) {
    assert.doesNotMatch(text, new RegExp(EM_DASH));
    assert.doesNotMatch(text, /Fotium/i);
  }
});
