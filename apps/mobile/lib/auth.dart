import 'package:flutter/widgets.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

const authCallbackUrl = 'app.fmotion://login-callback/';

class AuthConfigurationException implements Exception {
  const AuthConfigurationException();

  @override
  String toString() => 'Authentication configuration is unavailable.';
}

class AuthSessionState {
  const AuthSessionState({required this.isSignedIn});

  final bool isSignedIn;
}

abstract interface class AuthGateway {
  String? get accessToken;
  bool get isSignedIn;
  Stream<AuthSessionState> get authStateChanges;
  Future<void> sendMagicLink(String email);
  Future<void> signInWithGoogle();
  Future<void> signOut();
}

class SecureAuthStorage extends LocalStorage implements GotrueAsyncStorage {
  const SecureAuthStorage([this._storage = const FlutterSecureStorage()]);

  static const _sessionKey = 'f_motion_supabase_session';
  static const _pkcePrefix = 'f_motion_supabase_pkce_';
  final FlutterSecureStorage _storage;

  @override
  Future<void> initialize() async {
    WidgetsFlutterBinding.ensureInitialized();
  }

  @override
  Future<bool> hasAccessToken() async =>
      await _storage.read(key: _sessionKey) != null;

  @override
  Future<String?> accessToken() => _storage.read(key: _sessionKey);

  @override
  Future<void> persistSession(String persistSessionString) =>
      _storage.write(key: _sessionKey, value: persistSessionString);

  @override
  Future<void> removePersistedSession() => _storage.delete(key: _sessionKey);

  @override
  Future<String?> getItem({required String key}) =>
      _storage.read(key: '$_pkcePrefix$key');

  @override
  Future<void> setItem({required String key, required String value}) =>
      _storage.write(key: '$_pkcePrefix$key', value: value);

  @override
  Future<void> removeItem({required String key}) =>
      _storage.delete(key: '$_pkcePrefix$key');
}

class SupabaseAuthGateway implements AuthGateway {
  SupabaseAuthGateway._(this._client);

  final SupabaseClient _client;

  static Future<SupabaseAuthGateway> initialize({
    String url = const String.fromEnvironment('FMOTION_SUPABASE_URL'),
    String publishableKey = const String.fromEnvironment(
      'FMOTION_SUPABASE_PUBLISHABLE_KEY',
    ),
  }) async {
    if (url.trim().isEmpty || publishableKey.trim().isEmpty) {
      throw const AuthConfigurationException();
    }
    WidgetsFlutterBinding.ensureInitialized();
    const secureStorage = SecureAuthStorage();
    final supabase = await Supabase.initialize(
      url: url,
      publishableKey: publishableKey,
      debug: false,
      authOptions: const FlutterAuthClientOptions(
        authFlowType: AuthFlowType.pkce,
        localStorage: secureStorage,
        pkceAsyncStorage: secureStorage,
      ),
    );
    return SupabaseAuthGateway._(supabase.client);
  }

  @override
  String? get accessToken => _client.auth.currentSession?.accessToken;

  @override
  bool get isSignedIn => _client.auth.currentSession != null;

  @override
  Stream<AuthSessionState> get authStateChanges => _client
      .auth
      .onAuthStateChange
      .map((state) => AuthSessionState(isSignedIn: state.session != null));

  @override
  Future<void> sendMagicLink(String email) => _client.auth.signInWithOtp(
    email: email,
    emailRedirectTo: authCallbackUrl,
  );

  @override
  Future<void> signInWithGoogle() async {
    final opened = await _client.auth.signInWithOAuth(
      OAuthProvider.google,
      redirectTo: authCallbackUrl,
    );
    if (!opened) throw StateError('OAuth browser unavailable');
  }

  @override
  Future<void> signOut() => _client.auth.signOut();
}
