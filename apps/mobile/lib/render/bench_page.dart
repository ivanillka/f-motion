/// Spike screen: renders a shared plan fixture on the device and reports what
/// it cost. Not part of the product flow; it exists to answer "can the phone
/// produce the same reel as the worker?" with numbers.
library;

import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';

import 'compile.dart';
import 'device_assets.dart';
import 'plan.dart';
import 'render.dart';

class RenderBenchPage extends StatefulWidget {
  const RenderBenchPage({super.key, this.videoEncoder});

  /// [videoEncoder] left null renders the plan's own token, which needs a build
  /// with libx264 (the app's LGPL build has none).
  final String? videoEncoder;

  /// Builds the bench with the encoder pinned by
  /// `--dart-define=F_MOTION_RENDER_ENCODER=...`, when the build sets one, and
  /// the platform default otherwise.
  static RenderBenchPage fromBuildEnvironment() {
    const override = String.fromEnvironment('F_MOTION_RENDER_ENCODER');
    return RenderBenchPage(videoEncoder: override.isEmpty ? null : override);
  }

  @override
  State<RenderBenchPage> createState() => _RenderBenchPageState();
}

class _RenderBenchPageState extends State<RenderBenchPage> {
  String _fixture = RenderBundle.fixtureNames[2];
  late final TextEditingController _encoder = TextEditingController(
    text:
        widget.videoEncoder ?? RenderPlanExecutor.defaultDeviceEncoder('h264'),
  );
  RenderPlanExecutor? _executor;
  RenderProgress? _progress;
  RenderReport? _report;
  String? _error;
  String? _errorLogs;
  final _log = <String>[];
  bool _running = false;

  @override
  void dispose() {
    _encoder.dispose();
    super.dispose();
  }

  String get _workDir =>
      joinPath(Directory.systemTemp.path, 'f-motion-render-bench');

  void _note(String message) {
    if (!mounted) return;
    setState(() {
      _log.insert(0, message);
      if (_log.length > 40) _log.removeLast();
    });
  }

  Future<void> _render() async {
    final encoder = _encoder.text.trim();
    setState(() {
      _running = true;
      _error = null;
      _errorLogs = null;
      _report = null;
      _progress = null;
      _log.clear();
    });
    final clock = Stopwatch()..start();
    try {
      final bundle = await RenderBundle.materialize(_workDir);
      _note('Bundle materialized in ${bundle.rootDir}');
      final media = await ensureSampleMedia(_workDir, onLog: _note);
      final plan = await _readPlan(bundle.plans[_fixture]!);
      _note('Plan $_fixture parsed');
      final outputPath = joinPath(_workDir, 'reel-$_fixture.mp4');
      final executor = RenderPlanExecutor(
        videoEncoder: encoder.isEmpty ? null : encoder,
      );
      _executor = executor;
      final report = await renderPlanOnDevice(
        plan: plan,
        bundle: bundle,
        media: media,
        workDir: joinPath(_workDir, 'work'),
        outputPath: outputPath,
        videoEncoder: encoder.isEmpty ? null : encoder,
        onProgress: (progress) {
          if (mounted) setState(() => _progress = progress);
        },
        onLog: _note,
      );
      clock.stop();
      _note('Reel written in ${clock.elapsed.inMilliseconds} ms');
      if (mounted) setState(() => _report = report);
    } on RenderCompileError catch (error) {
      if (mounted) setState(() => _error = error.detail);
    } on RenderExecutionError catch (error) {
      if (mounted) {
        setState(() {
          _error = error.toString();
          _errorLogs = error.logs;
        });
      }
    } finally {
      _executor = null;
      if (mounted) setState(() => _running = false);
    }
  }

  Future<RenderPlanV1> _readPlan(String path) async {
    final raw = await File(path).readAsString();
    return RenderPlanV1.parse(jsonDecode(raw));
  }

  @override
  Widget build(BuildContext context) {
    final progress = _progress;
    final report = _report;
    return Scaffold(
      appBar: AppBar(
        title: const Text('On-device render bench'),
        actions: [
          if (_running)
            TextButton(
              onPressed: () => _executor?.cancel(),
              child: const Text('Cancel'),
            ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          DropdownButtonFormField<String>(
            initialValue: _fixture,
            decoration: const InputDecoration(labelText: 'Plan fixture'),
            items: [
              for (final name in RenderBundle.fixtureNames)
                DropdownMenuItem(value: name, child: Text(name)),
            ],
            onChanged: _running
                ? null
                : (value) => setState(() => _fixture = value ?? _fixture),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _encoder,
            enabled: !_running,
            decoration: const InputDecoration(
              labelText: 'Video encoder',
              helperText:
                  'Plan says h264; the LGPL build ships MediaCodec instead',
            ),
          ),
          const SizedBox(height: 16),
          FilledButton.icon(
            onPressed: _running ? null : _render,
            icon: const Icon(Icons.movie_creation_outlined),
            label: const Text('Render on device'),
          ),
          const SizedBox(height: 16),
          if (progress != null) ...[
            LinearProgressIndicator(value: progress.percent),
            const SizedBox(height: 8),
            Text(
              '${progress.label} — '
              '${(progress.percent * 100).toStringAsFixed(0)}%',
            ),
            const SizedBox(height: 16),
          ],
          if (_error != null) _errorCard(_error!, _errorLogs),
          if (report != null) _reportCard(report),
          if (_log.isNotEmpty) ...[
            const SizedBox(height: 16),
            Text('Log', style: Theme.of(context).textTheme.titleSmall),
            for (final line in _log)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 2),
                child: Text(line, style: const TextStyle(fontSize: 12)),
              ),
          ],
        ],
      ),
    );
  }

  Widget _errorCard(String detail, String? logs) => Card(
    color: Theme.of(context).colorScheme.errorContainer,
    child: Padding(
      padding: const EdgeInsets.all(12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            detail,
            style: TextStyle(
              color: Theme.of(context).colorScheme.onErrorContainer,
            ),
          ),
          if (logs != null) ...[
            const SizedBox(height: 8),
            SelectableText(
              logs,
              style: const TextStyle(fontFamily: 'monospace', fontSize: 11),
            ),
          ],
        ],
      ),
    ),
  );

  Widget _reportCard(RenderReport report) => Card(
    child: Padding(
      padding: const EdgeInsets.all(12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Reel written', style: Theme.of(context).textTheme.titleSmall),
          const SizedBox(height: 8),
          SelectableText(report.outputPath),
          const SizedBox(height: 8),
          Text('Encoder: ${report.encoder}'),
          Text(
            'Output: '
            '${(report.outputBytes / (1024 * 1024)).toStringAsFixed(1)} MiB',
          ),
          Text('Total: ${report.elapsed.inMilliseconds} ms'),
          Text('FFmpeg passes: ${report.encodeTime.inMilliseconds} ms'),
          for (var index = 0; index < report.passes.length; index += 1)
            Text(
              index == report.passes.length - 1
                  ? '  concat: ${report.passes[index].inMilliseconds} ms'
                  : '  scene ${index + 1}: '
                        '${report.passes[index].inMilliseconds} ms',
            ),
        ],
      ),
    ),
  );
}
