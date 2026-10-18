import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { buildStoryboardDraft } from "../src/api.ts";

const EM_DASH = "\u2014";

/**
 * Blanks out line and block comments while keeping every other character in
 * place, so line numbers still match the source file after stripping.
 */
function withoutComments(source) {
  let visible = "";
  let state = "code";
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];
    if (state === "line") {
      if (char === "\n") {
        state = "code";
        visible += char;
      } else {
        visible += " ";
      }
      index += 1;
      continue;
    }
    if (state === "block") {
      if (char === "*" && next === "/") {
        state = "code";
        visible += "  ";
        index += 2;
        continue;
      }
      visible += char === "\n" ? char : " ";
      index += 1;
      continue;
    }
    if (state === "single" || state === "double" || state === "template") {
      visible += char;
      const quote = state === "single" ? "'" : state === "double" ? '"' : "`";
      if (char === "\\") {
        visible += source[index + 1] ?? "";
        index += 2;
        continue;
      }
      if (char === quote) state = "code";
      index += 1;
      continue;
    }
    if (char === "/" && next === "/") {
      state = "line";
      visible += "  ";
      index += 2;
      continue;
    }
    if (char === "/" && next === "*") {
      state = "block";
      visible += "  ";
      index += 2;
      continue;
    }
    if (char === "'") {
      state = "single";
      visible += char;
      index += 1;
      continue;
    }
    if (char === '"') {
      state = "double";
      visible += char;
      index += 1;
      continue;
    }
    if (char === "`") {
      state = "template";
      visible += char;
      index += 1;
      continue;
    }
    visible += char;
    index += 1;
  }
  return visible;
}

test("the web fallback storyboard writes plain sentence captions", async () => {
  const source = await readFile(new URL("../src/main.tsx", import.meta.url), "utf8");
  // The fallback keeps calling the engine without an architecture. The engine
  // owns the caption wording, so apps/web never copies the request regexes.
  assert.match(source, /buildStoryboardDraft\(brief\.purpose, newCommandId\)/);
  let id = 0;
  const scenes = buildStoryboardDraft(
    "make a short reel about my summer trip",
    () => `fallback-${++id}`
  );
  const captions = scenes.map(({ caption }) => caption).filter(Boolean);
  assert.ok(captions.length >= 1);
  assert.equal(scenes[0].caption, "My summer trip.");
  for (const caption of captions) {
    assert.match(caption, /\.$/u, caption);
    assert.doesNotMatch(caption, /^(?:make|create|build)\b/iu, caption);
  }
});

test("studio source contains no em dashes in user-facing copy", async () => {
  const src = new URL("../src/", import.meta.url);
  // License credits under public/ keep their publisher wording. This scan is
  // the studio source that ships in the app bundle.
  const files = (await readdir(src, { recursive: true }))
    .filter((name) => /\.(?:tsx?|css)$/u.test(name))
    .sort();
  assert.ok(files.length > 0);
  for (const file of files) {
    const source = await readFile(new URL(file, src), "utf8");
    const offenders = withoutComments(source)
      .split("\n")
      .map((text, index) => ({ line: index + 1, text }))
      .filter(({ text }) => text.includes(EM_DASH));
    assert.deepEqual(
      offenders,
      [],
      `${file} has an em dash in user-facing copy: ${offenders.map(({ line, text }) => `${line}: ${text.trim()}`).join(" | ")}`
    );
  }
});
