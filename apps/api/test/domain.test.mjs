import test from "node:test";
import assert from "node:assert/strict";
import { assertAccountActive } from "../dist/auth.js";
import { ConflictError, MediaService, ProjectService, RenderService, copyPexelsResult } from "../dist/domain.js";

test("account-state suspended and deletion-pending are denied", () => {
  assert.doesNotThrow(() => assertAccountActive("active"));
  assert.throws(() => assertAccountActive("suspended"));
  assert.throws(() => assertAccountActive("deletion_pending"));
});
test("in-memory delete removes the project for that owner only", () => {
  const service = new ProjectService();
  const project = service.create("owner", { purpose: "Temp", audience: "Team", tone: "Warm" });
  assert.equal(service.delete("other", project.id), false);
  assert.equal(service.get("owner", project.id)?.id, project.id);
  assert.equal(service.delete("owner", project.id), true);
  assert.equal(service.get("owner", project.id), undefined);
  assert.equal(service.delete("owner", project.id), false);
});
test("ownership scopes every project and command", () => {
  const service = new ProjectService();
  const project = service.create("owner", { purpose: "Demo", audience: "Team", tone: "Warm" });
  assert.equal(service.get("other", project.id), undefined);
  const command = { command_id: "once", project_id: project.id, base_revision: 0, client_timestamp: "diagnostic", kind: "select_concept", payload: { concept_id: "direct" } };
  const first = service.command("owner", command);
  assert.equal(service.command("owner", command).revision, first.revision);
  assert.throws(() => service.command("owner", { ...command, command_id: "stale" }), ConflictError);
});
test("exactly three concepts and one selection", () => {
  const service = new ProjectService();
  const project = service.create("owner", { purpose: "Demo", audience: "Team", tone: "Warm" });
  assert.equal(service.concepts("owner", project.id).length, 3);
  assert.equal(service.command("owner", { command_id: "c", project_id: project.id, base_revision: 0, client_timestamp: "", kind: "select_concept", payload: { concept_id: "story" } }).selected_concept_id, "story");
});
test("multi-scene lifecycle is authoritative, ordered, and idempotent", () => {
  const service = new ProjectService();
  const project = service.create("owner", { purpose: "Island mystery", audience: "Viewers", tone: "Tense" });
  const scene = (id, order) => ({
    id,
    order,
    caption: `Beat ${id}`,
    visual_prompt: `remote ocean island beat ${id}`,
    duration_ms: 1500,
    focal_x: 0.5,
    focal_y: 0.5,
    motion: "none",
    audio_level: 1,
    ducking: false
  });
  const replace = {
    command_id: "replace-once",
    project_id: project.id,
    base_revision: 0,
    client_timestamp: "diagnostic",
    kind: "replace_storyboard",
    payload: { scenes: [scene("s1", 0), scene("s3", 1)] }
  };
  const replaced = service.command("owner", replace);
  assert.deepEqual(service.command("owner", replace), replaced);
  const added = service.command("owner", {
    ...replace,
    command_id: "add-middle",
    base_revision: 1,
    kind: "add_scene",
    payload: { scene: scene("s2", 9), at: 1 }
  });
  const removed = service.command("owner", {
    ...replace,
    command_id: "remove-first",
    base_revision: 2,
    kind: "remove_scene",
    payload: { scene_id: "s1" }
  });
  assert.deepEqual(added.scenes.map(({ id }) => id), ["s1", "s2", "s3"]);
  assert.deepEqual(removed.scenes.map(({ id, order }) => ({ id, order })), [
    { id: "s2", order: 0 },
    { id: "s3", order: 1 }
  ]);
  assert.deepEqual(service.get("owner", project.id), removed);
});
test("upload uses declared bounds then detected worker facts", () => {
  const media = new MediaService();
  assert.throws(() => media.admit("o", "p", "text/html", 2));
  assert.equal(media.admit("o", "p", "image/webp", 10).declaredType, "image/webp");
  const admitted = media.admit("o", "p", "video/mp4", 10);
  assert.throws(() => media.complete("other", "p", admitted.id));
  assert.equal(media.complete("o", "p", admitted.id).state, "inspecting");
  assert.equal(media.inspected("o", "p", admitted.id, { type: "image/png", bytes: 10 }).state, "quarantined");
});
test("Pexels attribution persists and remote URL is not object key", () => {
  const record = copyPexelsResult("p", { sourceUrl: "https://videos.pexels.example/v.mp4", creator: "A", attributionUrl: "https://pexels.example/a" });
  assert.equal(record.sourceLabel, "Pexels");
  assert.match(record.objectKey, /^projects\/p\/media\//);
});
test("download is owner-scoped and expires", () => {
  const service = new RenderService();
  const job = service.create("owner", "p", 1);
  assert.throws(() => service.signedDownload("other", job));
  assert.equal(service.signedDownload("owner", job, 0).expiresAt, 300000);
  assert.equal(service.events("owner", job).length, 1);
  assert.equal(service.events("owner", job, "1").length, 0);
  assert.equal(service.cancel("owner", job).state, "cancelled");
});
