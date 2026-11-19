import 'dart:convert';
import 'dart:io';

import 'package:f_motion/api.dart';
import 'package:f_motion/render/compile.dart';
import 'package:f_motion/render/plan.dart';

/// Locates a file under `packages/contracts/fixtures` from a test run started
/// anywhere inside the repository (the same walk `contracts_test.dart` does).
File sharedFixtureFile(String name) {
  var dir = Directory.current;
  for (var i = 0; i < 8; i++) {
    final candidate = File('${dir.path}/packages/contracts/fixtures/$name');
    if (candidate.existsSync()) return candidate;
    final parent = dir.parent;
    if (parent.path == dir.path) break;
    dir = parent;
  }
  throw StateError('missing fixture $name (cwd ${Directory.current.path})');
}

JsonMap loadSharedJson(String name) {
  final decoded = jsonDecode(sharedFixtureFile(name).readAsStringSync());
  if (decoded is! Map) throw StateError('$name is not a JSON object');
  return {
    for (final entry in decoded.entries) entry.key.toString(): entry.value,
  };
}

/// The four plans the worker publishes, by fixture file name.
const sharedRenderPlanFixtures = [
  'render-plan-v1-photo-reel.json',
  'render-plan-v1-brand-mark.json',
  'render-plan-v1-voice-and-bed.json',
  'render-plan-v1-contain.json',
];

/// Rebuilds the compile call the golden recorded and returns the job.
RenderPlanJob compileGolden(String name) {
  final golden = loadSharedJson('compile/$name');
  final plan = RenderPlanV1.parse(loadSharedJson(name));
  final media = <String, String>{
    for (final entry in (golden['media'] as Map).entries)
      entry.key.toString(): entry.value as String,
  };
  final metadata = golden['metadata'] as Map;
  return compileRenderPlan(
    plan,
    RenderPlanAssets(
      media: media,
      brandMark: golden['brandMark'] as String?,
      fontsDir: golden['fontsDir'] as String,
    ),
    RenderPlanCompileOptions(
      tempDir: golden['tempDir'] as String,
      outputPath: golden['outputPath'] as String,
      metadata: RenderPlanCompileMetadata(
        comment: metadata['comment'] as String,
        soundtrack: [
          for (final value in (metadata['soundtrack'] as List? ?? const []))
            value as String,
        ],
      ),
    ),
  );
}

/// The job the worker's compiler produced, as recorded in the shared golden.
JsonMap capturedJob(String name) =>
    loadSharedJson('compile/$name')['job'] as JsonMap;
