import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";

export type MediaKind = "image" | "video" | "audio" | "unknown";

export type MediaRead = {
  path: string;
  name: string;
  bytes: number;
  kind: MediaKind;
  mime?: string;
  width?: number;
  height?: number;
  orientation?: "portrait" | "landscape" | "square";
};

const MAX_READ = 8;
const SNIFF_BYTES = 64 * 1024;

function orientation(width?: number, height?: number): MediaRead["orientation"] | undefined {
  if (!width || !height) return undefined;
  if (width === height) return "square";
  return width > height ? "landscape" : "portrait";
}

function u32(buffer: Buffer, offset: number): number {
  return buffer.readUInt32BE(offset);
}

function sniff(buffer: Buffer): Pick<MediaRead, "kind" | "mime" | "width" | "height"> {
  if (buffer.length >= 24 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return { kind: "image", mime: "image/png", width: u32(buffer, 16), height: u32(buffer, 20) };
  }
  if (buffer.length >= 12 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    const size = jpegSize(buffer);
    return { kind: "image", mime: "image/jpeg", ...size };
  }
  if (buffer.length >= 16 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
    return { kind: "image", mime: "image/webp", ...webpSize(buffer) };
  }
  if (buffer.length >= 12 && buffer.toString("ascii", 4, 8) === "ftyp") {
    return { kind: "video", mime: "video/mp4" };
  }
  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WAVE") {
    return { kind: "audio", mime: "audio/wav" };
  }
  return { kind: "unknown" };
}

function jpegSize(buffer: Buffer): { width?: number; height?: number } {
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) break;
    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
    }
    offset += 2 + length;
  }
  return {};
}

function webpSize(buffer: Buffer): { width?: number; height?: number } {
  if (buffer.length >= 30 && buffer.toString("ascii", 12, 16) === "VP8X") {
    const width = 1 + buffer[24]! + (buffer[25]! << 8) + (buffer[26]! << 16);
    const height = 1 + buffer[27]! + (buffer[28]! << 8) + (buffer[29]! << 16);
    return { width, height };
  }
  if (buffer.length >= 30 && buffer.toString("ascii", 12, 16) === "VP8 ") {
    return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
  }
  return {};
}

export async function readMedia(paths: string[]): Promise<MediaRead[]> {
  const unique = [...new Set(paths.map((path) => path.trim()).filter(Boolean))].slice(0, MAX_READ);
  const reads: MediaRead[] = [];
  for (const path of unique) {
    const info = await stat(path);
    if (!info.isFile()) throw new Error(`Not a file: ${path}`);
    if (info.size <= 0 || info.size > 100_000_000) throw new Error(`Rejected size: ${path}`);
    const buffer = await readFile(path, { encoding: null });
    const sniffBuffer = buffer.subarray(0, Math.min(SNIFF_BYTES, buffer.length));
    const detected = sniff(sniffBuffer);
    reads.push({
      path,
      name: basename(path),
      bytes: info.size,
      ...detected,
      orientation: orientation(detected.width, detected.height)
    });
  }
  return reads;
}

export function purposeFromMedia(reads: MediaRead[], fallback = "Video from attached media"): string {
  if (!reads.length) return fallback.slice(0, 500);
  const stills = reads.filter((item) => item.kind === "image").length;
  const clips = reads.filter((item) => item.kind === "video").length;
  const label = stills && clips
    ? `${stills} photos and ${clips} clips`
    : stills
      ? `${stills} photo${stills === 1 ? "" : "s"}`
      : clips
        ? `${clips} clip${clips === 1 ? "" : "s"}`
        : `${reads.length} files`;
  return `Video from ${label}`.slice(0, 500);
}
