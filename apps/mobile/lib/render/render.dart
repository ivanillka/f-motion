/// Executes a compiled [RenderPlanJob] with the FFmpeg build that ships in the
/// app. The compiler decides *what* runs; this file only runs it, so the plan
/// stays the single source of truth for the output.
library;

import 'dart:async';
import 'dart:io';
import 'dart:math' as math;

import 'package:ffmpeg_kit_flutter_new_full/ffmpeg_kit.dart';
import 'package:ffmpeg_kit_flutter_new_full/ffmpeg_kit_config.dart';
import 'package:ffmpeg_kit_flutter_new_full/ffmpeg_session.dart';
import 'package:ffmpeg_kit_flutter_new_full/return_code.dart';
import 'package:ffmpeg_kit_flutter_new_full/statistics.dart';

import 'compile.dart';

/// Which pass of the job is running.
enum RenderStage { writing, scene, concat, done }

/// One progress tick, weighted by the milliseconds each pass is expected to
/// take. `percent` is 0..1 over the whole job.
class RenderProgress {
  const RenderProgress({
    required this.stage,
    required this.percent,
    required this.label,
    this.sceneIndex = -1,
    this.sceneCount = 0,
  });

  final RenderStage stage;
  final double percent;
  final String label;
  final int sceneIndex;
  final int sceneCount;
}

/// What a finished device render produced.
class RenderReport {
  const RenderReport({
    required this.outputPath,
    required this.elapsed,
    required this.passes,
    required this.encoder,
    required this.outputBytes,
  });

  final String outputPath;
  final Duration elapsed;

  /// Wall clock per FFmpeg pass, scene clips first, the concat pass last.
  final List<Duration> passes;

  /// The video encoder the plan asked for, or the device substitute.
  final String encoder;
  final int outputBytes;

  Duration get encodeTime =>
      passes.fold(Duration.zero, (sum, pass) => sum + pass);
}

/// A pass failed, or the caller cancelled. `logs` holds the tail of the FFmpeg
/// output so the demo screen can show why, without dragging in a log viewer.
class RenderExecutionError implements Exception {
  const RenderExecutionError(this.detail, {this.label, this.logs});

  final String detail;
  final String? label;
  final String? logs;

  @override
  String toString() => label == null ? detail : '$label: $detail';
}

/// The Android build of FFmpeg has no libx264 (it is GPL), and the plan names
/// the worker's `h264` encoder. Retargeting rewrites only the output `-c:v`
/// token — everything after the last `-i` — so input codecs such as the brand
/// mark's VP9 stay untouched and the rest of the list matches the worker's.
List<String> retargetEncoder(List<String> args, String? encoder) {
  if (encoder == null) return args;
  final lastInput = args.lastIndexOf('-i');
  final retargeted = [...args];
  for (var index = lastInput + 1; index + 1 < retargeted.length; index += 1) {
    if (retargeted[index] == '-c:v') retargeted[index + 1] = encoder;
  }
  return retargeted;
}

/// Registers the bundled faces with the FFmpeg build's fontconfig.
///
/// The plan's watermark compiles to a `drawtext` with no `fontfile`, so it asks
/// fontconfig for the default family. A worker host answers from its system
/// font directory; the Android build has no such directory and fails the pass
/// with `Cannot find a valid font for the family Sans`. Registering the
/// bundle's `fonts/` makes the same argument list run on the phone, without
/// touching the compiled plan: [family] is mapped onto the bundled [face].
Future<void> registerBundledFonts(
  String fontsDir, {
  String family = 'Sans',
  String face = 'Inter SemiBold',
}) => FFmpegKitConfig.setFontDirectory(fontsDir, {family: face});

/// Writes the ASS files and the concat list the compiled job points at. The
/// files are the exact bytes the compiler produced, so the concat list stays
/// the same text the worker feeds FFmpeg.
Future<void> writeJobInputs(RenderPlanJob job) async {
  for (final clip in job.clips) {
    final assPath = clip.assPath;
    final contents = clip.assContents;
    if (assPath == null || contents == null) continue;
    final file = File(assPath);
    await file.parent.create(recursive: true);
    await file.writeAsString(contents, flush: true);
  }
  final list = File(job.listPath);
  await list.parent.create(recursive: true);
  await list.writeAsString(job.listContents, flush: true);
}

/// Runs a compiled job on the device. One instance renders one job; call
/// [cancel] to stop the pass that is running.
class RenderPlanExecutor {
  RenderPlanExecutor({this.videoEncoder, this.logTailLines = 40});

  /// Replaces the plan's `-c:v` token for every pass, e.g. with
  /// `h264_mediacodec` on a build without libx264. `null` runs the plan as
  /// compiled.
  final String? videoEncoder;

  /// How much FFmpeg output to keep for an error report.
  final int logTailLines;

  /// What a device build can encode when the plan names [planEncoder]. The
  /// FFmpeg build that ships with the app has no libx264 (GPL), so `h264` maps
  /// to the platform encoder where one exists; every other token is passed
  /// through untouched.
  static String defaultDeviceEncoder(String planEncoder) {
    if (planEncoder != 'h264') return planEncoder;
    if (Platform.isAndroid) return 'h264_mediacodec';
    if (Platform.isIOS || Platform.isMacOS) return 'h264_videotoolbox';
    return planEncoder;
  }

  FFmpegSession? _session;
  bool _cancelled = false;

  /// Asks FFmpeg to stop. Resolves once the cancel request is dispatched; the
  /// running [execute] call then fails with a [RenderExecutionError].
  Future<void> cancel() async {
    _cancelled = true;
    final session = _session;
    if (session != null) await FFmpegKit.cancel(session.getSessionId());
  }

  /// Runs every scene pass, then the concat pass, and reports the output file.
  /// A scene whose media is missing never reaches here: the compiler already
  /// failed closed.
  Future<RenderReport> execute(
    RenderPlanJob job, {
    void Function(RenderProgress progress)? onProgress,
  }) async {
    if (job.clips.isEmpty) {
      throw const RenderExecutionError('the plan has no scenes to render');
    }
    onProgress?.call(
      const RenderProgress(
        stage: RenderStage.writing,
        percent: 0,
        label: 'Writing captions and concat list',
      ),
    );
    await writeJobInputs(job);

    final clipMs = job.totalMs.toDouble();
    final totalMs = math.max(1.0, clipMs * 2);
    final passes = <Duration>[];
    final clock = Stopwatch()..start();
    var done = 0.0;

    for (var index = 0; index < job.clips.length; index += 1) {
      final clip = job.clips[index];
      final elapsed = await _runPass(
        args: retargetEncoder(clip.args, videoEncoder),
        label: 'Scene ${index + 1} of ${job.clips.length}',
        stage: RenderStage.scene,
        sceneIndex: index,
        sceneCount: job.clips.length,
        offset: done,
        spanMs: clip.scene.durationMs.toDouble(),
        totalMs: totalMs,
        onProgress: onProgress,
      );
      passes.add(elapsed);
      done += clip.scene.durationMs.toDouble();
    }

    final elapsed = await _runPass(
      args: retargetEncoder(job.concatArgs, videoEncoder),
      label: 'Brand, bed and concat',
      stage: RenderStage.concat,
      sceneIndex: job.clips.length - 1,
      sceneCount: job.clips.length,
      offset: done,
      spanMs: clipMs,
      totalMs: totalMs,
      onProgress: onProgress,
    );
    passes.add(elapsed);

    final output = File(job.concatArgs.last);
    final bytes = await output.exists() ? await output.length() : 0;
    if (bytes == 0) {
      throw RenderExecutionError(
        'FFmpeg reported success but ${output.path} is empty',
        label: 'Brand, bed and concat',
      );
    }
    onProgress?.call(
      const RenderProgress(
        stage: RenderStage.done,
        percent: 1,
        label: 'Reel written',
      ),
    );
    clock.stop();
    return RenderReport(
      outputPath: output.path,
      elapsed: clock.elapsed,
      passes: passes,
      encoder: videoEncoder ?? job.encodeVideo,
      outputBytes: bytes,
    );
  }

  /// Runs one FFmpeg pass, translating per-session statistics into a slice of
  /// the whole job's progress.
  Future<Duration> _runPass({
    required List<String> args,
    required String label,
    required RenderStage stage,
    required int sceneIndex,
    required int sceneCount,
    required double offset,
    required double spanMs,
    required double totalMs,
    required void Function(RenderProgress progress)? onProgress,
  }) async {
    if (_cancelled) {
      throw RenderExecutionError('cancelled before $label', label: label);
    }
    final clock = Stopwatch()..start();
    final finished = Completer<FFmpegSession>();
    var reported = -1.0;
    final session = await FFmpegKit.executeWithArgumentsAsync(
      args,
      (FFmpegSession completed) {
        if (!finished.isCompleted) finished.complete(completed);
      },
      null,
      (Statistics stats) {
        final callback = onProgress;
        if (callback == null || spanMs <= 0) return;
        final seen = math.min(stats.getTime().toDouble(), spanMs);
        final percent = math.min(1.0, (offset + seen) / totalMs);
        if (percent - reported < 0.01) return;
        reported = percent;
        callback(
          RenderProgress(
            stage: stage,
            percent: percent,
            label: label,
            sceneIndex: sceneIndex,
            sceneCount: sceneCount,
          ),
        );
      },
    );
    _session = session;
    final completed = await finished.future;
    clock.stop();
    _session = null;

    final code = await completed.getReturnCode();
    if (_cancelled || ReturnCode.isCancel(code)) {
      throw RenderExecutionError('cancelled during $label', label: label);
    }
    if (!ReturnCode.isSuccess(code)) {
      final logs = await completed.getAllLogsAsString();
      final trace = await completed.getFailStackTrace();
      throw RenderExecutionError(
        'FFmpeg exited with ${code?.getValue() ?? 'no return code'}'
        '${trace == null || trace.isEmpty ? '' : ' ($trace)'}',
        label: label,
        logs: logTail(logs, lines: logTailLines),
      );
    }
    return clock.elapsed;
  }
}

/// Runs one FFmpeg argument list to completion and throws on a non-zero exit.
/// Used for the small side jobs (bundled asset extraction, sample media) that
/// are not part of the compiled plan.
Future<void> runFfmpeg(List<String> args, {required String label}) async {
  final session = await FFmpegKit.executeWithArguments(args);
  final code = await session.getReturnCode();
  if (ReturnCode.isSuccess(code)) return;
  final logs = await session.getAllLogsAsString();
  throw RenderExecutionError(
    'FFmpeg exited with ${code?.getValue() ?? 'no return code'}',
    label: label,
    logs: logTail(logs),
  );
}

/// The last [lines] non-empty lines of FFmpeg output, for error surfaces.
String? logTail(String? logs, {int lines = 40}) {
  if (logs == null) return null;
  final kept = logs
      .split('\n')
      .where((line) => line.trim().isNotEmpty)
      .toList();
  if (kept.isEmpty) return null;
  final start = math.max(0, kept.length - lines);
  return kept.sublist(start).join('\n');
}
