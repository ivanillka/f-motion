import test from "node:test";
import assert from "node:assert/strict";
import {
  VOICE_RECORD_UNSUPPORTED_MESSAGE,
  voiceRecordErrorMessage,
  voiceRecordSupported
} from "../src/voice-record.ts";

const DENIED =
  "Microphone access is off for F-Motion. Allow it in your browser's site settings, or upload a WAV, MP3, or M4A instead.";
const MISSING = "No microphone found. Plug one in, or upload a WAV, MP3, or M4A instead.";
const UNSUPPORTED = "This browser cannot record here. Upload a WAV, MP3, or M4A instead.";
const BLOCKED = "Microphone is blocked. Upload a WAV, MP3, or M4A instead.";

function named(name) {
  return new DOMException("voice-over recording failed", name);
}

test("a blocked microphone sends the user to site settings", () => {
  // The shipped Permissions-Policy, a denied prompt, and an insecure origin all
  // reject getUserMedia this way.
  assert.equal(voiceRecordErrorMessage(named("NotAllowedError")), DENIED);
  assert.equal(voiceRecordErrorMessage(named("SecurityError")), DENIED);
  assert.equal(voiceRecordErrorMessage({ name: "NotAllowedError" }), DENIED);
});

test("a missing or unusable device asks for a microphone", () => {
  assert.equal(voiceRecordErrorMessage(named("NotFoundError")), MISSING);
  assert.equal(voiceRecordErrorMessage(named("OverconstrainedError")), MISSING);
});

test("an old browser or a browser unable to record says so", () => {
  assert.equal(voiceRecordErrorMessage(named("NotSupportedError")), UNSUPPORTED);
  assert.equal(VOICE_RECORD_UNSUPPORTED_MESSAGE, UNSUPPORTED);
  assert.equal(voiceRecordErrorMessage(named("NotSupportedError")), VOICE_RECORD_UNSUPPORTED_MESSAGE);
});

test("any other failure keeps the blocked message", () => {
  assert.equal(voiceRecordErrorMessage(named("NotReadableError")), BLOCKED);
  assert.equal(voiceRecordErrorMessage(new Error("boom")), BLOCKED);
  assert.equal(voiceRecordErrorMessage(undefined), BLOCKED);
  assert.equal(voiceRecordErrorMessage({ name: 42 }), BLOCKED);
});

test("every recording message names the upload way out", () => {
  for (const message of [DENIED, MISSING, UNSUPPORTED, BLOCKED]) {
    assert.match(message, /upload a WAV, MP3, or M4A instead\.$/iu, message);
  }
});

test("recording needs both getUserMedia and MediaRecorder", () => {
  const getUserMedia = () => Promise.reject(new Error("unused"));
  assert.equal(voiceRecordSupported({ mediaDevices: { getUserMedia }, recorder: function Recorder() {} }), true);
  // Plain http and very old browsers hide mediaDevices, old browsers hide MediaRecorder.
  assert.equal(voiceRecordSupported({ mediaDevices: undefined, recorder: function Recorder() {} }), false);
  assert.equal(voiceRecordSupported({ mediaDevices: { getUserMedia }, recorder: undefined }), false);
  assert.equal(voiceRecordSupported({ mediaDevices: {}, recorder: function Recorder() {} }), false);
});
