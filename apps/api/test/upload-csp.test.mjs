import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { S3Client } from "@aws-sdk/client-s3";
import { PrivateObjectStore } from "../dist/media-storage.js";

// Production signs browser uploads against the Cloudflare R2 S3 endpoint. The
// account id is per install, so the shipped CSP keeps the wildcard host and a
// self-host with its own bucket needs no config change.
const R2_HOST = "r2.cloudflarestorage.com";

const POLICY_FILES = {
  pages: new URL("../../web/public/_headers", import.meta.url),
  hetzner: new URL("../../../deploy/hetzner/nginx.conf", import.meta.url),
  vps: new URL("../../../deploy/vps/nginx.conf", import.meta.url)
};

function policyFromHeader(text) {
  const line = text.split("\n").find((row) => row.includes("Content-Security-Policy:"));
  assert.ok(line, "Content-Security-Policy header");
  return line.replace(/^.*Content-Security-Policy:\s*/u, "").trim();
}

function policyFromNginx(text) {
  const match = /Content-Security-Policy "([^"]+)"/u.exec(text);
  assert.ok(match, "nginx Content-Security-Policy header");
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

function connectSources(policy) {
  const directive = policy.split(";").map((part) => part.trim()).find((part) => part.startsWith("connect-src"));
  assert.ok(directive, "connect-src directive");
  return directive.split(/\s+/u).slice(1);
}

/** Reads connect-src the way a browser does for an https origin. */
function allowsOrigin(policy, origin) {
  const target = new URL(origin);
  return connectSources(policy).some((source) => {
    const match = /^https:\/\/(\*\.)?([^/:]+)$/u.exec(source);
    if (!match || target.protocol !== "https:") return false;
    const [, wildcard, host] = match;
    return wildcard ? target.hostname.endsWith(`.${host}`) : target.hostname === host;
  });
}

function uploadStore(endpoint) {
  return new PrivateObjectStore(new S3Client({
    region: "auto",
    endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId: "test-access-key", secretAccessKey: "test-secret-key" }
  }), "f-motion-media");
}

test("browser uploads are signed path style against the configured R2 endpoint", async () => {
  const source = await readFile(new URL("../src/start.ts", import.meta.url), "utf8");
  assert.match(source, /endpoint: required\("R2_ENDPOINT"\)/u);
  assert.match(source, /forcePathStyle: true/u);
});

test("presigned PUT URLs stay inside the connect-src the browser gets", async () => {
  const policies = await shippedPolicies();
  for (const account of ["exampleaccount", "selfhostaccount"]) {
    const endpoint = `https://${account}.${R2_HOST}`;
    const signed = new URL(await uploadStore(endpoint).signedPut("media/pending/asset-1", "image/jpeg", 1024));
    assert.equal(signed.origin, endpoint);
    assert.equal(signed.pathname, "/f-motion-media/media/pending/asset-1");
    assert.equal(signed.searchParams.get("X-Amz-Expires"), "300");
    for (const [owner, policy] of Object.entries(policies)) {
      assert.equal(allowsOrigin(policy, signed.origin), true, `${owner} CSP blocks ${signed.origin}`);
    }
  }
});

test("Pages and both nginx configs keep one connect-src", async () => {
  const policies = await shippedPolicies();
  const lists = Object.values(policies).map((policy) => connectSources(policy).join(" "));
  assert.equal(new Set(lists).size, 1, "connect-src drifted between Pages and nginx");
  assert.ok(lists[0].includes(`https://*.${R2_HOST}`), lists[0]);
});

test("bucket CORS lets the studio origins PUT and read uploads", async () => {
  const cors = JSON.parse(await readFile(new URL("../../../deploy/r2-cors.json", import.meta.url), "utf8"));
  assert.equal(Array.isArray(cors.rules), true);
  assert.equal(cors.rules.length, 1);
  const [rule] = cors.rules;
  for (const origin of ["https://f-motion.com", "https://www.f-motion.com", "https://f-motion.pages.dev"]) {
    assert.equal(rule.allowed.origins.includes(origin), true, origin);
  }
  for (const method of ["PUT", "GET", "HEAD"]) {
    assert.equal(rule.allowed.methods.includes(method), true, method);
  }
  // The studio sets content-type on the PUT, which forces a preflight.
  assert.equal(rule.allowed.headers.some((header) => header.toLowerCase() === "content-type"), true);
  // completeUpload reports the stored ETag from the upload response.
  assert.equal(rule.exposeHeaders.includes("ETag"), true);
  assert.equal(rule.maxAgeSeconds, 3600);
});
