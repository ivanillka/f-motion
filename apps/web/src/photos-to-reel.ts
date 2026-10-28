import {
  photoFitTarget,
  type PhotoFitLimits
} from "./api";

/**
 * Mirrors apps/worker defaultMediaLimits (MEDIA_MAX_WIDTH, MEDIA_MAX_HEIGHT and
 * MEDIA_MAX_PIXELS). Photos are fitted here before upload, so a full size phone
 * still reaches the worker already inside the limits.
 */
export const STUDIO_PHOTO_LIMITS: PhotoFitLimits = {
  maxWidth: 4096,
  maxHeight: 4096,
  maxPixels: 16_000_000
};

const MAX_CAPTION_LENGTH = 180;
// Camera and screenshot names carry no story, so they start without a caption.
const CAMERA_NAME = /^(?:img|dsc|dscn|pxl|mvimg|photo|image|screenshot|snapshot|untitled)[\s_-]*\d*$/iu;

/** Plain caption from a photo file name, or empty when the name has no words. */
export function photoCaptionFromName(name: string): string {
  const base = name
    .replace(/\.[^.]+$/u, "")
    .replace(/[_-]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (!base || CAMERA_NAME.test(base)) return "";
  const sentence = base.charAt(0).toUpperCase() + base.slice(1);
  return sentence.slice(0, MAX_CAPTION_LENGTH);
}

/**
 * Fit one photo for upload: decode it, scale it to the media limits and encode
 * JPEG. Photos already inside the limits come back untouched, and anything the
 * browser cannot decode is left to the worker probe to reject.
 */
export async function fitPhotoForUpload(file: File): Promise<File> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const target = photoFitTarget(image.naturalWidth, image.naturalHeight, STUDIO_PHOTO_LIMITS);
    if (!target) return file;
    const canvas = document.createElement("canvas");
    canvas.width = target.width;
    canvas.height = target.height;
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(image, 0, 0, target.width, target.height);
    const blob = await new Promise<Blob | undefined>((resolve) => {
      canvas.toBlob((value) => resolve(value ?? undefined), "image/jpeg", 0.92);
    });
    if (!blob) return file;
    const base = file.name.replace(/\.[^.]+$/u, "") || "photo";
    return new File([blob], `${base}.jpg`, { type: "image/jpeg" });
  } catch {
    return file;
  } finally {
    URL.revokeObjectURL(url);
  }
}
