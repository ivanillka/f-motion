import { sampleCanvasStats, type LocalMediaGlance } from "./api";

const SAMPLE = 64;

function orientation(width?: number, height?: number): LocalMediaGlance["orientation"] | undefined {
  if (!width || !height) return undefined;
  if (width === height) return "square";
  return width > height ? "landscape" : "portrait";
}

function sampleFromSource(source: CanvasImageSource, width: number, height: number): { luminance: number; warmth: number } {
  const canvas = document.createElement("canvas");
  canvas.width = SAMPLE;
  canvas.height = SAMPLE;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context || width <= 0 || height <= 0) return { luminance: 0.5, warmth: 0 };
  context.drawImage(source, 0, 0, SAMPLE, SAMPLE);
  return sampleCanvasStats(context.getImageData(0, 0, SAMPLE, SAMPLE).data);
}

async function glanceImage(file: File): Promise<LocalMediaGlance> {
  const bitmap = await createImageBitmap(file);
  try {
    return {
      name: file.name,
      kind: "image",
      bytes: file.size,
      width: bitmap.width,
      height: bitmap.height,
      orientation: orientation(bitmap.width, bitmap.height),
      ...sampleFromSource(bitmap, bitmap.width, bitmap.height)
    };
  } finally {
    bitmap.close();
  }
}

async function glanceVideo(file: File): Promise<LocalMediaGlance> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "metadata";
  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("video metadata unavailable"));
      video.src = url;
    });
    const width = video.videoWidth || undefined;
    const height = video.videoHeight || undefined;
    const duration_ms = Number.isFinite(video.duration) && video.duration > 0
      ? Math.round(video.duration * 1000)
      : undefined;
    if (width && height && duration_ms) {
      await new Promise<void>((resolve) => {
        video.onseeked = () => resolve();
        video.onerror = () => resolve();
        video.currentTime = Math.min(0.4, video.duration / 3);
      });
    }
    return {
      name: file.name,
      kind: "video",
      bytes: file.size,
      width,
      height,
      duration_ms,
      orientation: orientation(width, height),
      ...sampleFromSource(video, width ?? SAMPLE, height ?? SAMPLE)
    };
  } finally {
    URL.revokeObjectURL(url);
    video.removeAttribute("src");
    video.load();
  }
}

/**
 * Local downsample only. 64px average color + dimensions.
 * A quoted FAL caption read is `captionPhotoLocally` below: 768px JPEG, never
 * the full-resolution original, and only after the owner turns it on.
 */
export async function glanceLocalMedia(file: File): Promise<LocalMediaGlance> {
  const fallback: LocalMediaGlance = {
    name: file.name,
    kind: file.type.startsWith("video/") ? "video" : "image",
    bytes: file.size
  };
  try {
    return file.type.startsWith("video/") ? await glanceVideo(file) : await glanceImage(file);
  } catch {
    return fallback;
  }
}

/** Longest edge of the still that is sent to FAL for a caption read. */
export const CAPTION_EDGE_PX = 768;
/** Above this the browser tells the owner to use fewer photos per read. */
export const CAPTION_MAX_PHOTOS = 8;

/**
 * Cheap, stable content hash. It never leaves the browser, and it lets a retry
 * reuse the caption already paid for instead of buying the same read twice.
 * FNV-1a keeps this synchronous and available outside secure contexts, where
 * `crypto.subtle` is missing.
 */
export function photoContentHash(bytes: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  let second = 0x7fed2f31;
  for (let index = bytes.length - 1; index >= 0; index -= 1) {
    second ^= bytes[index] ?? 0;
    second = Math.imul(second, 0x85ebca6b) >>> 0;
  }
  return `${bytes.length.toString(16)}-${hash.toString(16).padStart(8, "0")}${second.toString(16).padStart(8, "0")}`;
}

async function captionStill(file: File): Promise<Uint8Array | undefined> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, CAPTION_EDGE_PX / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return undefined;
    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((result) => resolve(result), "image/jpeg", 0.7);
    });
    if (!blob) return undefined;
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    bitmap.close();
  }
}

function base64(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
}

export interface CaptionedPhoto {
  /** Stable hash of the downscaled bytes; the caption cache key. */
  hash: string;
  /** `data:image/jpeg;base64,...` that the API forwards to FAL. */
  image: string;
  name: string;
}

/**
 * Downscales stills for a caption read. Videos are left out: a caption of one
 * frame would describe the wrong thing, so the owner's clips keep their glance.
 */
export async function captionPhotoLocally(file: File): Promise<CaptionedPhoto | undefined> {
  if (file.type.startsWith("video/")) return undefined;
  try {
    const bytes = await captionStill(file);
    if (!bytes?.length) return undefined;
    return {
      hash: photoContentHash(bytes),
      image: `data:image/jpeg;base64,${base64(bytes)}`,
      name: file.name
    };
  } catch {
    return undefined;
  }
}
