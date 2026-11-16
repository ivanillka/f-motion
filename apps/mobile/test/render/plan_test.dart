import 'package:f_motion/render/plan.dart';
import 'package:flutter_test/flutter_test.dart';

import 'render_fixtures.dart';

void main() {
  test('every shared plan fixture parses in Dart', () {
    for (final name in sharedRenderPlanFixtures) {
      final json = loadSharedJson(name);
      final plan = RenderPlanV1.parse(json);
      expect(RenderPlanV1.accepts(json), isTrue, reason: name);
      expect(plan.fps, renderPlanFps, reason: name);
      expect(plan.scenes, isNotEmpty, reason: name);
      expect(plan.encode.pixelFormat, 'yuv420p', reason: name);
      expect(plan.encode.audioRate, 44100, reason: name);
    }
  });

  test('a parsed plan writes back the plan it read', () {
    for (final name in sharedRenderPlanFixtures) {
      final json = loadSharedJson(name);
      final plan = RenderPlanV1.parse(json);
      expect(plan.toJson(), equals(json), reason: name);
    }
  });

  test('plan motion reads as the preset the worker rendered', () {
    final reel = RenderPlanV1.parse(
      loadSharedJson('render-plan-v1-photo-reel.json'),
    );
    final motion = reel.scenes.first.motion;
    expect(motion.type, isNot('none'));
    expect(motion.easing, 'cosine');
    expect(motion.sampleScale, 2);
    expect(reel.scenes.every((scene) => scene.durationMs > 0), isTrue);
    expect(reel.totalMs, greaterThan(0));
  });

  test('opaque refs stay opaque: no path or URL crosses the seam', () {
    for (final name in sharedRenderPlanFixtures) {
      final plan = RenderPlanV1.parse(loadSharedJson(name));
      final refs = [
        for (final scene in plan.scenes) scene.media.ref,
        if (plan.audio.bed != null) plan.audio.bed!.ref,
        if (plan.audio.voice != null) plan.audio.voice!.ref,
        if (plan.brandMark != null) plan.brandMark!.ref,
      ];
      for (final ref in refs) {
        expect(ref, isNotEmpty, reason: name);
        expect(ref.contains('/'), isFalse, reason: '$name: $ref');
        expect(ref.contains('://'), isFalse, reason: '$name: $ref');
      }
    }
  });

  test('a newer plan version is refused, not guessed', () {
    final json = loadSharedJson(sharedRenderPlanFixtures.first);
    json['version'] = renderPlanVersion + 1;
    expect(() => RenderPlanV1.parse(json), throwsA(isA<RenderPlanError>()));
    expect(RenderPlanV1.accepts(json), isFalse);
  });

  test('a plan for another schema is refused', () {
    final json = loadSharedJson(sharedRenderPlanFixtures.first);
    json['schema'] = 'fmotion.storyboard-plan';
    expect(() => RenderPlanV1.parse(json), throwsA(isA<RenderPlanError>()));
  });

  test('a tampered plan fails closed instead of rendering', () {
    final unknownKind = loadSharedJson(sharedRenderPlanFixtures.first);
    final firstScene = (unknownKind['scenes'] as List).first as Map;
    (firstScene['media'] as Map)['kind'] = 'gif';
    expect(
      () => RenderPlanV1.parse(unknownKind),
      throwsA(isA<RenderPlanError>()),
    );

    final loudLevel = loadSharedJson(sharedRenderPlanFixtures.first);
    final loudScene = (loudLevel['scenes'] as List).first as Map;
    loudScene['audio_level'] = 1.5;
    expect(
      () => RenderPlanV1.parse(loudLevel),
      throwsA(isA<RenderPlanError>()),
    );

    final badEncoding = loadSharedJson(sharedRenderPlanFixtures.first);
    (badEncoding['encode'] as Map)['pixel_format'] = 'yuv444p';
    expect(
      () => RenderPlanV1.parse(badEncoding),
      throwsA(isA<RenderPlanError>()),
    );

    final empty = loadSharedJson(sharedRenderPlanFixtures.first);
    empty['scenes'] = <Object?>[];
    expect(() => RenderPlanV1.parse(empty), throwsA(isA<RenderPlanError>()));
  });

  test('music refs round trip through the stock id helpers', () {
    final ref = renderPlanMusicRef('coastal-drift');
    expect(ref, 'music:coastal-drift');
    expect(renderPlanMusicId(ref), 'coastal-drift');
    expect(renderPlanMusicId('brand_mark'), isNull);
    expect(renderPlanMusicId('music:'), isNull);
  });
}
