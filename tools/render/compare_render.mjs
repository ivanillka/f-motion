#!/usr/bin/env node
// Compares the worker's reference reel with the reel the phone produced.
//
// The plan is shared, so the two files should describe the same picture: same
// size, same frame rate, same scene count, same number of frames, same audio
// stream. They are not byte-identical — the phone encodes with MediaCodec, the
// worker with libx264 — so the checks are structural plus two picture gates:
// PSNR and SSIM on luma.
//
// Both gates are the measured floors from docs/spikes/on-device-render.md: the
// median of the phone renders of the photo-reel fixture against the worker's
// reel, minus encoder slack. A pass still means "not obviously a different
// reel", not "as good as the worker's"; both floors are overridable per run.
//
// Usage:
//   node tools/render/compare_render.mjs --reference ref.mp4 --device dev.mp4
//        [--min-psnr 28.3] [--min-ssim 0.972] [--json report.json]
//
// Exits 0 when every check passes, 1 when one fails, 2 when ffmpeg/ffprobe or
// an input file is missing.

import { spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * PSNR floor for a phone reel against the worker's reel.
 *
 * Measured on a Samsung Z Flip4 (SM-F721B, Android 16) running the
 * `render-plan-v1-photo-reel` fixture: the cold runs (bundle re-materialised
 * before each) scored 30.33 dB against the worker's reel, and the two other
 * fixtures landed slightly higher. The floor is that median minus 2 dB of
 * encoder slack, 28.33 dB, rounded down to 28.3.
 *
 * The slack is for run-to-run encoder variation, not for a moved cut: the
 * structural checks catch a different reel on their own. Re-measure with the
 * procedure in docs/spikes/on-device-render.md before changing this number.
 */
export const DEFAULT_MIN_PSNR = 28.3;

/**
 * Luma SSIM floor from the same runs: 0.9929 minus a fixed 0.02 decrement, so
 * runs that happen to agree closely do not pin the floor to their own exact
 * value.
 */
export const DEFAULT_MIN_SSIM = 0.972;

/** Every render plan is 30 fps; one frame of drift is the duration tolerance. */
export const PLAN_FPS = 30;

/** scdet score (0-100) a frame must exceed to count as a scene cut. */
const SCENE_THRESHOLD = 10;

/** Detections closer together than this are transition frames of one cut. */
const SCENE_MERGE_SECONDS = 0.25;

/** Pulls the average PSNR out of an ffmpeg psnr filter log block. */
export function parsePsnr(text) {
  if (typeof text !== 'string') return null;
  const average = text.match(/PSNR[^\n]*average:\s*([\d.]+|inf)/i);
  if (!average) return null;
  const value = average[1].toLowerCase();
  return value === 'inf' ? Infinity : Number.parseFloat(value);
}

/** Pulls the luma SSIM out of an ffmpeg ssim filter log block. */
export function parseSsim(text) {
  if (typeof text !== 'string') return null;
  const luma = text.match(/SSIM\s+Y:\s*([\d.]+)/i);
  if (!luma) return null;
  const value = Number.parseFloat(luma[1]);
  return Number.isFinite(value) ? value : null;
}

/** `"30000/1001"` -> `29.97`. */
export function ratio(value) {
  if (typeof value !== 'string') return Number.NaN;
  const [numerator, denominator] = value.split('/').map(Number);
  if (!Number.isFinite(numerator)) return Number.NaN;
  if (denominator === 0) return Number.NaN;
  if (!Number.isFinite(denominator)) return numerator;
  return numerator / denominator;
}

/** One frame at [fps] in seconds, with a small tolerance for muxer rounding. */
export function frameTolerance(fps = PLAN_FPS) {
  return Number.isFinite(fps) && fps > 0 ? 1 / fps + 0.002 : 0.05;
}

/** The frame rate a duration failure is explained against, as it was probed. */
export function frameRateLabel(fps) {
  return Number.isFinite(fps) && fps > 0
    ? `${Number.parseFloat(fps.toFixed(2))} fps`
    : `${PLAN_FPS} fps (plan default)`;
}

/** The fields of an ffprobe `-show_streams` report the comparison needs. */
export function summarize(probe) {
  const streams = Array.isArray(probe?.streams) ? probe.streams : [];
  const video = streams.find((stream) => stream.codec_type === 'video');
  const audio = streams.find((stream) => stream.codec_type === 'audio');
  return {
    width: Number(video?.width ?? 0),
    height: Number(video?.height ?? 0),
    fps: ratio(video?.r_frame_rate),
    frames: Number(video?.nb_frames ?? 0),
    durationSeconds: Number(probe?.format?.duration ?? 0),
    audio: audio
      ? {
          sampleRate: Number(audio.sample_rate ?? 0),
          channels: Number(audio.channels ?? 0),
        }
      : null,
  };
}

/** Pure structural comparison, so the rules are testable without ffmpeg. */
export function compareMedia(reference, device, scenes = {}) {
  const checks = [];
  const same = (label, left, right) =>
    checks.push({ label, ok: left === right, detail: `${left} vs ${right}` });

  same('width', reference.width, device.width);
  same('height', reference.height, device.height);
  const fpsKnown = Number.isFinite(reference.fps) && Number.isFinite(device.fps);
  checks.push({
    label: 'frame rate',
    ok: fpsKnown && reference.fps.toFixed(2) === device.fps.toFixed(2),
    detail: `${reference.fps} vs ${device.fps}`,
  });
  checks.push({
    label: 'audio stream',
    ok: Boolean(reference.audio) && Boolean(device.audio),
    detail: `${reference.audio ? 'present' : 'missing'} vs ` +
      `${device.audio ? 'present' : 'missing'}`,
  });
  same('audio layout', JSON.stringify(reference.audio), JSON.stringify(device.audio));

  const tolerance = frameTolerance(reference.fps);
  const drift = Math.abs(reference.durationSeconds - device.durationSeconds);
  checks.push({
    label: 'duration',
    ok: drift <= tolerance,
    detail: `${reference.durationSeconds.toFixed(3)}s vs ` +
      `${device.durationSeconds.toFixed(3)}s (drift ${drift.toFixed(3)}s, ` +
      `tolerance ${tolerance.toFixed(3)}s: one frame at ` +
      `${frameRateLabel(reference.fps)})`,
  });

  const frameDrift = Math.abs(reference.frames - device.frames);
  const framesKnown = reference.frames > 0 && device.frames > 0;
  checks.push({
    label: 'frame count',
    ok: !framesKnown || frameDrift <= 1,
    detail: framesKnown
      ? `${reference.frames} vs ${device.frames}`
      : 'not reported by one of the files',
  });

  const scenesKnown = Number.isInteger(scenes.reference) && Number.isInteger(scenes.device);
  checks.push({
    label: 'scene count',
    ok: scenesKnown && scenes.reference === scenes.device,
    detail: scenesKnown
      ? `${scenes.reference} vs ${scenes.device} scene changes`
      : 'not measured',
  });
  return checks;
}

function run(command, args) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) {
    throw new Error(`${command} failed to start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim().split('\n').slice(-4);
    throw new Error(`${command} exited ${result.status}: ${detail.join(' | ')}`);
  }
  return result;
}

/** Probes one file into the shape [compareMedia] expects. */
export function probeFile(path) {
  const { stdout } = run('ffprobe', [
    '-v', 'error',
    '-print_format', 'json',
    '-show_streams',
    '-show_format',
    '-count_frames',
    path,
  ]);
  const probe = JSON.parse(stdout);
  for (const stream of probe.streams ?? []) {
    if (stream.codec_type === 'video' && stream.nb_read_frames) {
      stream.nb_frames = stream.nb_read_frames;
    }
  }
  return summarize(probe);
}

/**
 * Decodes both files once and returns the picture gates: PSNR and luma SSIM.
 * The luma plane is the one MediaCodec's rate control can soften first, which
 * is why SSIM is read from `Y` rather than `All`.
 */
export function pictureMetrics(referencePath, devicePath) {
  const result = spawnSync(
    'ffmpeg',
    [
      '-hide_banner', '-nostdin',
      '-i', referencePath,
      '-i', devicePath,
      '-lavfi',
      '[0:v]setpts=PTS-STARTPTS,scale=trunc(iw/2)*2:trunc(ih/2)*2,' +
        'format=yuv420p,split=2[r1][r2];' +
        '[1:v]setpts=PTS-STARTPTS,scale=trunc(iw/2)*2:trunc(ih/2)*2,' +
        'format=yuv420p,split=2[d1][d2];' +
        '[r1][d1]psnr[p];[r2][d2]ssim[s]',
      '-map', '[p]', '-map', '[s]',
      '-f', 'null', '-',
    ],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  if (result.error) {
    throw new Error(`ffmpeg failed to start: ${result.error.message}`);
  }
  const log = `${result.stderr ?? ''}\n${result.stdout ?? ''}`;
  const psnr = parsePsnr(log);
  const ssim = parseSsim(log);
  if (psnr === null || ssim === null) {
    const detail = (result.stderr || '').trim().split('\n').slice(-4).join(' | ');
    throw new Error(`ffmpeg produced no picture reading: ${detail}`);
  }
  return { psnr, ssim };
}

/**
 * Scene-cut times in seconds from an ffmpeg scdet log. A transition can be
 * flagged on more than one frame, so detections within [SCENE_MERGE_SECONDS]
 * collapse into one cut.
 */
export function sceneCuts(text) {
  if (typeof text !== 'string') return [];
  const times = [...text.matchAll(/lavfi\.scd\.time:\s*([\d.]+)/g)]
    .map((match) => Number.parseFloat(match[1]))
    .sort((left, right) => left - right);
  const cuts = [];
  for (const time of times) {
    if (!cuts.length || time - cuts[cuts.length - 1] > SCENE_MERGE_SECONDS) cuts.push(time);
  }
  return cuts;
}

/** Scene cuts in one reel, counted by ffmpeg's scdet filter. */
export function probeSceneCuts(path) {
  const result = spawnSync(
    'ffmpeg',
    [
      '-hide_banner', '-nostdin',
      '-i', path,
      '-vf', `scdet=threshold=${SCENE_THRESHOLD}`,
      '-f', 'null', '-',
    ],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  if (result.error) {
    throw new Error(`ffmpeg failed to start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = (result.stderr || '').trim().split('\n').slice(-4).join(' | ');
    throw new Error(`ffmpeg exited ${result.status} on ${path}: ${detail}`);
  }
  return sceneCuts(`${result.stderr ?? ''}\n${result.stdout ?? ''}`);
}

function parseArgs(argv) {
  const options = {
    minPsnr: DEFAULT_MIN_PSNR,
    minSsim: DEFAULT_MIN_SSIM,
    overrides: { psnr: false, ssim: false },
    json: null,
  };
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (value === undefined && flag !== '--help' && flag !== '-h') {
      throw new Error(`missing value for ${flag}`);
    }
    if (flag === '--reference') options.reference = value;
    else if (flag === '--device') options.device = value;
    else if (flag === '--min-psnr') {
      options.minPsnr = numberFlag(flag, value);
      options.overrides.psnr = true;
    } else if (flag === '--min-ssim') {
      options.minSsim = numberFlag(flag, value);
      options.overrides.ssim = true;
    } else if (flag === '--json') options.json = value;
    else if (flag === '--help' || flag === '-h') options.help = true;
    else throw new Error(`unknown option ${flag}`);
  }
  return options;
}

function numberFlag(flag, value) {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) throw new Error(`${flag} needs a number, got ${value}`);
  return parsed;
}

const USAGE =
  'usage: node tools/render/compare_render.mjs ' +
  '--reference <worker.mp4> --device <phone.mp4> ' +
  '[--min-psnr 28.3] [--min-ssim 0.972] [--json report.json]\n' +
  '\n' +
  '  --min-psnr <dB>  PSNR floor on the decoded picture (default 28.3).\n' +
  '                   Measured: cold Z Flip4 runs of the photo-reel fixture\n' +
  '                   scored 30.33 dB, so the floor is that median minus 2 dB.\n' +
  '                   See docs/spikes/on-device-render.md.\n' +
  '  --min-ssim <n>   luma (Y) SSIM floor (default 0.972). Measured the same\n' +
  '                   way — 0.9929 minus 0.02 — and it wins over PSNR when\n' +
  '                   colour range or MediaCodec rate control makes PSNR\n' +
  '                   pessimistic without a quality bug.\n' +
  '  --json <path>    write the full report as JSON\n' +
  '\n' +
  'Structural checks: width, height, frame rate, audio stream, audio layout,\n' +
  'duration within one frame of the reference at its probed frame rate (30 fps\n' +
  'for the plan), total frame count, scene count.\n' +
  'Exit 0 on MATCH, 1 on MISMATCH (the failing metrics are named), 2 on a\n' +
  'usage error, a missing input file, or a missing ffmpeg/ffprobe.';

function format(value) {
  return value === Infinity ? 'inf' : value.toFixed(2);
}

/** Whether a floor is the measured default or a per-run override. */
function floorLabel(overridden) {
  return overridden ? 'override' : 'measured';
}

function main(argv) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(error.message);
    console.error(USAGE);
    return 2;
  }
  if (options.help) {
    console.log(USAGE);
    return 0;
  }
  if (!options.reference || !options.device) {
    console.log(USAGE);
    return 2;
  }
  for (const path of [options.reference, options.device]) {
    if (!existsSync(path)) {
      console.error(`missing file: ${path}`);
      return 2;
    }
  }

  let reference;
  let device;
  let metrics;
  let referenceCuts;
  let deviceCuts;
  try {
    reference = probeFile(options.reference);
    device = probeFile(options.device);
    metrics = pictureMetrics(options.reference, options.device);
    referenceCuts = probeSceneCuts(options.reference);
    deviceCuts = probeSceneCuts(options.device);
  } catch (error) {
    console.error(error.message);
    return 2;
  }

  const checks = compareMedia(reference, device, {
    reference: referenceCuts.length,
    device: deviceCuts.length,
  });
  checks.push({
    label: 'picture PSNR',
    ok: metrics.psnr >= options.minPsnr,
    detail: `${format(metrics.psnr)} dB (floor ${options.minPsnr} dB, ` +
      `${floorLabel(options.overrides.psnr)})`,
  });
  checks.push({
    label: 'picture SSIM',
    ok: metrics.ssim >= options.minSsim,
    detail: `${metrics.ssim.toFixed(4)} luma (floor ${options.minSsim}, ` +
      `${floorLabel(options.overrides.ssim)})`,
  });

  const failed = checks.filter((check) => !check.ok);
  const report = {
    reference: options.reference,
    device: options.device,
    psnr: metrics.psnr === Infinity ? 'inf' : Number(metrics.psnr.toFixed(3)),
    ssim: Number(metrics.ssim.toFixed(5)),
    thresholds: {
      minPsnr: options.minPsnr,
      minSsim: options.minSsim,
      overridden: {
        psnr: options.overrides.psnr,
        ssim: options.overrides.ssim,
      },
    },
    sceneCuts: { reference: referenceCuts.length, device: deviceCuts.length },
    checks,
    ok: failed.length === 0,
  };

  console.log(`reference ${options.reference}`);
  console.log(`device    ${options.device}`);
  console.log(
    `PSNR      ${format(metrics.psnr)} dB (floor ${options.minPsnr} dB, ` +
      `${floorLabel(options.overrides.psnr)})`,
  );
  console.log(
    `SSIM      ${metrics.ssim.toFixed(4)} luma (floor ${options.minSsim}, ` +
      `${floorLabel(options.overrides.ssim)})`,
  );
  for (const check of checks) {
    console.log(`${check.ok ? 'ok  ' : 'FAIL'} ${check.label}: ${check.detail}`);
  }
  console.log(
    report.ok ? 'MATCH' : `MISMATCH: ${failed.map((check) => check.label).join(', ')}`,
  );
  if (options.json) writeFileSync(options.json, `${JSON.stringify(report, null, 2)}\n`);
  return report.ok ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = main(process.argv.slice(2));
}
