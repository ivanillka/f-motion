import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../../", import.meta.url);

async function read(rel) {
  return readFile(new URL(rel, root), "utf8");
}

test("CMS plugin architecture names hooks and stays a thin adapter", async () => {
  const doc = await read("docs/contracts/cms-plugin.md");
  const recipes = await read("docs/agents/host-recipes.md");
  const host = await read("docs/contracts/host-integration.md");
  const partner = await read("docs/contracts/partner-import.md");
  const started = await read("docs/agents/getting-started.md");
  const stub = await read("plugins/wordpress/fmotion.php");
  const stubReadme = await read("plugins/wordpress/README.md");

  for (const source of [doc, recipes, host, partner, started, stub, stubReadme]) {
    assert.doesNotMatch(source, /\u2014/);
  }

  assert.match(doc, /thin adapter/i);
  assert.match(doc, /not a fork of the engine/);
  assert.match(doc, /POST \/v1\/integrations\/project-imports/);
  assert.match(doc, /render\.complete/);
  assert.match(doc, /### `before_import` \(filter\)/);
  assert.match(doc, /### `after_import` \(action\)/);
  assert.match(doc, /### `reel_ready` \(action\)/);
  assert.match(doc, /Optional: `edit_open` \(filter\)/);
  assert.match(doc, /fmotion_before_import/);
  assert.match(doc, /fmotion_after_import/);
  assert.match(doc, /fmotion_reel_ready/);
  assert.match(doc, /fmotion_edit_open/);
  assert.match(doc, /fmotion\/v1\/notify/);
  assert.match(doc, /hook_fmotion_before_import_alter/);
  assert.match(doc, /hook_fmotion_reel_ready/);
  assert.match(doc, /Shopify/);
  assert.match(doc, /hold social network API tokens/);
  assert.match(doc, /Social API tokens/);
  assert.match(doc, /Immich/);
  assert.match(doc, /Do not iframe/);
  assert.match(doc, /Fotium is a custom gallery host/);
  assert.match(doc, /not the only host/);
  assert.match(doc, /follow-up/i);

  assert.match(recipes, /Four supported ways/);
  assert.match(recipes, /## 4\) CMS plugin \(WordPress first\)/);
  assert.match(recipes, /docs\/contracts\/cms-plugin\.md/);

  assert.match(host, /cms-plugin\.md/);
  assert.match(partner, /cms-plugin\.md/);
  assert.match(started, /CMS plugin architecture/);

  assert.match(stub, /Plugin Name: F-Motion/);
  assert.match(stub, /apply_filters\( 'fmotion_before_import'/);
  assert.match(stub, /do_action\( 'fmotion_after_import'/);
  assert.match(stub, /do_action\( 'fmotion_reel_ready'/);
  assert.match(stub, /apply_filters\( 'fmotion_edit_open'/);
  assert.match(stub, /fmotion\/v1/);
  assert.match(stub, /\/notify/);
  assert.match(stub, /\/import/);
  assert.match(stub, /501/);
  assert.match(stub, /Do not put social API tokens or Immich\/faces here/);
  assert.doesNotMatch(stub, /update_option\s*\(/);

  assert.match(stubReadme, /not\*\* an installable plugin/);
  assert.match(stubReadme, /includes\/class-import\.php/);
  assert.match(stubReadme, /fmotion_reel_ready/);
});
