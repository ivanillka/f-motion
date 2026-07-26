import 'package:f_motion/auth.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

void main() {
  test('missing build configuration fails closed without leaking values', () {
    const marker = 'publishable-value-must-not-leak';
    expect(
      SupabaseAuthGateway.initialize(url: '', publishableKey: marker),
      throwsA(
        isA<AuthConfigurationException>().having(
          (error) => error.toString(),
          'safe message',
          allOf(isNot(contains(marker)), contains('unavailable')),
        ),
      ),
    );
  });

  test('auth storage is secure and magic links use the exact callback', () {
    const storage = SecureAuthStorage();
    expect(storage, isA<LocalStorage>());
    expect(storage, isA<GotrueAsyncStorage>());
    expect(authCallbackUrl, 'app.fmotion://login-callback/');
  });
}
