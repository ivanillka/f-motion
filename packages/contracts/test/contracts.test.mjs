import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { acceptsFixture } from "../dist/index.js";

const fixture = async (name) => JSON.parse(await readFile(new URL(`../fixtures/${name}`, import.meta.url)));

test("additive v1 fields are tolerated", async () => assert.equal(acceptsFixture(await fixture("project-v1.json")), true));
test("breaking fixture version is rejected", async () => assert.equal(acceptsFixture(await fixture("project-v2-breaking.json")), false));
