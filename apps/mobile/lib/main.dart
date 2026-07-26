import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'api.dart';
import 'auth.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  try {
    final auth = await SupabaseAuthGateway.initialize();
    runApp(FMotionApp(auth: auth));
  } on AuthConfigurationException {
    runApp(
      const FMotionApp(configurationError: 'Authentication is not configured.'),
    );
  } catch (_) {
    runApp(
      const FMotionApp(
        configurationError: 'Authentication could not start. Try again.',
      ),
    );
  }
}

class TokenStorage {
  TokenStorage({
    Future<void> Function(String)? writeToken,
    Future<String?> Function()? readToken,
    Future<void> Function()? clearToken,
  }) : _write = writeToken ?? _secureWrite,
       _read = readToken ?? _secureRead,
       _clear = clearToken ?? _secureClear;

  static const _storage = FlutterSecureStorage();
  final Future<void> Function(String) _write;
  final Future<String?> Function() _read;
  final Future<void> Function() _clear;

  static Future<void> _secureWrite(String token) =>
      _storage.write(key: 'access_token', value: token);
  static Future<String?> _secureRead() => _storage.read(key: 'access_token');
  static Future<void> _secureClear() => _storage.delete(key: 'access_token');
  Future<void> write(String token) => _write(token);
  Future<String?> read() => _read();
  Future<void> clear() => _clear();
}

class DraftCache {
  Future<void> write(String draft) async =>
      (await SharedPreferences.getInstance()).setString('draft', draft);
  Future<String?> read() async =>
      (await SharedPreferences.getInstance()).getString('draft');
}

class ContractFixture {
  static bool accepts(Map<String, Object?> value) =>
      value['schema_version'] == 1;
}

class FMotionApp extends StatelessWidget {
  const FMotionApp({super.key, this.api, this.auth, this.configurationError});

  final ApiGateway? api;
  final AuthGateway? auth;
  final String? configurationError;

  @override
  Widget build(BuildContext context) {
    final effectiveAuth = auth ?? const _UnavailableAuthGateway();
    return MaterialApp(
      title: 'F-Motion',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        brightness: Brightness.dark,
        colorSchemeSeed: const Color(0xffe6ff54),
        useMaterial3: true,
      ),
      home: WorkflowPage(
        api:
            api ??
            HttpApiGateway(
              baseUri: Uri.parse(
                const String.fromEnvironment(
                  'FMOTION_API_ORIGIN',
                  defaultValue: 'http://10.0.2.2:3000',
                ),
              ),
              accessToken: () async => effectiveAuth.accessToken,
            ),
        auth: effectiveAuth,
        configurationError: configurationError,
      ),
    );
  }
}

class _UnavailableAuthGateway implements AuthGateway {
  const _UnavailableAuthGateway();

  @override
  String? get accessToken => null;

  @override
  Stream<AuthSessionState> get authStateChanges => const Stream.empty();

  @override
  bool get isSignedIn => false;

  @override
  Future<void> sendMagicLink(String email) async {}

  @override
  Future<void> signInWithGoogle() async {}

  @override
  Future<void> signOut() async {}
}

class WorkflowPage extends StatefulWidget {
  const WorkflowPage({
    required this.api,
    required this.auth,
    this.configurationError,
    super.key,
  });
  final ApiGateway api;
  final AuthGateway auth;
  final String? configurationError;
  @override
  State<WorkflowPage> createState() => _WorkflowPageState();
}

class _WorkflowPageState extends State<WorkflowPage> {
  int tab = 0;
  int stage = 0;
  String draft = '';
  String concept = '';
  String status = '';
  String email = '';
  bool sendingAuth = false;
  String? lastEventId;
  ProjectSnapshot? project;
  List<JsonMap> concepts = [];
  RenderJob? renderJob;
  int renderPercent = 0;
  String renderPhase = 'queued';
  Uri? downloadUrl;
  String pexelsQuery = '';
  List<JsonMap> pexelsResults = [];
  final cache = DraftCache();
  final briefController = TextEditingController();
  StreamSubscription<AuthSessionState>? authSubscription;

  @override
  void initState() {
    super.initState();
    stage = widget.auth.isSignedIn ? 1 : 0;
    status = widget.configurationError ?? '';
    cache.read().then((value) {
      if (mounted && value != null) {
        setState(() {
          draft = value;
          briefController.text = value;
        });
      }
    });
    authSubscription = widget.auth.authStateChanges.listen(
      _handleAuthState,
      onError: (_) {
        if (mounted) {
          setState(() => status = 'Authentication callback failed. Try again.');
        }
      },
    );
  }

  void _handleAuthState(AuthSessionState state) {
    if (!mounted) return;
    setState(() {
      stage = state.isSignedIn ? 1 : 0;
      status = state.isSignedIn ? 'Signed in' : 'Signed out';
      sendingAuth = false;
    });
  }

  bool get _emailIsValid =>
      RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch(email.trim());

  Future<void> _sendMagicLink() async {
    if (widget.configurationError != null) return;
    if (!_emailIsValid) {
      setState(() => status = 'Enter a valid email address.');
      return;
    }
    setState(() {
      sendingAuth = true;
      status = 'Sending magic link…';
    });
    try {
      await widget.auth.sendMagicLink(email.trim());
      if (mounted) {
        setState(() {
          sendingAuth = false;
          status = 'Check your inbox to continue.';
        });
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          sendingAuth = false;
          status = 'Could not send the magic link. Try again.';
        });
      }
    }
  }

  Future<void> _signInWithGoogle() async {
    setState(() {
      sendingAuth = true;
      status = 'Opening Google sign-in…';
    });
    try {
      await widget.auth.signInWithGoogle();
      if (mounted) setState(() => sendingAuth = false);
    } catch (_) {
      if (mounted) {
        setState(() {
          sendingAuth = false;
          status = 'Google sign-in failed. Try again.';
        });
      }
    }
  }

  Future<void> _signOut() async {
    try {
      await widget.auth.signOut();
    } catch (_) {
      if (mounted) setState(() => status = 'Sign-out failed. Try again.');
    }
  }

  @override
  void dispose() {
    authSubscription?.cancel();
    briefController.dispose();
    super.dispose();
  }

  Future<void> _createProject() async {
    final created = await widget.api.createProject(draft);
    if (!mounted) return;
    setState(() {
      project = created.project;
      concepts = created.concepts;
      stage = 2;
      status = '';
    });
  }

  Future<void> _selectConcept() async {
    final current = project;
    if (current == null) return;
    final updated = await widget.api.command(
      current.id,
      current.revision,
      'select_concept',
      {'concept_id': concept},
    );
    if (mounted) {
      setState(() {
        project = updated;
        stage = 3;
      });
    }
  }

  Future<void> _saveCaption(String caption) async {
    final current = project;
    if (current == null || current.scenes.isEmpty) return;
    final scene = {...current.scenes.first, 'caption': caption};
    setState(() => status = 'Saving…');
    try {
      final updated = await widget.api.command(
        current.id,
        current.revision,
        'update_scene',
        {'scene': scene},
      );
      if (mounted) {
        setState(() {
          project = updated;
          status = 'All changes saved';
        });
      }
    } on ApiFailure catch (error) {
      if (mounted) {
        setState(
          () => status = error.status == 409
              ? 'Newer changes exist — reload the authoritative project.'
              : 'Save failed',
        );
      }
    }
  }

  Future<void> _requestRender() async {
    final current = project;
    if (current == null) return;
    final job = await widget.api.render(current.id);
    if (!mounted) return;
    setState(() {
      renderJob = job;
      stage = 4;
    });
    for (var attempt = 0; attempt < 30; attempt += 1) {
      final events = await widget.api.events(job.id, lastEventId);
      for (final event in events) {
        lastEventId = event.id;
        if (!mounted) return;
        setState(() {
          renderPhase = event.phase;
          renderPercent = event.percent;
        });
        if (event.phase == 'complete') {
          final url = await widget.api.download(job.id);
          if (mounted) setState(() => downloadUrl = url);
          return;
        }
        if (event.phase == 'cancelled' || event.phase == 'failed') return;
      }
      await Future<void>.delayed(const Duration(milliseconds: 250));
    }
  }

  Future<void> _cancelRender() async {
    final job = renderJob;
    if (job == null) return;
    await widget.api.cancel(job.id);
    if (mounted) {
      setState(() {
        renderPhase = 'cancelled';
        renderPercent = 0;
      });
    }
  }

  String get _sceneCaption {
    final scenes = project?.scenes;
    return scenes != null && scenes.isNotEmpty
        ? scenes.first['caption']! as String
        : draft;
  }

  Future<void> _searchPexels() async {
    final results = await widget.api.searchPexels(pexelsQuery);
    if (mounted) setState(() => pexelsResults = results);
  }

  Future<void> _copyPexels(JsonMap result) async {
    final current = project;
    if (current == null) return;
    await widget.api.copyPexels(current.id, pexelsQuery, result['id']! as int);
    if (mounted) {
      setState(() => status = 'Pexels media copied with attribution');
    }
  }

  @override
  Widget build(BuildContext context) {
    final reduceMotion = MediaQuery.disableAnimationsOf(context);
    return Scaffold(
      appBar: AppBar(
        title: const Text('F‑Motion'),
        actions: [
          Padding(
            padding: const EdgeInsets.all(16),
            child: Semantics(label: 'Connected', child: Text('● Connected')),
          ),
          if (stage > 0)
            TextButton(onPressed: _signOut, child: const Text('Sign out')),
        ],
      ),
      body: SafeArea(
        key: const Key('workflow-safe-area'),
        child: AnimatedSwitcher(
          duration: reduceMotion
              ? Duration.zero
              : const Duration(milliseconds: 180),
          child: Padding(
            key: ValueKey(stage),
            padding: const EdgeInsets.all(20),
            child: _stage(),
          ),
        ),
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: tab,
        onDestinationSelected: (value) => setState(() => tab = value),
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.movie_creation_outlined),
            label: 'Project',
          ),
          NavigationDestination(
            icon: Icon(Icons.person_outline),
            label: 'Account',
          ),
        ],
      ),
    );
  }

  Widget _stage() {
    if (stage == 0) {
      return ListView(
        children: [
          const Text(
            'Shape a vertical video',
            style: TextStyle(fontSize: 40, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 24),
          TextFormField(
            key: const Key('auth-email'),
            autofillHints: const [AutofillHints.email],
            keyboardType: TextInputType.emailAddress,
            textInputAction: TextInputAction.done,
            autocorrect: false,
            decoration: const InputDecoration(
              labelText: 'Email',
              border: OutlineInputBorder(),
            ),
            onChanged: (value) => email = value,
            onFieldSubmitted: (_) => _sendMagicLink(),
          ),
          const SizedBox(height: 12),
          FilledButton(
            onPressed: widget.configurationError != null || sendingAuth
                ? null
                : _sendMagicLink,
            child: const Text('Email me a magic link'),
          ),
          const SizedBox(height: 12),
          OutlinedButton(
            onPressed: widget.configurationError != null || sendingAuth
                ? null
                : _signInWithGoogle,
            child: const Text('Continue with Google'),
          ),
          if (status.isNotEmpty)
            Semantics(liveRegion: true, child: Text(status)),
        ],
      );
    }
    if (stage == 1) {
      return ListView(
        children: [
          const Text(
            'What should this video achieve?',
            style: TextStyle(fontSize: 32, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 20),
          if (status.isNotEmpty)
            Semantics(liveRegion: true, child: Text(status)),
          TextFormField(
            controller: briefController,
            maxLength: 500,
            minLines: 4,
            maxLines: 8,
            decoration: const InputDecoration(
              labelText: 'Brief',
              border: OutlineInputBorder(),
            ),
            onChanged: (value) {
              setState(() => draft = value);
              cache.write(value);
            },
          ),
          FilledButton(
            onPressed: draft.trim().isEmpty ? null : _createProject,
            child: const Text('Review brief'),
          ),
        ],
      );
    }
    if (stage == 2) {
      return ListView(
        children: [
          const Text(
            'Choose one concept',
            style: TextStyle(fontSize: 32, fontWeight: FontWeight.bold),
          ),
          ...concepts.map(
            (item) => Semantics(
              selected: concept == item['id'],
              button: true,
              child: ListTile(
                selected: concept == item['id'],
                title: Text(item['title']! as String),
                subtitle: Text(item['treatment']! as String),
                trailing: Icon(
                  concept == item['id']
                      ? Icons.check_circle
                      : Icons.circle_outlined,
                ),
                onTap: () => setState(() => concept = item['id']! as String),
              ),
            ),
          ),
          FilledButton(
            onPressed: concept.isEmpty ? null : _selectConcept,
            child: const Text('Use concept'),
          ),
        ],
      );
    }
    if (stage == 3) {
      return ListView(
        children: [
          const Text(
            'Storyboard',
            style: TextStyle(fontSize: 32, fontWeight: FontWeight.bold),
          ),
          const Card(
            child: Padding(
              padding: EdgeInsets.all(16),
              child: Text(
                'Approximate preview — request an accurate render to verify timing and crop.',
              ),
            ),
          ),
          const AspectRatio(
            aspectRatio: 9 / 16,
            child: ColoredBox(
              color: Color(0xff32213b),
              child: Center(child: Icon(Icons.play_arrow, size: 64)),
            ),
          ),
          const ListTile(
            title: Text('Scene 1'),
            subtitle: Text('3.0 seconds · Motion: None'),
            trailing: Icon(Icons.drag_handle),
          ),
          TextFormField(
            initialValue: _sceneCaption,
            maxLength: 180,
            decoration: const InputDecoration(labelText: 'Caption'),
            onFieldSubmitted: _saveCaption,
          ),
          if (status.isNotEmpty)
            Semantics(liveRegion: true, child: Text(status)),
          TextField(
            decoration: const InputDecoration(labelText: 'Search Pexels'),
            onChanged: (value) => pexelsQuery = value,
            onSubmitted: (_) => _searchPexels(),
          ),
          OutlinedButton(
            onPressed: pexelsQuery.trim().isEmpty ? null : _searchPexels,
            child: const Text('Search Pexels'),
          ),
          ...pexelsResults.map(
            (result) => ListTile(
              title: Text('Video by ${result['creator']}'),
              subtitle: const Text('Pexels attribution retained'),
              onTap: () => _copyPexels(result),
            ),
          ),
          FilledButton(
            onPressed: _requestRender,
            child: const Text('Render accurate 720p preview'),
          ),
        ],
      );
    }
    return ListView(
      children: [
        const Text(
          'Accurate preview',
          style: TextStyle(fontSize: 32, fontWeight: FontWeight.bold),
        ),
        Semantics(
          label: '$renderPhase $renderPercent percent',
          liveRegion: true,
          child: LinearProgressIndicator(value: renderPercent / 100),
        ),
        const SizedBox(height: 16),
        FilledButton(
          onPressed: renderPhase == 'complete' || renderPhase == 'cancelled'
              ? null
              : _cancelRender,
          child: const Text('Cancel render'),
        ),
        OutlinedButton(
          onPressed: downloadUrl == null
              ? null
              : () => setState(() => status = 'Download ready: $downloadUrl'),
          child: const Text('Download preview'),
        ),
        TextButton(
          onPressed: () => setState(() => stage = 3),
          child: const Text('Keep editing'),
        ),
      ],
    );
  }
}
