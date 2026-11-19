import 'package:f_motion/render/compile.dart';
import 'package:f_motion/render/plan.dart';
import 'package:flutter_test/flutter_test.dart';

import 'render_fixtures.dart';

void main() {
  test('the Dart compiler builds the worker arguments byte for byte', () {
    for (final name in sharedRenderPlanFixtures) {
      final golden = capturedJob(name);
      final job = compileGolden(name);
      expect(job.listPath, golden['listPath'], reason: name);
      expect(job.listContents, golden['listContents'], reason: name);
      expect(job.concatArgs, golden['concatArgs'], reason: name);
      final clips = golden['clips'] as List;
      expect(job.clips, hasLength(clips.length), reason: name);
      for (var index = 0; index < clips.length; index += 1) {
        final want = clips[index] as Map;
        final clip = job.clips[index];
        final where = '$name scene-$index';
        expect(clip.path, want['path'], reason: where);
        expect(clip.assPath, want['assPath'], reason: where);
        expect(clip.assContents, want['assContents'], reason: where);
        expect(clip.args, want['args'], reason: where);
      }
    }
  });

  test('every scene clip carries the plan encode settings', () {
    final plan = RenderPlanV1.parse(
      loadSharedJson('render-plan-v1-photo-reel.json'),
    );
    final job = compileGolden('render-plan-v1-photo-reel.json');
    for (final clip in job.clips) {
      final args = clip.args;
      expect(args, containsAllInOrder(['-c:v', 'h264', '-r', '30']));
      expect(args, containsAllInOrder(['-b:v', plan.encode.videoBitrate]));
      expect(args, containsAllInOrder(['-pix_fmt', 'yuv420p']));
      expect(args, containsAllInOrder(['-c:a', 'aac', '-ar', '44100']));
      expect(args, containsAllInOrder(['-ac', '2']));
      expect(args.last, clip.path);
    }
  });

  test('a declared media ref with no local file fails closed', () {
    final plan = RenderPlanV1.parse(
      loadSharedJson('render-plan-v1-photo-reel.json'),
    );
    expect(
      () => compileRenderPlan(
        plan,
        const RenderPlanAssets(media: {}, fontsDir: '/fonts'),
        const RenderPlanCompileOptions(
          tempDir: '/tmp',
          outputPath: '/tmp/out.mp4',
          metadata: RenderPlanCompileMetadata(comment: 'comment=x'),
        ),
      ),
      throwsA(isA<RenderCompileError>()),
    );
  });

  test('a brand mark without a local asset fails closed', () {
    final plan = RenderPlanV1.parse(
      loadSharedJson('render-plan-v1-brand-mark.json'),
    );
    expect(plan.brandMark, isNotNull);
    final media = <String, String>{
      for (final scene in plan.scenes)
        if (scene.media.kind != 'none')
          scene.media.ref: '/tmp/${scene.media.ref}',
    };
    expect(
      () => compileRenderPlan(
        plan,
        RenderPlanAssets(media: media, fontsDir: '/fonts'),
        const RenderPlanCompileOptions(
          tempDir: '/tmp',
          outputPath: '/tmp/out.mp4',
          metadata: RenderPlanCompileMetadata(comment: 'comment=x'),
        ),
      ),
      throwsA(isA<RenderCompileError>()),
    );
  });

  test('jsNumber mirrors JS number formatting in filter strings', () {
    expect(jsNumber(1), '1');
    expect(jsNumber(1.0), '1');
    expect(jsNumber(0.5), '0.5');
    expect(jsNumber(1.06), '1.06');
    expect(jsNumber(1440), '1440');
    expect(jsNumber(-0.14), '-0.14');
  });

  test('assTimestamp rounds to centiseconds like the worker', () {
    expect(assTimestamp(0), '0:00:00.00');
    expect(assTimestamp(1500), '0:00:01.50');
    expect(assTimestamp(65_432), '0:01:05.43');
    expect(assTimestamp(3_600_000), '1:00:00.00');
  });

  test('ASS text escapes braces and backslashes, not lookalikes', () {
    expect(escapeAssText('a{b}c'), 'a(b)c');
    expect(escapeAssText(r'back\slash'), 'back/slash');
    expect(escapeAssText('two\nlines'), r'two\Nlines');
  });

  test('a word wider than the safe zone shrinks or breaks', () {
    final fits = fitOverlayText(['Legends'], 78, 633.6);
    expect(fits.fontSize, isNull);
    expect(fits.chunk, isNull);
    final wide = fitOverlayText(['Wanderlusting'], 78, 633.6);
    expect(wide.fontSize, lessThan(78));
    expect(wide.fontSize, greaterThanOrEqualTo(16));
    final impossible = fitOverlayText(['x' * 200], 78, 633.6);
    expect(impossible.fontSize, isNull);
    expect(impossible.chunk, greaterThan(0));
    expect(overlayAssText('x' * 200, impossible.chunk), contains(r'\N'));
  });
}
