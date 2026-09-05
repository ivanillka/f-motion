import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("frontend-design skill is pinned to DESIGN.md and stays off the reel skill", async () => {
  const skill = await readFile(new URL("../../.cursor/skills/frontend-design/SKILL.md", import.meta.url), "utf8");
  assert.match(skill, /^name:\s*frontend-design/m);
  assert.match(skill, /DESIGN\.md/);
  assert.match(skill, /9:16/);
  assert.match(skill, /lazy-load App/);
  assert.doesNotMatch(skill, /Fotium/i);
  const compose = await readFile(new URL("../../skills/fmotion/SKILL.md", import.meta.url), "utf8");
  assert.doesNotMatch(compose, /frontend-design/);
});
