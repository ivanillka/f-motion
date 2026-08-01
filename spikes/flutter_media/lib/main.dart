import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:video_player/video_player.dart';

import 'memory_probe.dart';

void main() {
  final started = Stopwatch()..start();
  runApp(MediaSpike(started: started));
}

class MediaSpike extends StatelessWidget {
  const MediaSpike({super.key, required this.started});

  final Stopwatch started;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      theme: ThemeData.dark(useMaterial3: true).copyWith(
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xff8b6cff),
          brightness: Brightness.dark,
        ),
      ),
      home: EditorPage(started: started),
    );
  }
}

class Scene {
  const Scene(this.name, this.asset);

  final String name;
  final String asset;
}

class DraftSnapshot {
  const DraftSnapshot({
    required this.sceneOrder,
    required this.selected,
    required this.focalX,
    required this.focalY,
    required this.caption,
    required this.musicVolume,
    required this.ducking,
  });

  final List<int> sceneOrder;
  final int selected;
  final double focalX;
  final double focalY;
  final String caption;
  final double musicVolume;
  final bool ducking;

  Map<String, Object> toJson() => {
    'sceneOrder': sceneOrder,
    'selected': selected,
    'focalX': focalX,
    'focalY': focalY,
    'caption': caption,
    'musicVolume': musicVolume,
    'ducking': ducking,
  };

  factory DraftSnapshot.fromJson(Map<String, dynamic> json) {
    return DraftSnapshot(
      sceneOrder: (json['sceneOrder'] as List).cast<int>(),
      selected: json['selected'] as int,
      focalX: (json['focalX'] as num).toDouble(),
      focalY: (json['focalY'] as num).toDouble(),
      caption: json['caption'] as String,
      musicVolume: (json['musicVolume'] as num).toDouble(),
      ducking: json['ducking'] as bool,
    );
  }
}

List<T> reorder<T>(List<T> items, int oldIndex, int newIndex) {
  final result = List<T>.of(items);
  if (newIndex > oldIndex) newIndex -= 1;
  result.insert(newIndex, result.removeAt(oldIndex));
  return result;
}

double safeFocal(double value) => value.clamp(-1.0, 1.0);

// ponytail: token comparison is the tested seam; upgrade to a widget test if
// transition rendering gains animation or more controller states.
bool isCurrentSceneRequest(int request, int latestRequest) =>
    request == latestRequest;

bool allowsAutomaticMotion(bool disableAnimations) => !disableAnimations;

// ponytail: startup is one scalar for this spike; use a telemetry event if
// production needs per-scene initialization timing.
int recordFirstStartup(int? recordedMilliseconds, int elapsedMilliseconds) =>
    recordedMilliseconds ?? elapsedMilliseconds;

class FrameMetrics {
  int slowFrames = 0;
  int frameCount = 0;
  bool _steadyStateStarted = false;
  bool _refreshPending = false;

  void add(Iterable<Duration> totalSpans) {
    for (final span in totalSpans) {
      frameCount++;
      if (span.inMilliseconds > 16) slowFrames++;
    }
  }

  bool startSteadyStateOnce() {
    if (_steadyStateStarted) return false;
    _steadyStateStarted = true;
    slowFrames = 0;
    frameCount = 0;
    return true;
  }

  bool claimRefresh() {
    if (_refreshPending) return false;
    _refreshPending = true;
    return true;
  }

  void completeRefresh() => _refreshPending = false;
}

class LatencySamples {
  LatencySamples({this.limit = 20}) : assert(limit > 0);

  final int limit;
  final List<int> _microseconds = [];

  int get count => _microseconds.length;
  List<int> get values => List.unmodifiable(_microseconds);

  void add(int microseconds) {
    _microseconds.add(microseconds);
    if (_microseconds.length > limit) _microseconds.removeAt(0);
  }

  int? get medianMicroseconds {
    if (_microseconds.isEmpty) return null;
    final sorted = [..._microseconds]..sort();
    final middle = sorted.length ~/ 2;
    if (sorted.length.isOdd) return sorted[middle];
    return (sorted[middle - 1] + sorted[middle]) ~/ 2;
  }

  int? get p95Microseconds {
    if (_microseconds.isEmpty) return null;
    final sorted = [..._microseconds]..sort();
    final rank = (sorted.length * .95).ceil();
    return sorted[rank - 1];
  }
}

({int tick, bool failed, bool complete}) nextUploadStep(
  int currentTick, {
  required bool failAtForty,
}) {
  final tick = currentTick + 1;
  return (tick: tick, failed: failAtForty && tick == 4, complete: tick >= 10);
}

class EditorPage extends StatefulWidget {
  const EditorPage({super.key, required this.started});

  final Stopwatch started;

  @override
  State<EditorPage> createState() => _EditorPageState();
}

class _EditorPageState extends State<EditorPage> {
  static const _draftKey = 'f-motion-media-spike-draft-v1';
  static const _scenes = [
    Scene('Purple pulse', 'assets/fixtures/scene_one.mp4'),
    Scene('Green sweep', 'assets/fixtures/scene_two.mp4'),
  ];

  List<int> _sceneOrder = [0, 1];
  int _selected = 0;
  double _focalX = 0;
  double _focalY = 0;
  double _musicVolume = .65;
  bool _ducking = true;
  String _caption = 'Make motion feel effortless';
  VideoPlayerController? _video;
  int _sceneRequest = 0;
  bool _initializing = true;
  String? _videoError;
  int? _startupMs;
  final _inputLatency = LatencySamples();
  final _seekLatency = LatencySamples();
  final _frameMetrics = FrameMetrics();
  int? _peakRssBytes;
  double _upload = 0;
  bool _uploading = false;
  String _uploadStatus = 'Ready';
  Timer? _uploadTimer;
  Timer? _frameOverlayTimer;
  bool _automaticMotionAllowed = true;
  final _captionController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _captionController.text = _caption;
    SchedulerBinding.instance.addTimingsCallback(_recordFrames);
    _restore().then((_) {
      if (mounted) _openScene(_selected);
    });
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final allowed = allowsAutomaticMotion(
      MediaQuery.disableAnimationsOf(context),
    );
    if (allowed == _automaticMotionAllowed) return;
    _automaticMotionAllowed = allowed;
    final controller = _video;
    if (controller == null) return;
    controller.setLooping(allowed);
    if (!allowed) controller.pause();
  }

  void _recordFrames(List<FrameTiming> timings) {
    if (!mounted) return;
    _frameMetrics.add(timings.map((timing) => timing.totalSpan));
    final rss = currentRssBytes();
    if (rss != null && (rss > (_peakRssBytes ?? 0))) _peakRssBytes = rss;
    if (!_frameMetrics.claimRefresh()) return;
    // ponytail: repaint the diagnostic overlay at 2.5 Hz; every frame is still
    // counted above. Use a separate telemetry surface if this grows beyond a spike.
    _frameOverlayTimer = Timer(const Duration(milliseconds: 400), () {
      _frameMetrics.completeRefresh();
      if (mounted) setState(() {});
    });
  }

  Future<void> _restore() async {
    final before = Stopwatch()..start();
    final raw = (await SharedPreferences.getInstance()).getString(_draftKey);
    if (raw != null) {
      try {
        final draft = DraftSnapshot.fromJson(
          jsonDecode(raw) as Map<String, dynamic>,
        );
        _sceneOrder = draft.sceneOrder;
        _selected = draft.selected.clamp(0, _sceneOrder.length - 1);
        _focalX = draft.focalX;
        _focalY = draft.focalY;
        _caption = draft.caption;
        _captionController.text = _caption;
        _musicVolume = draft.musicVolume;
        _ducking = draft.ducking;
        _uploadStatus = 'Draft restored in ${before.elapsedMilliseconds} ms';
      } catch (_) {
        _uploadStatus = 'Invalid draft ignored; defaults restored';
      }
    } else {
      _uploadStatus = 'No cached draft (${before.elapsedMilliseconds} ms)';
    }
  }

  Future<void> _save() async {
    final draft = DraftSnapshot(
      sceneOrder: _sceneOrder,
      selected: _selected,
      focalX: _focalX,
      focalY: _focalY,
      caption: _caption,
      musicVolume: _musicVolume,
      ducking: _ducking,
    );
    await (await SharedPreferences.getInstance()).setString(
      _draftKey,
      jsonEncode(draft.toJson()),
    );
    if (mounted) setState(() => _uploadStatus = 'Draft cached locally');
  }

  Future<void> _openScene(int orderIndex) async {
    if (!mounted) return;
    final request = ++_sceneRequest;
    final asset = _scenes[_sceneOrder[orderIndex]].asset;
    final previous = _video;
    setState(() {
      _selected = orderIndex;
      _video = null;
      _initializing = true;
      _videoError = null;
    });
    await previous?.dispose();
    if (!mounted || !isCurrentSceneRequest(request, _sceneRequest)) return;

    final controller = VideoPlayerController.asset(asset);
    try {
      await controller.initialize();
      await controller.setLooping(_automaticMotionAllowed);
      await controller.setVolume(_ducking ? _musicVolume * .3 : _musicVolume);
    } catch (error) {
      await controller.dispose();
      if (mounted && isCurrentSceneRequest(request, _sceneRequest)) {
        setState(() {
          _initializing = false;
          _videoError = '$error';
        });
      }
      return;
    }

    if (!mounted || !isCurrentSceneRequest(request, _sceneRequest)) {
      await controller.dispose();
      return;
    }
    if (_frameMetrics.startSteadyStateOnce()) {
      _peakRssBytes = currentRssBytes();
    }
    setState(() {
      _video = controller;
      _initializing = false;
      _startupMs = recordFirstStartup(
        _startupMs,
        widget.started.elapsedMilliseconds,
      );
    });
  }

  void _timedInput(VoidCallback change) {
    final timer = Stopwatch()..start();
    setState(change);
    SchedulerBinding.instance.addPostFrameCallback((_) {
      if (mounted) {
        setState(() => _inputLatency.add(timer.elapsedMicroseconds));
      }
    });
  }

  Future<void> _seek(double milliseconds) async {
    final timer = Stopwatch()..start();
    await _video?.seekTo(Duration(milliseconds: milliseconds.round()));
    if (mounted) setState(() => _seekLatency.add(timer.elapsedMicroseconds));
  }

  String _latencyLabel(String name, LatencySamples samples) {
    String milliseconds(int? microseconds) =>
        microseconds == null ? '—' : (microseconds / 1000).toStringAsFixed(1);
    return '$name n=${samples.count}/20 '
        'median ${milliseconds(samples.medianMicroseconds)}ms '
        'p95 ${milliseconds(samples.p95Microseconds)}ms';
  }

  void _startUpload() {
    _uploadTimer?.cancel();
    setState(() {
      _uploading = true;
      _upload = 0;
      _uploadStatus = 'Requesting mock signed URL…';
    });
    var ticks = 0;
    _uploadTimer = Timer.periodic(const Duration(milliseconds: 120), (timer) {
      final step = nextUploadStep(ticks, failAtForty: true);
      ticks = step.tick;
      setState(() {
        _upload = ticks / 10;
        _uploadStatus = step.failed
            ? 'Network interrupted — retry is safe'
            : 'Uploading ${ticks * 10}%';
        if (step.failed) _uploading = false;
      });
      if (step.failed) {
        timer.cancel();
      }
    });
  }

  void _resumeUpload() {
    _uploadTimer?.cancel();
    var ticks = (_upload * 10).round();
    setState(() {
      _uploading = true;
      _uploadStatus = 'Resuming mock upload…';
    });
    _uploadTimer = Timer.periodic(const Duration(milliseconds: 120), (timer) {
      final step = nextUploadStep(ticks, failAtForty: false);
      ticks = step.tick;
      setState(() {
        _upload = ticks / 10;
        _uploadStatus = step.complete
            ? 'Mock upload complete'
            : 'Uploading ${ticks * 10}%';
        if (step.complete) _uploading = false;
      });
      if (step.complete) timer.cancel();
    });
  }

  @override
  void dispose() {
    _sceneRequest++;
    SchedulerBinding.instance.removeTimingsCallback(_recordFrames);
    _frameOverlayTimer?.cancel();
    _uploadTimer?.cancel();
    _video?.dispose();
    _captionController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final wide = MediaQuery.sizeOf(context).width >= 900;
    final preview = _preview();
    final controls = _controls();
    return Scaffold(
      appBar: AppBar(
        title: const Text('F-Motion · media feasibility'),
        actions: [
          TextButton.icon(
            onPressed: _save,
            icon: const Icon(Icons.save),
            label: const Text('Save draft'),
          ),
        ],
      ),
      body: SafeArea(
        child: wide
            ? Row(
                children: [
                  Expanded(flex: 5, child: preview),
                  Expanded(flex: 4, child: controls),
                ],
              )
            : ListView(
                children: [
                  SizedBox(height: 570, child: preview),
                  controls,
                ],
              ),
      ),
    );
  }

  Widget _preview() {
    final controller = _video;
    return Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        children: [
          Expanded(
            child: Center(
              child: AspectRatio(
                aspectRatio: 9 / 16,
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(20),
                  child: ColoredBox(
                    color: Colors.black,
                    child: Stack(
                      fit: StackFit.expand,
                      children: [
                        if (controller != null &&
                            controller.value.isInitialized)
                          FittedBox(
                            fit: BoxFit.cover,
                            alignment: Alignment(_focalX, _focalY),
                            child: SizedBox(
                              width: controller.value.size.width,
                              height: controller.value.size.height,
                              child: VideoPlayer(controller),
                            ),
                          )
                        else if (_initializing)
                          const Center(child: CircularProgressIndicator())
                        else
                          Center(
                            child: Text(_videoError ?? 'Preview unavailable'),
                          ),
                        SafeAreaCaption(caption: _caption),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
          if (controller != null && controller.value.isInitialized)
            ValueListenableBuilder(
              valueListenable: controller,
              builder: (context, value, child) => Row(
                children: [
                  IconButton(
                    tooltip: value.isPlaying ? 'Pause' : 'Play',
                    onPressed: () => setState(
                      value.isPlaying ? controller.pause : controller.play,
                    ),
                    icon: Icon(
                      value.isPlaying ? Icons.pause : Icons.play_arrow,
                    ),
                  ),
                  Expanded(
                    child: Slider(
                      value: value.position.inMilliseconds
                          .clamp(0, value.duration.inMilliseconds)
                          .toDouble(),
                      max: value.duration.inMilliseconds.toDouble().clamp(
                        1,
                        double.infinity,
                      ),
                      onChanged: _seek,
                    ),
                  ),
                ],
              ),
            ),
          Wrap(
            spacing: 12,
            runSpacing: 4,
            alignment: WrapAlignment.center,
            children: [
              Text(
                _startupMs == null ? 'startup —' : 'startup ${_startupMs}ms',
              ),
              Text(_latencyLabel('input', _inputLatency)),
              Text(_latencyLabel('seek', _seekLatency)),
              Text(
                'slow frames ${_frameMetrics.slowFrames}/'
                '${_frameMetrics.frameCount}',
              ),
              Text(
                _peakRssBytes == null
                    ? 'peak RSS external on web'
                    : 'peak RSS ${(_peakRssBytes! / 1048576).toStringAsFixed(1)}MB',
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _controls() {
    return ListView(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      padding: const EdgeInsets.all(16),
      children: [
        Text('Scenes', style: Theme.of(context).textTheme.titleLarge),
        ReorderableListView.builder(
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          itemCount: _sceneOrder.length,
          onReorderItem: (oldIndex, newIndex) => _timedInput(() {
            final activeScene = _sceneOrder[_selected];
            final moved = _sceneOrder.removeAt(oldIndex);
            _sceneOrder.insert(newIndex, moved);
            _selected = _sceneOrder.indexOf(activeScene);
          }),
          itemBuilder: (_, index) => ListTile(
            key: ValueKey(_sceneOrder[index]),
            selected: index == _selected,
            title: Text(_scenes[_sceneOrder[index]].name),
            leading: const Icon(Icons.drag_handle),
            onTap: () => _openScene(index),
          ),
        ),
        const Divider(),
        TextField(
          controller: _captionController,
          maxLength: 80,
          decoration: const InputDecoration(labelText: 'Safe-area caption'),
          onChanged: (value) => _timedInput(() => _caption = value),
        ),
        const Text('Focal point X'),
        Slider(
          value: _focalX,
          min: -1,
          max: 1,
          onChanged: (v) => _timedInput(() => _focalX = safeFocal(v)),
        ),
        const Text('Focal point Y'),
        Slider(
          value: _focalY,
          min: -1,
          max: 1,
          onChanged: (v) => _timedInput(() => _focalY = safeFocal(v)),
        ),
        const Divider(),
        Text(
          'Approximate audio preview',
          style: Theme.of(context).textTheme.titleMedium,
        ),
        Slider(
          value: _musicVolume,
          onChanged: (value) {
            _timedInput(() => _musicVolume = value);
            _video?.setVolume(_ducking ? value * .3 : value);
          },
        ),
        SwitchListTile(
          contentPadding: EdgeInsets.zero,
          title: const Text('Duck under voice (30%)'),
          value: _ducking,
          onChanged: (value) {
            _timedInput(() => _ducking = value);
            _video?.setVolume(value ? _musicVolume * .3 : _musicVolume);
          },
        ),
        const Divider(),
        LinearProgressIndicator(value: _upload),
        const SizedBox(height: 8),
        Text(_uploadStatus),
        const SizedBox(height: 8),
        FilledButton.icon(
          onPressed: _uploading
              ? null
              : (_upload > 0 && _upload < 1 ? _resumeUpload : _startUpload),
          icon: const Icon(Icons.cloud_upload),
          label: Text(
            _upload > 0 && _upload < 1 ? 'Retry upload' : 'Mock signed upload',
          ),
        ),
      ],
    );
  }
}

class SafeAreaCaption extends StatelessWidget {
  const SafeAreaCaption({super.key, required this.caption});

  final String caption;

  @override
  Widget build(BuildContext context) {
    return IgnorePointer(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(24, 70, 24, 100),
        child: DecoratedBox(
          key: const ValueKey('caption-safe-area'),
          decoration: BoxDecoration(border: Border.all(color: Colors.white30)),
          child: Center(
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Text(
                caption,
                key: const ValueKey('caption-text'),
                maxLines: 3,
                overflow: TextOverflow.ellipsis,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  fontSize: 24,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
