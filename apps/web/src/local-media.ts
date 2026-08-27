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
 * Local downsample only — 64px average color + dimensions.
 * ponytail: quoted FAL caption on a 384px JPEG (moondream/florence-2) is the
 * upgrade when a key exists; do not send full-resolution originals to a VLM.
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
