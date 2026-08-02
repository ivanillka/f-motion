import 'dart:convert';
import 'dart:io';

import 'package:f_motion/main.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

JsonMap loadSharedFixture(String name) {
  final file = File('../../../../packages/contracts/fixtures/$name');
  return Map<String, Object?>.from(jsonDecode(file.readAsStringSync()) as Map);
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
    final project = loadSharedFixture('project-v1.json');
    expect(ContractFixture.accepts(project), isTrue);
    expect(ContractFixture.accepts(loadSharedFixture('project-v2-breaking.json')), isFalse);

    final incomplete = loadSharedFixture('error-render-input-incomplete.json');
    expect(incomplete['type'], 'render_input_incomplete');
    expect(incomplete['message'], isA<String>());

    final media = loadSharedFixture('scene-media-ready.json');
    expect(media['state'], 'ready');
    expect(media['additive_client_field'], isTrue);

    final progress = loadSharedFixture('sse-progress.json');
    expect(progress['phase'], 'preparing');
    expect(progress['additive_field'], 'ok');
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
