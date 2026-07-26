import test from "node:test";
import assert from "node:assert/strict";
import { assertAccountActive } from "../dist/auth.js";
import { ConflictError, MediaService, ProjectService, RenderService, copyPexelsResult } from "../dist/domain.js";

test("account-state suspended and deletion-pending are denied", () => {
  assert.doesNotThrow(() => assertAccountActive("active"));
  assert.throws(() => assertAccountActive("suspended"));
  assert.throws(() => assertAccountActive("deletion_pending"));
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
test("upload uses declared bounds then detected worker facts", () => {
  const media = new MediaService();
  assert.throws(() => media.admit("o", "p", "text/html", 2));
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
