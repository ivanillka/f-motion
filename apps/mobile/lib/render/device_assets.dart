/// Turns the plan's opaque refs into local files the FFmpeg build can open:
/// bundled faces, the brand mark, the shared plan fixtures, and the synthetic
/// scene media the demo renders. Nothing here is reachable from a network.
library;

import 'dart:io';

import 'package:flutter/services.dart';

import 'compile.dart';
import 'plan.dart';
import 'render.dart';

/// The bundled pieces of a render, copied out of the asset bundle into a
/// directory FFmpeg can read by path.
class RenderBundle {
  const RenderBundle({
    required this.rootDir,
    required this.fontsDir,
    required this.brandMark,
    required this.plans,
  });

  final String rootDir;

  /// Directory holding the burnable faces.
  final String fontsDir;

  /// Local file the `brand_mark` ref resolves to.
  final String brandMark;

  /// Plan fixture name (file stem) -> local JSON path.
  final Map<String, String> plans;

  static const fixtureNames = [
    'render-plan-v1-brand-mark',
    'render-plan-v1-contain',
    'render-plan-v1-photo-reel',
    'render-plan-v1-voice-and-bed',
  ];

  /// Copies the bundled assets into [rootDir]. Idempotent: files already there
  /// with the right length are left alone, so the second render is instant.
  static Future<RenderBundle> materialize(
    String rootDir, {
    AssetBundle? bundle,
  }) async {
    final assets = bundle ?? rootBundle;
    final fonts = Directory(joinPath(rootDir, 'fonts'));
    final brand = Directory(joinPath(rootDir, 'brand'));
    final plans = Directory(joinPath(rootDir, 'plans'));
    await fonts.create(recursive: true);
    await brand.create(recursive: true);
    await plans.create(recursive: true);

    for (final face in const [
      'InterDisplay-ExtraBold.ttf',
      'Inter-SemiBold.ttf',
    ]) {
      await _copy(
        assets,
        'assets/render/fonts/$face',
        joinPath(fonts.path, face),
      );
    }
    final mark = joinPath(brand.path, 'f-motion-mark.webm');
    await _copy(assets, 'assets/render/brand/f-motion-mark.webm', mark);

    final planPaths = <String, String>{};
    for (final name in fixtureNames) {
      final path = joinPath(plans.path, '$name.json');
      await _copy(assets, 'assets/render/plans/$name.json', path);
      planPaths[name] = path;
    }
    return RenderBundle(
      rootDir: rootDir,
      fontsDir: fonts.path,
      brandMark: mark,
      plans: planPaths,
    );
  }

  static Future<void> _copy(
    AssetBundle bundle,
    String assetKey,
    String path,
  ) async {
    final file = File(path);
    final data = await bundle.load(assetKey);
    final bytes = bytesOf(data);
    if (await file.exists() && await file.length() == bytes.length) return;
    await file.writeAsBytes(bytes, flush: true);
  }
}

/// The synthetic sources the shared fixtures name, keyed by media ref. Sizes
/// match the fixture metadata, so the cover crop sees the same source aspect
/// ratio the worker sees with real media.
const sampleMediaSources = <String, String>{
  'still-1':
      'gradients=s=1600x1200:c0=0x0b1224:c1=0x38bdf8:x1=1600:y1=1200:d=1',
  'still-2':
      'gradients=s=1200x1600:c0=0x111827:c1=0xe6ff54:x1=1200:y1=1600:d=1',
  'still-3': 'gradients=s=900x1600:c0=0x1f2937:c1=0xf472b6:x1=900:y1=1600:d=1',
};

/// File each media ref maps to inside the session's `media/` directory.
const sampleMediaFiles = <String, String>{
  'still-1': 'still-1.png',
  'still-2': 'still-2.png',
  'still-3': 'still-3.png',
  'clip-2': 'clip-2.mp4',
  'voice-1': 'voice-1.m4a',
  'music:pulse': 'music-pulse.m4a',
};

/// Generates whatever of [sampleMediaFiles] is missing under [dir] and returns
/// the media map the compiler resolves refs against. Fails loudly: a device
/// render that cannot produce its inputs must not fall back to a gray frame.
Future<Map<String, String>> ensureSampleMedia(
  String dir, {
  void Function(String message)? onLog,
}) async {
  final root = Directory(joinPath(dir, 'media'));
  await root.create(recursive: true);
  final paths = <String, String>{
    for (final entry in sampleMediaFiles.entries)
      entry.key: joinPath(root.path, entry.value),
  };

  Future<void> generate(String ref, List<String> args) async {
    final path = paths[ref]!;
    final file = File(path);
    if (await file.exists() && await file.length() > 0) return;
    onLog?.call('Generating $ref');
    await runFfmpeg(args, label: ref);
    if (!await file.exists() || await file.length() == 0) {
      throw RenderExecutionError(
        'FFmpeg produced no file for $ref',
        label: 'sample media',
      );
    }
  }

  for (final entry in sampleMediaSources.entries) {
    await generate(entry.key, [
      '-y',
      '-f',
      'lavfi',
      '-i',
      entry.value,
      '-frames:v',
      '1',
      paths[entry.key]!,
    ]);
  }
  await generate('clip-2', [
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=1080x1920:rate=30:duration=3',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=330:sample_rate=44100:duration=3',
    '-c:v',
    'mpeg4',
    '-q:v',
    '4',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '96k',
    '-shortest',
    paths['clip-2']!,
  ]);
  await generate('voice-1', [
    '-y',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:sample_rate=44100:duration=2',
    '-c:a',
    'aac',
    '-b:a',
    '96k',
    paths['voice-1']!,
  ]);
  await generate('music:pulse', [
    '-y',
    '-f',
    'lavfi',
    '-i',
    'aevalsrc=0.2*sin(2*PI*220*t)*exp(-1.5*(t-floor(t))):s=44100:d=10',
    '-c:a',
    'aac',
    '-b:a',
    '96k',
    paths['music:pulse']!,
  ]);
  onLog?.call('Sample media ready in ${root.path}');
  return paths;
}

/// Compiles [plan] against [media] and runs every pass in [workDir], writing
/// the finished reel to [outputPath]. This is the whole device path: the same
/// [compileRenderPlan] call the worker makes, executed by the app's FFmpeg.
Future<RenderReport> renderPlanOnDevice({
  required RenderPlanV1 plan,
  required RenderBundle bundle,
  required Map<String, String> media,
  required String workDir,
  required String outputPath,
  String? videoEncoder,
  void Function(RenderProgress progress)? onProgress,
  void Function(String message)? onLog,
}) async {
  await registerBundledFonts(bundle.fontsDir);
  onLog?.call('Bundled fonts registered with fontconfig');
  final compiled = compileRenderPlan(
    plan,
    RenderPlanAssets(
      media: media,
      fontsDir: bundle.fontsDir,
      brandMark: bundle.brandMark,
    ),
    RenderPlanCompileOptions(
      tempDir: workDir,
      outputPath: outputPath,
      metadata: const RenderPlanCompileMetadata(comment: 'render=on_device'),
    ),
  );
  onLog?.call(
    '${compiled.clips.length} scene passes and the concat pass compiled',
  );
  final executor = RenderPlanExecutor(videoEncoder: videoEncoder);
  return executor.execute(compiled, onProgress: onProgress);
}

/// Byte view of asset data written to disk.
Uint8List bytesOf(ByteData data) =>
    data.buffer.asUint8List(data.offsetInBytes, data.lengthInBytes);
