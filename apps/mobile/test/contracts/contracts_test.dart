import 'package:f_motion/main.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

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
