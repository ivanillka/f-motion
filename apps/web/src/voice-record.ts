/**
 * Plain words for a voice-over recording that cannot start. The studio records
 * with getUserMedia, and every failure used to show the same blocked message.
 */

const DENIED_MESSAGE =
  "Microphone access is off for F-Motion. Allow it in your browser's site settings, or upload a WAV, MP3, or M4A instead.";
const MISSING_MESSAGE = "No microphone found. Plug one in, or upload a WAV, MP3, or M4A instead.";
export const VOICE_RECORD_UNSUPPORTED_MESSAGE =
  "This browser cannot record here. Upload a WAV, MP3, or M4A instead.";
const BLOCKED_MESSAGE = "Microphone is blocked. Upload a WAV, MP3, or M4A instead.";

/** The page pieces recording needs, injectable so tests can describe a browser. */
export interface VoiceRecordScope {
  mediaDevices?: { getUserMedia?: unknown } | null;
  recorder?: unknown;
}

function browserScope(): VoiceRecordScope {
  return {
    mediaDevices: typeof navigator === "undefined" ? undefined : navigator.mediaDevices,
    recorder: typeof MediaRecorder === "undefined" ? undefined : MediaRecorder
  };
}

/** True when this page can open a microphone at all: https and a modern browser. */
export function voiceRecordSupported(scope: VoiceRecordScope = browserScope()): boolean {
  return typeof scope.mediaDevices?.getUserMedia === "function"
    && typeof scope.recorder === "function";
}

function errorName(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const { name } = error as { name?: unknown };
  return typeof name === "string" ? name : "";
}

/** What to tell the user when getUserMedia or MediaRecorder fails. */
export function voiceRecordErrorMessage(error: unknown): string {
  switch (errorName(error)) {
    case "NotAllowedError":
    case "SecurityError":
      return DENIED_MESSAGE;
    case "NotFoundError":
    case "OverconstrainedError":
      return MISSING_MESSAGE;
    case "NotSupportedError":
      return VOICE_RECORD_UNSUPPORTED_MESSAGE;
    default:
      return BLOCKED_MESSAGE;
  }
}
