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
  bool _initializing = true;
  String? _videoError;
  int _startupMs = 0;
  int _lastInputUs = 0;
  int _lastSeekMs = 0;
  int _slowFrames = 0;
  int _frameCount = 0;
  int? _peakRssBytes;
  double _upload = 0;
  bool _uploading = false;
  String _uploadStatus = 'Ready';
  Timer? _uploadTimer;
  final _captionController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _captionController.text = _caption;
    SchedulerBinding.instance.addTimingsCallback(_recordFrames);
    _restore().then((_) => _openScene(_selected));
  }

  void _recordFrames(List<FrameTiming> timings) {
    if (!mounted) return;
    final slow = timings
        .where((timing) => timing.totalSpan.inMilliseconds > 16)
        .length;
    setState(() {
      _frameCount += timings.length;
      _slowFrames += slow;
      final rss = currentRssBytes();
      if (rss != null && (rss > (_peakRssBytes ?? 0))) _peakRssBytes = rss;
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
    setState(() {
      _selected = orderIndex;
      _initializing = true;
      _videoError = null;
    });
    await _video?.dispose();
    final controller = VideoPlayerController.asset(
      _scenes[_sceneOrder[orderIndex]].asset,
    );
    _video = controller;
    try {
      await controller.initialize();
      await controller.setLooping(true);
      await controller.setVolume(_ducking ? _musicVolume * .3 : _musicVolume);
      _startupMs = widget.started.elapsedMilliseconds;
    } catch (error) {
      _videoError = '$error';
    }
    if (mounted) setState(() => _initializing = false);
  }

  void _timedInput(VoidCallback change) {
    final timer = Stopwatch()..start();
    setState(change);
    SchedulerBinding.instance.addPostFrameCallback((_) {
      if (mounted) setState(() => _lastInputUs = timer.elapsedMicroseconds);
    });
  }

  Future<void> _seek(double milliseconds) async {
    final timer = Stopwatch()..start();
    await _video?.seekTo(Duration(milliseconds: milliseconds.round()));
    if (mounted) setState(() => _lastSeekMs = timer.elapsedMilliseconds);
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
    SchedulerBinding.instance.removeTimingsCallback(_recordFrames);
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
                        IgnorePointer(
                          child: Padding(
                            padding: const EdgeInsets.fromLTRB(24, 70, 24, 100),
                            child: DecoratedBox(
                              decoration: BoxDecoration(
                                border: Border.all(color: Colors.white30),
                              ),
                              child: Center(
                                child: Padding(
                                  padding: const EdgeInsets.all(12),
                                  child: Text(
                                    _caption,
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
                        ),
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
              Text('startup ${_startupMs}ms'),
              Text('input $_lastInputUsµs'),
              Text('seek ${_lastSeekMs}ms'),
              Text('slow frames $_slowFrames/$_frameCount'),
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
