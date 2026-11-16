import { join } from "node:path";
import type { CaptionCue, OverlayLook, OverlayPlace } from "@f-engine/contracts";
import {
  coverCropFilter,
  RENDER_PLAN_FONTS,
  spokenWordsForCues,
  type RenderPlanAudioTrack,
  type RenderPlanBed,
  type RenderPlanMotion,
  type RenderPlanOverlay,
  type RenderPlanScene,
  type RenderPlanV1
} from "@f-engine/reel-engine";

/**
 * Render plan v1 compiler: plan + local assets -> FFmpeg arguments and ASS
 * documents. Every number the media pipeline uses comes from the plan, so the
 * same plan compiles to the same bytes on the worker and on a phone.
 */

function escapeDrawtext(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll(":", "\\:").replaceAll("'", "\\'");
}

// ponytail: subtitles=PATH is a filter option, so ":" and "'" need the same
// escaping drawtext values do. Temp ASS paths come from our own outputPath
// (derived from mkdtemp callers), so this is defense in depth, not the
// primary guard.
function escapeFilterPath(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll(":", "\\:").replaceAll("'", "\\'");
}

// ponytail: ASS Dialogue text has no native escape for a literal "{" / "}"
// (they open override tags) or "\" (it can start \N/\n/\h codes). Swapping
// them for same-font ASCII look-alikes avoids libass font-fallback panel seams.
function escapeAssText(value: string): string {
  return value
    .replaceAll("\\", "/")
    .replaceAll("{", "(")
    .replaceAll("}", ")")
    .replace(/\r\n|\r|\n/g, "\\N");
}

/** Lanczos cover-crop, the sampler this pipeline has always used for stills. */
function lanczosCoverCrop(width: number, height: number, focal_x: number, focal_y: number): string[] {
  return coverCropFilter(width, height, focal_x, focal_y).map((part) =>
    part.startsWith("scale=") && !part.includes("flags=") ? `${part}:flags=lanczos` : part
  );
}

/** Ease-in-out progress 0..1 over output frame `on` (zoompan's counter). */
function easeExpr(frames: number): string {
  return `(0.5-0.5*cos(PI*on/${frames - 1}))`;
}

/**
 * zoompan expression for one scene's plan motion. A plan motion whose
 * `zoom_end` is above `zoom_start` zooms in, and one below it is the same
 * eased travel reversed, so the photo reel's alternating presets need no
 * preset names here. `none` means no filter at all.
 */
function motionFilter(
  motion: RenderPlanMotion,
  durationSeconds: number,
  width: number,
  height: number,
  fps: number
): string | undefined {
  if (motion.type === "none") return undefined;
  const frames = Math.max(2, Math.round(durationSeconds * fps));
  const ease = easeExpr(frames);
  const rise = motion.zoom_end >= motion.zoom_start;
  const range = Math.abs(motion.zoom_end - motion.zoom_start).toFixed(4);
  const centred = "x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'";
  if (motion.type === "zoom") {
    const sign = rise ? "+" : "-";
    return `zoompan=z='${motion.zoom_start}${sign}${range}*${ease}':${centred}:d=1:s=${width}x${height}:fps=${fps}`;
  }
  // ponytail: "push" is a Ken Burns pan, not a transition. Wide sources pan X;
  // tall/unknown pan Y so the extra cover-crop pixels actually move. The pan
  // stays inside the overscaled cover, so it never shows an edge.
  if (motion.axis === "x") {
    return `zoompan=z=${motion.pan_scale}:x='(iw-iw/zoom)*${ease}':y='ih/2-(ih/zoom/2)':d=1:s=${width}x${height}:fps=${fps}`;
  }
  return `zoompan=z=${motion.pan_scale}:x='iw/2-(iw/zoom/2)':y='(ih-ih/zoom)*${ease}':d=1:s=${width}x${height}:fps=${fps}`;
}

// Match apps/web overlay: Inter Display ExtraBold titles, Inter SemiBold
// captions, pill panel ~62% black. ASS cannot round the pill. Font names come
// from the plan so a different platform renderer burns the same faces.
const ASS_WHITE = "&H00FFFFFF";
const ASS_BLACK = "&H00000000";
const CAPTION_PILL = "&H61000000";

/**
 * Overlay text keeps 6% of the frame width clear on each side. ASS margins are
 * PlayRes units, so a landscape frame scales its inset with its own width.
 */
const OVERLAY_SAFE_INSET = 0.06;

function overlaySideMargin(playResWidth: number): number {
  return Math.ceil(playResWidth * OVERLAY_SAFE_INSET);
}

function assStyle(
  name: string,
  font: string,
  size: number,
  back: string,
  spacing: number,
  borderStyle: 1 | 3,
  outline: number,
  shadow: number,
  secondary = "&H00AAAAAA",
  box: { align?: number; l?: number; r?: number; v?: number; side?: number } = {}
): string {
  const align = box.align ?? 2;
  // A look may ask for more inset than the safe zone, never less.
  const marginL = Math.max(box.side ?? overlaySideMargin(720), box.l ?? 0);
  const marginR = Math.max(box.side ?? overlaySideMargin(720), box.r ?? 0);
  const marginV = box.v ?? 140;
  return `Style: ${name},${font},${size},${ASS_WHITE},${secondary},${ASS_BLACK},${back},0,0,0,0,100,100,${spacing},0,${borderStyle},${outline},${shadow},${align},${marginL},${marginR},${marginV},1`;
}

/** ASS style pair for one look, sized to the plan's PlayRes width. */
function overlayAssStyles(
  look: OverlayLook,
  fonts: { title: string; caption: string },
  playResWidth = 720
): { title: string; caption: string; titleSize: number; captionSize: number } {
  const side = overlaySideMargin(playResWidth);
  const style = (
    name: string,
    font: string,
    size: number,
    back: string,
    spacing: number,
    borderStyle: 1 | 3,
    outline: number,
    shadow: number,
    extra: {
      secondary?: string;
      box?: { align?: number; l?: number; r?: number; v?: number };
    } = {}
  ) => assStyle(name, font, size, back, spacing, borderStyle, outline, shadow, extra.secondary, {
    side,
    ...extra.box
  });
  if (look === "title") {
    return {
      title: style("Title", fonts.title, 78, ASS_BLACK, -3, 1, 3, 2),
      caption: style("Caption", fonts.caption, 26, CAPTION_PILL, 0, 3, 8, 0),
      titleSize: 78,
      captionSize: 26
    };
  }
  if (look === "poster") {
    return {
      title: style("Title", fonts.title, 52, ASS_BLACK, -2, 1, 2, 2),
      caption: style("Caption", fonts.caption, 26, ASS_BLACK, 0, 1, 0, 1),
      titleSize: 52,
      captionSize: 26
    };
  }
  if (look === "spoken") {
    return {
      title: style("Title", fonts.title, 68, ASS_BLACK, -1, 1, 3, 2),
      caption: style("Caption", fonts.title, 68, ASS_BLACK, -1, 1, 3, 2, {
        secondary: "&H80FFFFFF",
        box: { align: 5, l: 80, r: 80, v: 0 }
      }),
      titleSize: 68,
      captionSize: 68
    };
  }
  return {
    title: style("Title", fonts.title, 64, ASS_BLACK, -2, 1, 2, 3),
    caption: style("Caption", fonts.caption, 26, CAPTION_PILL, 0, 3, 8, 0),
    titleSize: 64,
    captionSize: 26
  };
}

/**
 * ASS WrapStyle 0 wraps on spaces only, so one long word walks straight past
 * the safe zone. A line whose longest word does not fit takes a font-size
 * override; a word that stays too wide even shrunk is hard-broken instead.
 * ponytail: the advance is a deliberate overestimate for Inter Display
 * ExtraBold uppercase, so the rendered bounds test is the real check.
 */
const OVERLAY_GLYPH_ADVANCE = 0.75;
const OVERLAY_MIN_SCALE = 0.55;

export interface OverlayTextFit {
  /** Font size override for the line, when the style size is too wide. */
  fontSize?: number;
  /** Characters per line for a word too wide even at the smallest size. */
  chunk?: number;
}

function fitOverlayText(words: string[], size: number, safeWidth: number): OverlayTextFit {
  const longest = words.reduce((max, word) => Math.max(max, word.trim().length), 0);
  if (longest === 0) return {};
  const expected = (chars: number, at: number) => chars * at * OVERLAY_GLYPH_ADVANCE;
  if (expected(longest, size) <= safeWidth) return {};
  const scale = safeWidth / expected(longest, size);
  if (scale >= OVERLAY_MIN_SCALE) return { fontSize: Math.max(16, Math.floor(size * scale)) };
  return { chunk: Math.max(1, Math.floor(safeWidth / (size * OVERLAY_GLYPH_ADVANCE))) };
}

/** `\N` inside a word is the only line break ASS honors without a space. */
function breakOverlayWord(word: string, chunk: number): string {
  if (word.length <= chunk) return escapeAssText(word);
  const pieces: string[] = [];
  for (let index = 0; index < word.length; index += chunk) {
    pieces.push(escapeAssText(word.slice(index, index + chunk)));
  }
  return pieces.join("\\N");
}

function overlayAssText(text: string, chunk?: number): string {
  if (!chunk) return escapeAssText(text);
  return text.split(" ").map((word) => breakOverlayWord(word, chunk)).join(" ");
}

function overlayLayout(
  place: OverlayPlace | undefined,
  hasTitle: boolean,
  hasCaption: boolean,
  look: OverlayLook
) {
  if (look === "spoken") return { an: 5, titleV: 0, captionV: 0, marginL: 80, marginR: 80 };
  if (look === "poster") {
    if (place === "top") return { an: 7, titleV: 36, captionV: hasTitle ? 110 : 36, marginL: 0, marginR: 0 };
    if (place === "center") return { an: 4, titleV: hasCaption ? 24 : 0, captionV: hasTitle ? 24 : 0, marginL: 0, marginR: 0 };
    return { an: 1, titleV: hasCaption ? 96 : 36, captionV: 36, marginL: 0, marginR: 0 };
  }
  if (place === "top") return { an: 8, titleV: 88, captionV: hasTitle ? 176 : 88, marginL: 0, marginR: 0 };
  if (place === "center") return { an: 8, titleV: hasCaption ? 500 : 560, captionV: hasTitle ? 590 : 560, marginL: 0, marginR: 0 };
  return { an: 2, titleV: hasCaption ? 228 : 0, captionV: 0, marginL: 0, marginR: 0 };
}

function assDialogue(
  style: string,
  startMs: number,
  endMs: number,
  text: string,
  marginV: number,
  an: number,
  fit: OverlayTextFit = {}
): string {
  const tags = [fit.fontSize ? `\\fs${fit.fontSize}` : "", an !== 2 ? `\\an${an}` : ""]
    .filter(Boolean)
    .join("");
  const tag = tags ? `{${tags}}` : "";
  return `Dialogue: 0,${assTimestamp(startMs)},${assTimestamp(endMs)},${style},,0,0,${marginV},,${tag}${overlayAssText(text, fit.chunk)}`;
}

function assKaraokeDialogue(
  style: string,
  words: RenderPlanOverlay["words"],
  marginV: number,
  an: number,
  marginL = 0,
  marginR = 0,
  fit: OverlayTextFit = {}
): string {
  const startMs = words[0]?.start_ms ?? 0;
  const endMs = words[words.length - 1]?.end_ms ?? 0;
  const align = [fit.fontSize ? `\\fs${fit.fontSize}` : "", an !== 2 ? `\\an${an}` : ""]
    .filter(Boolean)
    .join("");
  const text = words.map((word, index) => {
    const cs = Math.max(1, Math.round((word.end_ms - word.start_ms) / 10));
    const open = index === 0 && align ? `{${align}\\k${cs}}` : `{\\k${cs}}`;
    return `${open}${overlayAssText(word.text, fit.chunk)}`;
  }).join(" ");
  return `Dialogue: 0,${assTimestamp(startMs)},${assTimestamp(endMs)},${style},,${marginL},${marginR},${marginV},,${text}`;
}

/** Formats milliseconds as an ASS timestamp: `h:mm:ss.cc` (centiseconds). */
function assTimestamp(ms: number): string {
  const centiseconds = Math.round(ms / 10);
  const hundredths = centiseconds % 100;
  const totalSeconds = Math.floor(centiseconds / 100);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(hundredths).padStart(2, "0")}`;
}

/**
 * Deterministic ASS subtitle document for one overlay, exactly as the plan
 * describes it. Portrait stays PlayRes 720x1280. A landscape plan uses its own
 * PlayRes so captions are not mapped through a portrait script. Every line
 * keeps a 6% side inset, bottom text sits 140px above the frame bottom so it
 * clears the watermark band, and a line whose longest word cannot fit the inset
 * drops its font size instead of running off the frame.
 */
export function captionAss(
  overlay: RenderPlanOverlay,
  durationMs: number | undefined,
  playRes?: { width: number; height: number }
): string {
  const look = overlay.look;
  // Title copy is set in caps; every other look keeps the authored case.
  const title = look === "title" ? (overlay.title ?? "").toUpperCase() : overlay.title ?? "";
  const captionWords = overlay.words;
  const place = overlay.place;
  const layout = overlayLayout(place, Boolean(title), captionWords.length > 0, look);
  const landscape = Boolean(playRes && playRes.width > playRes.height);
  const playResWidth = landscape && playRes ? playRes.width : 720;
  const styles = overlayAssStyles(
    look,
    { title: overlay.font_title, caption: overlay.font_caption },
    playResWidth
  );
  const safeWidth = playResWidth - 2 * overlaySideMargin(playResWidth);
  // A scene title spans the whole scene; a caption spans its words.
  const titleEnd = durationMs ?? captionWords.at(-1)?.end_ms ?? 0;
  const titleFit = title
    ? fitOverlayText([title], styles.titleSize, safeWidth)
    : {};
  const captionFit = captionWords.length
    ? fitOverlayText(captionWords.map((word) => word.text), styles.captionSize, safeWidth)
    : {};
  const dialogues = [
    ...(title && titleEnd > 0
      ? [assDialogue("Title", 0, titleEnd, title, layout.titleV, layout.an, titleFit)]
      : []),
    ...(captionWords.length
      ? [assKaraokeDialogue(
        "Caption",
        captionWords,
        layout.captionV,
        layout.an,
        layout.marginL,
        layout.marginR,
        captionFit
      )]
      : [])
  ];
  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${playResWidth}`,
    `PlayResY: ${landscape && playRes ? playRes.height : 1280}`,
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    styles.title,
    styles.caption,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...dialogues,
    ""
  ].join("\n");
}

/**
 * Snapshot-shaped entry point kept for callers and tests that hold cues and a
 * scene's overlay fields rather than a plan. It resolves exactly the way the
 * plan builder does, then hands the result to the plan writer above.
 */
export function buildCaptionAss(
  cues: CaptionCue[],
  overlay: {
    title?: string;
    caption?: string;
    place?: OverlayPlace;
    look?: OverlayLook;
    durationMs?: number;
  } = {},
  playRes?: { width: number; height: number }
): string {
  const look: OverlayLook = overlay.look === "title" || overlay.look === "poster" || overlay.look === "spoken"
    ? overlay.look
    : "caption";
  let title = overlay.title?.trim() ?? "";
  let captionCues = cues;
  if (look === "spoken") title = "";
  if (look === "title" && !title) {
    title = overlay.caption?.trim() ?? "";
    captionCues = [];
  }
  return captionAss({
    look,
    place: overlay.place ?? (look === "title" ? "center" : "bottom"),
    title: title || null,
    words: spokenWordsForCues(captionCues),
    font_title: RENDER_PLAN_FONTS.title,
    font_caption: RENDER_PLAN_FONTS.caption
  }, overlay.durationMs ?? cues.at(-1)?.end_ms, playRes);
}

function vfArgs(filters: string[]): string[] {
  return filters.length ? ["-vf", filters.join(",")] : [];
}

function captionFilters(captionAssPath: string | undefined, fontsDir: string): string[] {
  if (!captionAssPath) return [];
  return [`subtitles=${escapeFilterPath(captionAssPath)}:fontsdir=${escapeFilterPath(fontsDir)}`];
}

function watermarkFilters(watermark: string): string[] {
  return [
    "drawbox=x=24:y=ih-100:w=iw-48:h=64:color=black@0.65:t=fill",
    `drawtext=text='${escapeDrawtext(watermark)}':x=(w-text_w)/2:y=h-78:fontcolor=white:fontsize=28`
  ];
}

// `h264` lets FFmpeg select the available software encoder (libx264 in the
// production GPL build and OpenH264 in the local development image).
// ponytail: OpenH264 rejects `-crf`; raise bitrate instead. 8M is for 1080x1920.
// Every rate comes from the plan, so the phone encodes the same stream.
function clipVideoEncode(plan: RenderPlanV1): string[] {
  return [
    "-c:v", plan.encode.video,
    "-r", String(plan.fps),
    "-b:v", plan.encode.video_bitrate,
    "-pix_fmt", plan.encode.pixel_format,
    "-movflags", "+faststart"
  ];
}

function clipAudioEncode(plan: RenderPlanV1): string[] {
  return [
    "-c:a", plan.encode.audio,
    "-ar", String(plan.encode.audio_rate),
    "-ac", String(plan.encode.audio_channels)
  ];
}

function concatOutputArgs(plan: RenderPlanV1, encodeVideo: boolean, mixdown?: boolean): string[] {
  if (encodeVideo) return [...clipVideoEncode(plan), ...clipAudioEncode(plan)];
  if (mixdown) return ["-c:v", "copy", ...clipAudioEncode(plan), "-movflags", "+faststart"];
  return ["-c:v", "copy", "-c:a", "copy", "-movflags", "+faststart"];
}

// ponytail: voice-over ducks the licensed bed by a constant gain while attached.
// Upgrade: sidechaincompress when dialogue is actually present on the VO input.
function audioFilterArgs(audioLevel: number): string[] {
  const level = Math.min(1, Math.max(0, audioLevel));
  return level === 1 ? [] : ["-af", `volume=${level}`];
}

function silentAudioInput(duration: number): string[] {
  return ["-f", "lavfi", "-t", String(duration), "-i", "anullsrc=r=44100:cl=stereo"];
}

function clipOutputArgs(plan: RenderPlanV1, videoMap: string, audioMap: string): string[] {
  return ["-map", videoMap, "-map", audioMap, ...clipVideoEncode(plan), ...clipAudioEncode(plan)];
}

/**
 * Contain keeps the whole picture: a blurred cover of the same source fills the
 * frame and carries the motion, and the picture itself is scaled to fit inside
 * the frame without being zoomed. Overlay text is burned after the composite in
 * both fits, so the motion never scales or crops it.
 */
function containChain(
  plan: RenderPlanV1,
  scene: RenderPlanScene,
  motion: string | undefined,
  captions: string[]
): string {
  const sample = scene.motion.sample_scale;
  const backdrop = [
    ...lanczosCoverCrop(
      plan.width * sample,
      plan.height * sample,
      scene.crop.focal_x,
      scene.crop.focal_y
    ),
    ...(motion ? [motion] : []),
    `gblur=sigma=${Math.max(8, Math.round(plan.height / 60))}`,
    "eq=brightness=-0.14:saturation=0.85"
  ];
  const picture = [
    `scale=${plan.width}:${plan.height}:force_original_aspect_ratio=decrease:flags=lanczos`,
    "setsar=1"
  ];
  const composite = `overlay=(W-w)/2:(H-h)/2:shortest=1${captions.length ? `,${captions.join(",")}` : ""},setsar=1`;
  return [
    "[0:v]split=2[fill][whole]",
    `[fill]${backdrop.join(",")}[back]`,
    `[whole]${picture.join(",")}[fit]`,
    `[back][fit]${composite}[vout]`
  ].join(";");
}

/**
 * One scene clip: inputs, filters and encodes. `mediaPath` is the file the
 * plan's media ref resolved to, or undefined only for the plan's gray
 * placeholder scene.
 */
export function sceneClipArguments(
  plan: RenderPlanV1,
  scene: RenderPlanScene,
  mediaPath: string | undefined,
  clipPath: string,
  captionAssPath?: string,
  fontsDir?: string
): string[] {
  const duration = Math.max(0.2, scene.duration_ms / 1000);
  const captions = captionFilters(captionAssPath, fontsDir ?? process.cwd());
  const motion = motionFilter(scene.motion, duration, plan.width, plan.height, plan.fps);
  if (mediaPath) {
    const still = scene.media.kind === "still";
    const padAudio = still || !scene.media.has_audio;
    const input = still
      ? ["-loop", "1", "-framerate", String(plan.fps), "-t", String(duration), "-i", mediaPath]
      : ["-stream_loop", "-1", "-t", String(duration), "-i", mediaPath];
    const audioInput = padAudio ? silentAudioInput(duration) : [];
    const audioMap = padAudio ? "1:a" : "0:a";
    if (scene.fit === "contain") {
      return [
        "-y",
        ...input,
        ...audioInput,
        "-filter_complex", containChain(plan, scene, motion, captions),
        ...audioFilterArgs(scene.audio_level),
        ...clipOutputArgs(plan, "[vout]", audioMap),
        clipPath
      ];
    }
    // Ken Burns from a 2x cover so zoompan is not sampling an already-tiny crop.
    const sample = scene.motion.sample_scale;
    const cover = [
      ...lanczosCoverCrop(plan.width * sample, plan.height * sample, scene.crop.focal_x, scene.crop.focal_y),
      ...(motion ? [motion] : []),
      ...captions
    ];
    return [
      "-y",
      ...input,
      ...audioInput,
      ...vfArgs(cover),
      ...audioFilterArgs(scene.audio_level),
      ...clipOutputArgs(plan, "0:v", audioMap),
      clipPath
    ];
  }
  return [
    "-y",
    "-f", "lavfi",
    "-i", `color=c=#202027:s=${plan.width}x${plan.height}:d=${duration}:r=${plan.fps}`,
    ...silentAudioInput(duration),
    ...vfArgs([...(motion ? [motion] : []), ...captions]),
    ...audioFilterArgs(scene.audio_level),
    ...clipOutputArgs(plan, "0:v", "1:a"),
    clipPath
  ];
}

/** Local files and directories the plan's opaque refs resolve to. */
export interface RenderPlanAssets {
  /** Plan media ref -> absolute local path. */
  media: Readonly<Record<string, string>>;
  /** File the plan's `brand_mark` ref resolves to. */
  brandMark?: string;
  /** Directory holding the burnable fonts (Inter Display / Inter). */
  fontsDir: string;
}

/** Output tags, built by the caller that owns the snapshot. */
export interface RenderPlanCompileMetadata {
  /** `key=value` pair handed to `-metadata`, e.g. the project revision. */
  comment: string;
  /** Extra `-metadata` pairs, e.g. the licensed soundtrack credit. */
  soundtrack?: string[];
}

export interface RenderPlanCompileOptions {
  tempDir: string;
  outputPath: string;
  metadata: RenderPlanCompileMetadata;
}

export interface SceneClip {
  scene: RenderPlanScene;
  path: string;
  args: string[];
  assPath?: string;
  assContents?: string;
}

export interface RenderJob {
  clips: SceneClip[];
  listPath: string;
  listContents: string;
  concatArgs: string[];
}

function brandVideoChain(
  mark: { width: number; x: number; y: number; opacity: number },
  draws: string[]
): { filter: string; label: string } {
  const parts = [
    `[1:v]scale=${mark.width}:-1:flags=lanczos,format=yuva420p,colorchannelmixer=aa=${mark.opacity.toFixed(2)}[mark]`,
    `[0:v][mark]overlay=main_w-overlay_w-${mark.x}:${mark.y}:shortest=1:format=auto[branded]`
  ];
  if (!draws.length) return { filter: parts.join(";"), label: "branded" };
  parts.push(`[branded]${draws.join(",")}[vout]`);
  return { filter: parts.join(";"), label: "vout" };
}

/**
 * Final pass: concatenate the scene clips, burn the brand mark and watermark,
 * mix the audios and encode. Plain copy when the plan asks for neither an
 * overlay nor a mix, because re-encoding would only cost quality here.
 */
export function concatArguments(
  listPath: string,
  plan: RenderPlanV1,
  outputPath: string,
  assets: RenderPlanAssets,
  metadata: RenderPlanCompileMetadata
): string[] {
  const bed = plan.audio.bed;
  const voice = plan.audio.voice;
  const bedPath = bed ? assets.media[bed.ref] : undefined;
  if (bed && !bedPath) throw new Error("soundtrack media input missing");
  const voicePath = voice ? assets.media[voice.ref] : undefined;
  if (voice && !voicePath) throw new Error("voiceover media input missing");
  const mark = plan.brand_mark ?? undefined;
  if (mark && !assets.brandMark) throw new Error("brand mark asset missing");
  const draws = plan.watermark ? watermarkFilters(plan.watermark) : [];
  const encodeVideo = draws.length > 0 || Boolean(mark);
  if (!bed && !voice && !mark) {
    return [
      "-y",
      "-f", "concat",
      "-safe", "0",
      "-i", listPath,
      ...vfArgs(draws),
      "-metadata", metadata.comment,
      ...concatOutputArgs(plan, encodeVideo, false),
      outputPath
    ];
  }
  const extras: string[] = [];
  const chains: string[] = [];
  const mixInputs = ["[0:a]"];
  let next = mark ? 2 : 1;
  if (bed && bedPath) {
    const duck = voice && voice.level > 0 ? plan.audio.duck : 1;
    const level = Math.round(Math.min(1, Math.max(0, bed.level)) * duck * 1000) / 1000;
    if (bed.offset_ms > 0) extras.push("-ss", (bed.offset_ms / 1000).toFixed(3));
    extras.push("-stream_loop", "-1", "-i", bedPath);
    chains.push(`[${next}:a]volume=${level}[bed]`);
    mixInputs.push("[bed]");
    next += 1;
  }
  if (voice && voicePath) {
    const level = Math.min(1, Math.max(0, voice.level));
    if (voice.offset_ms > 0) extras.push("-ss", (voice.offset_ms / 1000).toFixed(3));
    extras.push("-i", voicePath);
    chains.push(`[${next}:a]volume=${level}[vo]`);
    mixInputs.push("[vo]");
  }
  const branded = mark && assets.brandMark
    ? brandVideoChain(mark, draws)
    : undefined;
  const drawn = !branded && draws.length ? { filter: `[0:v]${draws.join(",")}[vout]`, label: "vout" } : undefined;
  const video = branded ?? drawn;
  const audioChain = bed || voice
    ? `${chains.join(";")};${mixInputs.join("")}amix=inputs=${mixInputs.length}:duration=first:dropout_transition=0:normalize=0[a]`
    : "";
  const filter = [video?.filter, audioChain].filter(Boolean).join(";");
  return [
    "-y",
    "-f", "concat",
    "-safe", "0",
    "-i", listPath,
    ...(mark && assets.brandMark ? ["-c:v", "libvpx-vp9", "-stream_loop", "-1", "-i", assets.brandMark] : []),
    ...extras,
    "-filter_complex", filter,
    "-map", video ? `[${video.label}]` : "0:v",
    "-map", audioChain ? "[a]" : "0:a",
    "-metadata", metadata.comment,
    ...(metadata.soundtrack ?? []),
    ...concatOutputArgs(plan, encodeVideo, Boolean(bed || voice)),
    outputPath
  ];
}

function concatListLine(clipPath: string): string {
  return `file '${clipPath.replaceAll("'", "'\\''")}'\n`;
}

/**
 * Compile a plan into a render job: one FFmpeg argument list per scene, the
 * concat list, and the final concat arguments. `assets` are the files the
 * plan's refs resolve to; a declared ref with no file fails closed instead of
 * substituting a gray frame.
 */
export function compileRenderPlan(
  plan: RenderPlanV1,
  assets: RenderPlanAssets,
  options: RenderPlanCompileOptions
): RenderJob {
  const clips = plan.scenes.map((scene, index) => {
    const mediaPath = scene.media.kind === "none" ? undefined : assets.media[scene.media.ref];
    if (scene.media.kind !== "none" && !mediaPath) throw new Error("scene media input missing");
    const path = join(options.tempDir, `scene-${index}.mp4`);
    const assPath = scene.overlay ? join(options.tempDir, `scene-${index}.ass`) : undefined;
    const assContents = scene.overlay
      ? captionAss(scene.overlay, scene.duration_ms, { width: plan.width, height: plan.height })
      : undefined;
    return {
      scene,
      path,
      ...(assPath ? { assPath } : {}),
      ...(assContents ? { assContents } : {}),
      args: sceneClipArguments(plan, scene, mediaPath, path, assPath, assets.fontsDir)
    };
  });
  const listPath = join(options.tempDir, "concat-list.txt");
  return {
    clips,
    listPath,
    listContents: clips.map((clip) => concatListLine(clip.path)).join(""),
    concatArgs: concatArguments(listPath, plan, options.outputPath, assets, options.metadata)
  };
}
