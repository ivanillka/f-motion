import 'dart:io';

import 'package:f_motion/render/compile.dart';
import 'package:f_motion/render/plan.dart';
import 'package:f_motion/render/render.dart';
import 'package:flutter_test/flutter_test.dart';

import 'render_fixtures.dart';

/// Compiles a shared fixture into a job inside [tempDir].
RenderPlanJob compileInto(String name, String tempDir) {
  final golden = loadSharedJson('compile/$name');
  return compileRenderPlan(
    RenderPlanV1.parse(loadSharedJson(name)),
    RenderPlanAssets(
      media: <String, String>{
        for (final entry in (golden['media'] as Map).entries)
          entry.key.toString(): entry.value as String,
      },
      brandMark: golden['brandMark'] as String?,
      fontsDir: golden['fontsDir'] as String,
    ),
    RenderPlanCompileOptions(
      tempDir: tempDir,
      outputPath: '$tempDir/$name'.replaceAll('.json', '.mp4'),
      metadata: const RenderPlanCompileMetadata(comment: 'render=on_device'),
    ),
  );
}

void main() {
  group('retargetEncoder', () {
    test('a null encoder keeps the compiled list untouched', () {
      final args = compileGolden(
        'render-plan-v1-brand-mark.json',
      ).clips.first.args;
      expect(identical(retargetEncoder(args, null), args), isTrue);
    });

    test('the output codec is rewritten and nothing else moves', () {
      final job = compileGolden('render-plan-v1-photo-reel.json');
      final args = job.clips.first.args;
      final retargeted = retargetEncoder(args, 'h264_mediacodec');
      expect(retargeted, hasLength(args.length));
      expect(job.encodeVideo, 'h264');
      expect(args, contains('h264'));

      final lastInput = args.lastIndexOf('-i');
      final index = args.indexOf('-c:v', lastInput);
      expect(index, greaterThan(lastInput));
      expect(retargeted[index + 1], 'h264_mediacodec');
      for (var cursor = 0; cursor < args.length; cursor += 1) {
        if (cursor == index + 1) continue;
        expect(retargeted[cursor], args[cursor], reason: 'arg $cursor');
      }
      expect(args[index + 1], 'h264', reason: 'the input list stays as built');
    });

    test('the brand mark input codec survives retargeting', () {
      final job = compileGolden('render-plan-v1-brand-mark.json');
      final retargeted = retargetEncoder(job.concatArgs, 'h264_mediacodec');
      expect(job.concatArgs, contains('libvpx-vp9'));
      expect(retargeted, contains('libvpx-vp9'));
      expect(retargeted.lastIndexOf('h264'), -1);
      expect(retargeted, contains('h264_mediacodec'));
    });
  });

  test('the device encoder only changes what the plan asked for', () {
    final expected = Platform.isAndroid
        ? 'h264_mediacodec'
        : Platform.isIOS || Platform.isMacOS
        ? 'h264_videotoolbox'
        : 'h264';
    expect(RenderPlanExecutor.defaultDeviceEncoder('h264'), expected);
    expect(RenderPlanExecutor.defaultDeviceEncoder('libvpx-vp9'), 'libvpx-vp9');
  });

  test('writing a job puts the compiled bytes on disk', () async {
    final temp = Directory.systemTemp.createTempSync('f_motion_render_test');
    addTearDown(() => temp.deleteSync(recursive: true));
    final job = compileInto('render-plan-v1-photo-reel.json', temp.path);

    await writeJobInputs(job);

    expect(File(job.listPath).readAsStringSync(), job.listContents);
    final ass = job.clips.first;
    expect(ass.assPath, isNotNull);
    expect(File(ass.assPath!).readAsStringSync(), ass.assContents);
    expect(File(ass.assPath!).readAsStringSync(), startsWith('[Script Info]'));
  });

  test('a failed pass keeps only the tail of the log', () {
    final logs = List.generate(120, (index) => 'line $index').join('\n');
    final tail = logTail(logs, lines: 5)!;
    expect(tail.split('\n'), [
      'line 115',
      'line 116',
      'line 117',
      'line 118',
      'line 119',
    ]);
    expect(logTail('\n  \n'), isNull);
    expect(logTail(null), isNull);
  });
}
