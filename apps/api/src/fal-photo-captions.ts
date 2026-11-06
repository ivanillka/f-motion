import {
  FAL_VISION_ENDPOINT_ID,
  FAL_VISION_MAX_CHARS,
  FAL_VISION_MAX_IMAGE_CHARS,
  FAL_VISION_MAX_PHOTOS,
  FAL_VISION_PRICE_PER_1000_CHARS,
  FalImageError,
  describeFalImage,
  falVisionCostUsd
} from "@f-engine/fal-host";
import { Gate0Error, Gate0Policy } from "@f-engine/create-session";
import { FalCredentialMissingError, type FalCredentialService } from "./fal-credentials.js";

/** One photo the browser already downscaled: a stable hash and its data URI. */
export interface PhotoCaptionInput {
  hash: string;
  image: string;
}

export interface PhotoCaption {
  hash: string;
  caption: string;
}

export interface PhotoCaptionView {
  /** The pinned FAL vision model, named so the client can show what it paid for. */
  model: string;
  price_per_1000_chars: number;
  max_photos: number;
  /** Honest money for the photos read in this call, at the pinned price. */
  estimated_cost_usd: number;
  captions: PhotoCaption[];
  /** Photos beyond `max_photos` that were not read. */
  skipped: number;
}

export interface PhotoCaptionService {
  describePhotos(ownerId: string, photos: unknown): Promise<PhotoCaptionView>;
}

export class PhotoCaptionValidationError extends Error {}

const photoHashPattern = /^[A-Za-z0-9:._-]{8,120}$/u;

function photoHash(value: unknown): string {
  if (typeof value !== "string" || !photoHashPattern.test(value)) {
    throw new PhotoCaptionValidationError("Photo captions need one hash per photo.");
  }
  return value;
}

function photoImage(value: unknown): string {
  if (typeof value !== "string") {
    throw new PhotoCaptionValidationError("Photo captions need one downscaled image per photo.");
  }
  const trimmed = value.trim();
  if (!/^data:image\/(?:jpeg|jpg|png|webp);base64,/u.test(trimmed)) {
    throw new PhotoCaptionValidationError("Send a downscaled JPEG or PNG, not a link or a raw file.");
  }
  if (trimmed.length > FAL_VISION_MAX_IMAGE_CHARS) {
    throw new PhotoCaptionValidationError("That photo is too large to describe. Downscale it first.");
  }
  return trimmed;
}

/** Reads the owner's own FAL key, checks Gate 0, then captions each photo once. */
export class FalPhotoCaptionService implements PhotoCaptionService {
  constructor(
    readonly credentials: FalCredentialService,
    readonly fetchImpl: typeof fetch = fetch
  ) {}

  async describePhotos(ownerId: string, photos: unknown): Promise<PhotoCaptionView> {
    if (!Array.isArray(photos) || photos.length === 0) {
      throw new PhotoCaptionValidationError("Add at least one photo to describe.");
    }
    const parsed: PhotoCaptionInput[] = [];
    const seen = new Set<string>();
    for (const item of photos) {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        throw new PhotoCaptionValidationError("Photo captions need one hash and one image per photo.");
      }
      const raw = item as Record<string, unknown>;
      const extra = Object.keys(raw).filter((key) => key !== "hash" && key !== "image");
      if (extra.length) {
        throw new PhotoCaptionValidationError("Photo captions do not accept other fields.");
      }
      const hash = photoHash(raw.hash);
      const image = photoImage(raw.image);
      if (seen.has(hash)) continue;
      seen.add(hash);
      parsed.push({ hash, image });
    }
    const batch = parsed.slice(0, FAL_VISION_MAX_PHOTOS);
    const skipped = parsed.length - batch.length;
    const status = await this.credentials.status(ownerId);
    // Gate 0: no managed AI. Describing photos spends the owner's own FAL key,
    // so a chat without one is refused before a single byte leaves the server.
    new Gate0Policy({ pexels: false, fal: status.connected }).requireByok("fal");
    const credential = await this.credentials.decryptForOwner(ownerId);
    // Describe one photo at a time so a single failed read cannot lose the rest.
    const captions: PhotoCaption[] = [];
    for (const photo of batch) {
      let caption: string;
      try {
        caption = await describeFalImage(credential.apiKey, photo.image, this.fetchImpl);
      } catch (error) {
        if (error instanceof FalImageError || error instanceof FalCredentialMissingError) throw error;
        throw new FalImageError("provider_unavailable");
      }
      if (!caption) continue;
      captions.push({
        hash: photo.hash,
        caption: caption.slice(0, FAL_VISION_MAX_CHARS).trim()
      });
    }
    if (!captions.length) throw new FalImageError("unsafe_output");
    return {
      model: FAL_VISION_ENDPOINT_ID,
      price_per_1000_chars: FAL_VISION_PRICE_PER_1000_CHARS,
      max_photos: FAL_VISION_MAX_PHOTOS,
      estimated_cost_usd: falVisionCostUsd(captions.length),
      captions,
      skipped
    };
  }
}

/** Maps the service's own failures to the API's error envelope. */
export function photoCaptionHttpError(
  error: unknown
): { status: number; body: { type: string; message: string } } | undefined {
  if (error instanceof PhotoCaptionValidationError) {
    return { status: 422, body: { type: "validation", message: error.message } };
  }
  if (error instanceof Gate0Error) {
    return { status: 403, body: { type: "gate0", message: error.message } };
  }
  if (error instanceof FalCredentialMissingError) {
    return { status: 409, body: { type: "fal_not_connected", message: "Connect your FAL API key in Settings first." } };
  }
  if (error instanceof FalImageError) {
    if (error.code === "credential") {
      return { status: 422, body: { type: "invalid_provider_credential", message: "FAL rejected this API key." } };
    }
    if (error.code === "rate_limited") {
      return { status: 503, body: { type: "provider_unavailable", message: "FAL is rate limiting photo reads. Try again later." } };
    }
    return { status: 503, body: { type: "provider_unavailable", message: "FAL could not read these photos. Try again later." } };
  }
  return undefined;
}
