import 'dart:convert';

import 'package:f_motion_media_spike/main.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('reorder preserves scene identities', () {
    expect(reorder([0, 1, 2], 0, 3), [1, 2, 0]);
  });

  test('focal point cannot leave crop bounds', () {
    expect(safeFocal(4), 1);
    expect(safeFocal(-4), -1);
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
}
