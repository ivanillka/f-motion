import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// The studio records voice-over with getUserMedia. Until it named this origin,
// microphone=() disabled the microphone for every origin, the studio included.
const POLICY = "camera=(), microphone=(self), geolocation=(), payment=()";

const POLICY_FILES = {
  pages: new URL("../../web/public/_headers", import.meta.url),
  hetzner: new URL("../../../deploy/hetzner/nginx.conf", import.meta.url),
  vps: new URL("../../../deploy/vps/nginx.conf", import.meta.url)
};

function policyFromHeader(text) {
  const line = text.split("\n").find((row) => row.includes("Permissions-Policy:"));
  assert.ok(line, "Pages Permissions-Policy header");
  return line.replace(/^.*Permissions-Policy:\s*/u, "").trim();
}

function policyFromNginx(text) {
  const match = /add_header Permissions-Policy "([^"]+)" always;/u.exec(text);
  assert.ok(match, "nginx Permissions-Policy header");
  return match[1];
}

/** Every shipped policy, keyed by where it is served from. */
async function shippedPolicies() {
  const [headers, hetzner, vps] = await Promise.all([
    readFile(POLICY_FILES.pages, "utf8"),
    readFile(POLICY_FILES.hetzner, "utf8"),
    readFile(POLICY_FILES.vps, "utf8")
  ]);
  return {
    pages: policyFromHeader(headers),
    hetzner: policyFromNginx(hetzner),
    vps: policyFromNginx(vps)
  };
}

/** The allowlist of one feature, as written: "()" or "(self)" or "*". */
function allowlist(policy, feature) {
  const part = policy.split(",").map((piece) => piece.trim()).find((piece) => piece.startsWith(`${feature}=`));
  assert.ok(part, `${feature} directive`);
  const value = part.slice(feature.length + 1).trim();
  assert.match(value, /^\((?:[^)]*)\)$/u, `${feature} allowlist reads ${value}`);
  return value.slice(1, -1).split(/\s+/u).filter(Boolean);
}

test("Pages and both nginx configs send one Permissions-Policy", async () => {
  const policies = await shippedPolicies();
  for (const [owner, value] of Object.entries(policies)) {
    assert.equal(value, POLICY, `${owner} Permissions-Policy drifted`);
  }
});

test("the microphone allowlist is this origin and nothing else", async () => {
  const policies = await shippedPolicies();
  for (const [owner, policy] of Object.entries(policies)) {
    // A wildcard or an outside origin would either open the mic to every frame
    // or fail closed, which is the bug this policy fixes.
    assert.doesNotMatch(policy, /\*/u, `${owner} uses a wildcard`);
    assert.deepEqual(allowlist(policy, "microphone"), ["self"], owner);
    for (const feature of ["camera", "geolocation", "payment"]) {
      assert.deepEqual(allowlist(policy, feature), [], `${owner} loosened ${feature}`);
    }
  }
});

test("nginx keeps both server level headers instead of dropping one", async () => {
  // add_header is inherited only when the inner level adds none, so every
  // add_header has to stay at the server level (two space indent) for the CSP
  // and the Permissions-Policy to reach the same responses.
  for (const [owner, file] of [["hetzner", POLICY_FILES.hetzner], ["vps", POLICY_FILES.vps]]) {
    const text = await readFile(file, "utf8");
    const headers = text.split("\n")
      .filter((line) => /^\s*add_header /u.test(line))
      .map((line) => ({ indent: line.match(/^\s*/u)[0].length, line }));
    assert.equal(headers.length, 2, `${owner} add_header count`);
    for (const { indent, line } of headers) {
      assert.equal(indent, 2, `${owner} add_header sits in a nested block: ${line.trim()}`);
    }
  }
});

test("the hetzner api vhost carries no studio policy", async () => {
  const hetzner = await readFile(POLICY_FILES.hetzner, "utf8");
  const apiServer = hetzner.split("server {")[1] ?? "";
  assert.match(apiServer, /server_name api\.f-motion\.com/u);
  // api.f-motion.com answers JSON only, so it never serves the document that
  // asks for the microphone; the SPA vhost owns the policy.
  assert.doesNotMatch(apiServer, /Permissions-Policy/u);
});
