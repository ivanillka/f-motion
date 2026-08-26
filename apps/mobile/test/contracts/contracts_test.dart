import 'dart:convert';
import 'dart:io';

import 'package:f_motion/api.dart';
import 'package:f_motion/main.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

File sharedFixture(String name) {
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

JsonMap loadSharedObject(String name) {
  final decoded = jsonDecode(sharedFixture(name).readAsStringSync());
  if (decoded is! Map) throw StateError('$name is not a JSON object');
  return {
    for (final entry in decoded.entries) entry.key.toString(): entry.value,
  };
}

List<dynamic> loadSharedList(String name) {
  final decoded = jsonDecode(sharedFixture(name).readAsStringSync());
  if (decoded is! List) throw StateError('$name is not a JSON array');
  return decoded;
}

void main() {
  test('additive contract fields are tolerated', () {
    expect(
      ContractFixture.accepts({
        'schema_version': 1,
        'id': 'project-1',
        'additive_field': true,
      }),
      isTrue,
    );
  });

  test('breaking contract fixture version is rejected', () {
    expect(ContractFixture.accepts({'schema_version': 2}), isFalse);
  });

  test('shared contracts fixtures parse identically in Dart', () {
    final project = loadSharedFixture('project-v1.json') as JsonMap;
    expect(ContractFixture.accepts(project), isTrue);
    expect(ContractFixture.accepts(loadSharedFixture('project-v2-breaking.json') as JsonMap), isFalse);

    final incomplete = loadSharedFixture('error-render-input-incomplete.json') as JsonMap;
    expect(incomplete['type'], 'render_input_incomplete');
    expect(incomplete['message'], isA<String>());

    final media = loadSharedFixture('scene-media-ready.json') as JsonMap;
    expect(media['state'], 'ready');
    expect(media['additive_client_field'], isTrue);

    final progress = loadSharedFixture('sse-progress.json') as JsonMap;
    expect(progress['phase'], 'preparing');
    expect(progress['additive_field'], 'ok');

    final plan = loadSharedFixture('storyboard-plan-v1.json') as List<dynamic>;
    expect(plan, hasLength(4));
    expect((plan.first as Map)['visual_prompt'], isA<String>());
  });

  test('draft survives a replacement cache adapter instance', () async {
    SharedPreferences.setMockInitialValues({});
    await DraftCache().write('saved');
    expect(await DraftCache().read(), 'saved');
  });

  test('token adapter can clear credentials', () async {
    String? token;
    final storage = TokenStorage(
      writeToken: (value) async => token = value,
      readToken: () async => token,
      clearToken: () async => token = null,
    );
    await storage.write('token');
    expect(await storage.read(), 'token');
    await storage.clear();
    expect(await storage.read(), isNull);
  });
}
