import 'dart:convert';

import 'package:f_motion_media_spike/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('reorder preserves scene identities', () {
    expect(reorder([0, 1, 2], 0, 3), [1, 2, 0]);
  });

  test('focal point cannot leave crop bounds', () {
    expect(safeFocal(4), 1);
    expect(safeFocal(-4), -1);
  });

  test('stale scene initialization cannot replace the latest request', () {
    expect(isCurrentSceneRequest(2, 3), isFalse);
    expect(isCurrentSceneRequest(3, 3), isTrue);
  });

  test('draft snapshot round trips', () {
    const draft = DraftSnapshot(
      sceneOrder: [1, 0],
      selected: 1,
      focalX: .4,
      focalY: -.2,
      caption: 'hello',
      musicVolume: .6,
      ducking: true,
    );
    final restored = DraftSnapshot.fromJson(
      jsonDecode(jsonEncode(draft.toJson())) as Map<String, dynamic>,
    );
    expect(restored.sceneOrder, [1, 0]);
    expect(restored.caption, 'hello');
    expect(restored.ducking, isTrue);
  });

  test('mock upload fails at 40 percent then resumes to 100 percent', () {
    var tick = 0;
    var failed = false;
    while (!failed) {
      final step = nextUploadStep(tick, failAtForty: true);
      tick = step.tick;
      failed = step.failed;
    }
    expect(tick, 4);

    var complete = false;
    while (!complete) {
      final step = nextUploadStep(tick, failAtForty: false);
      tick = step.tick;
      complete = step.complete;
    }
    expect(tick, 10);
  });

  test('reduced motion disables automatic scene motion', () {
    expect(allowsAutomaticMotion(false), isTrue);
    expect(allowsAutomaticMotion(true), isFalse);
  });

  test('latency samples retain only the latest bounded window', () {
    final samples = LatencySamples(limit: 3);
    for (final value in [1, 2, 3, 4]) {
      samples.add(value);
    }
    expect(samples.values, [2, 3, 4]);
  });

  test('latency median is deterministic for odd and even samples', () {
    final samples = LatencySamples();
    for (final value in [9, 1, 5]) {
      samples.add(value);
    }
    expect(samples.medianMicroseconds, 5);
    samples.add(7);
    expect(samples.medianMicroseconds, 6);
  });

  test('latency p95 uses nearest rank across twenty samples', () {
    final samples = LatencySamples();
    for (var value = 20; value >= 1; value--) {
      samples.add(value);
    }
    expect(samples.count, 20);
    expect(samples.medianMicroseconds, 10);
    expect(samples.p95Microseconds, 19);
  });

  testWidgets('caption stays inside its safe area at 320px', (tester) async {
    tester.view.physicalSize = const Size(320, 640);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: SizedBox(
            width: 320,
            height: 640,
            child: AspectRatio(
              aspectRatio: 9 / 16,
              child: SafeAreaCaption(
                caption:
                    'An eighty character caption remains bounded even on the narrow supported viewport.',
              ),
            ),
          ),
        ),
      ),
    );

    final safeBounds = tester.getRect(
      find.byKey(const ValueKey('caption-safe-area')),
    );
    final textBounds = tester.getRect(
      find.byKey(const ValueKey('caption-text')),
    );
    expect(safeBounds.left, greaterThanOrEqualTo(24));
    expect(safeBounds.right, lessThanOrEqualTo(296));
    expect(safeBounds.contains(textBounds.topLeft), isTrue);
    expect(safeBounds.contains(textBounds.bottomRight), isTrue);
    expect(tester.takeException(), isNull);
  });
}
