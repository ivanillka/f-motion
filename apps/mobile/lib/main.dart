import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() => runApp(const FMotionApp());

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
  const FMotionApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'F-Motion',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        brightness: Brightness.dark,
        colorSchemeSeed: const Color(0xffe6ff54),
        useMaterial3: true,
      ),
      home: const WorkflowPage(),
    );
  }
}

class WorkflowPage extends StatefulWidget {
  const WorkflowPage({super.key});
  @override
  State<WorkflowPage> createState() => _WorkflowPageState();
}

class _WorkflowPageState extends State<WorkflowPage> {
  int tab = 0;
  int stage = 0;
  String draft = '';
  String concept = '';
  final cache = DraftCache();

  @override
  void initState() {
    super.initState();
    cache.read().then((value) {
      if (mounted && value != null) setState(() => draft = value);
    });
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
          FilledButton(
            onPressed: () => setState(() => stage = 1),
            child: const Text('Email me a magic link'),
          ),
          const SizedBox(height: 12),
          OutlinedButton(
            onPressed: () => setState(() => stage = 1),
            child: const Text('Continue with Google'),
          ),
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
          TextFormField(
            initialValue: draft,
            maxLength: 500,
            minLines: 4,
            maxLines: 8,
            decoration: const InputDecoration(
              labelText: 'Brief',
              border: OutlineInputBorder(),
            ),
            onChanged: (value) {
              draft = value;
              cache.write(value);
            },
          ),
          FilledButton(
            onPressed: () => setState(() => stage = 2),
            child: const Text('Review brief'),
          ),
        ],
      );
    }
    if (stage == 2) {
      const concepts = ['Direct', 'Story', 'Rhythm'];
      return ListView(
        children: [
          const Text(
            'Choose one concept',
            style: TextStyle(fontSize: 32, fontWeight: FontWeight.bold),
          ),
          ...concepts.map(
            (item) => Semantics(
              selected: concept == item,
              button: true,
              child: ListTile(
                selected: concept == item,
                title: Text(item),
                subtitle: Text('$item treatment for your brief'),
                trailing: Icon(
                  concept == item ? Icons.check_circle : Icons.circle_outlined,
                ),
                onTap: () => setState(() => concept = item),
              ),
            ),
          ),
          FilledButton(
            onPressed: concept.isEmpty ? null : () => setState(() => stage = 3),
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
          FilledButton(
            onPressed: () => setState(() => stage = 4),
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
          label: 'Rendering 72 percent',
          child: const LinearProgressIndicator(value: .72),
        ),
        const SizedBox(height: 16),
        FilledButton(onPressed: () {}, child: const Text('Cancel render')),
        OutlinedButton(onPressed: () {}, child: const Text('Download preview')),
        TextButton(
          onPressed: () => setState(() => stage = 3),
          child: const Text('Keep editing'),
        ),
      ],
    );
  }
}
