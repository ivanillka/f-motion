#!/usr/bin/env node
// Compares the worker's reference reel with the reel the phone produced.
//
// The plan is shared, so the two files should describe the same picture: same
// size, same frame rate, same number of frames, same audio layout. They are not
// byte-identical — the phone encodes with MediaCodec, the worker with libx264 —
// so the check is structural plus a PSNR floor on the decoded picture.
//
// Usage:
//   node tools/render/compare_render.mjs --reference ref.mp4 --device dev.mp4
//        [--psnr-min 28] [--json report.json]
//
// Exits 0 when every check passes, 1 when one fails, 2 when ffmpeg/ffprobe or
// an input file is missing.

import { spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const PSNR_FLOOR = 28;

/** Pulls the average PSNR out of an ffmpeg psnr filter log block. */
export function parsePsnr(text) {
  if (typeof text !== 'string') return null;
  const average = text.match(/PSNR[^\n]*average:\s*([\d.]+|inf)/i);
  if (!average) return null;
  const value = average[1].toLowerCase();
  return value === 'inf' ? Infinity : Number.parseFloat(value);
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
export function frameTolerance(fps) {
  return Number.isFinite(fps) && fps > 0 ? 1 / fps + 0.002 : 0.05;
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
export function compareMedia(reference, device) {
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
  same('audio layout', JSON.stringify(reference.audio), JSON.stringify(device.audio));

  const tolerance = frameTolerance(reference.fps);
  const drift = Math.abs(reference.durationSeconds - device.durationSeconds);
  checks.push({
    label: 'duration',
    ok: drift <= tolerance,
    detail: `${reference.durationSeconds.toFixed(3)}s vs ` +
      `${device.durationSeconds.toFixed(3)}s (drift ${drift.toFixed(3)}s, ` +
      `tolerance ${tolerance.toFixed(3)}s)`,
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

/** Decodes both files and scores the picture, which is the pixel-level gate. */
export function picturePsnr(referencePath, devicePath) {
  const result = spawnSync(
    'ffmpeg',
    [
      '-hide_banner', '-nostdin',
      '-i', referencePath,
      '-i', devicePath,
      '-lavfi',
      '[0:v]setpts=PTS-STARTPTS,scale=trunc(iw/2)*2:trunc(ih/2)*2[r];' +
        '[1:v]setpts=PTS-STARTPTS,scale=trunc(iw/2)*2:trunc(ih/2)*2[d];' +
        '[r][d]psnr',
      '-f', 'null', '-',
    ],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  if (result.error) {
    throw new Error(`ffmpeg failed to start: ${result.error.message}`);
  }
  const psnr = parsePsnr(`${result.stderr ?? ''}\n${result.stdout ?? ''}`);
  if (psnr === null) {
    const detail = (result.stderr || '').trim().split('\n').slice(-4).join(' | ');
    throw new Error(`ffmpeg produced no PSNR reading: ${detail}`);
  }
  return psnr;
}

function parseArgs(argv) {
  const options = { psnrMin: PSNR_FLOOR, json: null };
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (value === undefined && flag !== '--help') {
      throw new Error(`missing value for ${flag}`);
    }
    if (flag === '--reference') options.reference = value;
    else if (flag === '--device') options.device = value;
    else if (flag === '--psnr-min') options.psnrMin = Number.parseFloat(value);
    else if (flag === '--json') options.json = value;
    else if (flag === '--help' || flag === '-h') options.help = true;
    else throw new Error(`unknown option ${flag}`);
  }
  return options;
}

function format(value) {
  return value === Infinity ? 'inf' : value.toFixed(2);
}

function main(argv) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(error.message);
    return 2;
  }
  if (options.help || !options.reference || !options.device) {
    console.log(
      'usage: node tools/render/compare_render.mjs ' +
        '--reference <worker.mp4> --device <phone.mp4> ' +
        '[--psnr-min 28] [--json report.json]',
    );
    return options.help ? 0 : 2;
  }
  for (const path of [options.reference, options.device]) {
    if (!existsSync(path)) {
      console.error(`missing file: ${path}`);
      return 2;
    }
  }

  let reference;
  let device;
  let psnr;
  try {
    reference = probeFile(options.reference);
    device = probeFile(options.device);
    psnr = picturePsnr(options.reference, options.device);
  } catch (error) {
    console.error(error.message);
    return 2;
  }

  const checks = compareMedia(reference, device);
  checks.push({
    label: 'picture PSNR',
    ok: psnr >= options.psnrMin,
    detail: `${format(psnr)} dB (floor ${options.psnrMin} dB)`,
  });

  const report = {
    reference: options.reference,
    device: options.device,
    psnr: psnr === Infinity ? 'inf' : Number(psnr.toFixed(3)),
    checks,
    ok: checks.every((check) => check.ok),
  };
  for (const check of checks) {
    console.log(`${check.ok ? 'ok  ' : 'FAIL'} ${check.label}: ${check.detail}`);
  }
  console.log(report.ok ? 'MATCH' : 'MISMATCH');
  if (options.json) writeFileSync(options.json, `${JSON.stringify(report, null, 2)}\n`);
  return report.ok ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = main(process.argv.slice(2));
}
