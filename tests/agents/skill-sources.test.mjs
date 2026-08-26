import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const skillDir = fileURLToPath(new URL("../../skills/fmotion/", import.meta.url));

function frontmatter(markdown) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(match, "SKILL.md needs YAML frontmatter");
  const fields = {};
  let current;
  for (const line of match[1].split("\n")) {
    if (current && (line.startsWith("  ") || line.startsWith("\t"))) {
      fields[current] += ` ${line.trim()}`;
      continue;
    }
    const cut = line.indexOf(":");
    if (cut === -1) continue;
    const key = line.slice(0, cut).trim();
    if (!key || key.startsWith("-")) continue;
    current = key;
    fields[key] = line.slice(cut + 1).trim().replace(/^[>|]+\s*/, "").replace(/^["']|["']$/g, "");
  }
  return fields;
}

test("fmotion skill is ClawHub-shaped and sources stay in lockstep", async () => {
  const skill = await readFile(new URL("SKILL.md", `file://${skillDir}`), "utf8");
  const sources = JSON.parse(await readFile(new URL("sources.json", `file://${skillDir}`), "utf8"));
  const meta = frontmatter(skill);
  assert.equal(meta.name, "fmotion");
  assert.ok(meta.description.length > 20);
  assert.match(meta.version, /^\d+\.\d+\.\d+$/);
  assert.equal(sources.project, "fmotion-skill-distribution");
  assert.equal(sources.skill, "fmotion");
  assert.equal(sources.version, meta.version);
  assert.equal(sources.canonical_path, "skills/fmotion");
  const allowed = new Set(["live", "ready_to_publish", "follows_clawhub", "pending"]);
  const ids = sources.sources.map((row) => row.id);
  for (const required of [
    "repo",
    "clawhub",
    "skills-sh",
    "cursor-repo",
    "cursor-marketplace",
    "cursor-directory",
    "hermes-mcp",
    "npm-packages"
  ]) {
    assert.ok(ids.includes(required), `missing source ${required}`);
  }
  for (const row of sources.sources) {
    assert.ok(row.id && row.name && row.update, `${row.id || "source"} is incomplete`);
    assert.ok(allowed.has(row.status), `${row.id} has unknown status ${row.status}`);
    if (row.status === "live" && row.id !== "hermes-mcp") {
      assert.equal(row.published_version, sources.version, `${row.id} published_version must match skill version`);
    }
  }
  const clawhub = sources.sources.find((row) => row.id === "clawhub");
  assert.equal(clawhub.slug, "fmotion");
  assert.match(skill, /Ask \*\*at most four\*\*/);
  assert.match(skill, /Chat only/);
  assert.match(skill, /FMOTION_API_KEY/);
  assert.match(skill, /## Example/);
  assert.doesNotMatch(skill, /^license:/im);
});
