import 'dart:math' as math;

import 'plan.dart';

/// Render plan v1 compiler: plan + local assets -> FFmpeg arguments and ASS
/// documents. This is the Dart port of `apps/worker/src/compile-plan.ts` and it
/// must stay byte identical to it, so the same plan asks the phone's encoder
/// for the same frames the worker's encoder produces.
///
/// Nothing here touches the network: every asset is a local file path the
/// caller resolved from an opaque plan ref.

/// JavaScript number formatting: `1` not `1.0`, `0.5` not `0.50`. The worker
/// builds its filter strings from JS numbers, so parity depends on this.
String jsNumber(num value) {
  if (value is int) return value.toString();
  final double = value.toDouble();
  if (double.isFinite && double == double.roundToDouble()) {
    return double.toInt().toString();
  }
  return double.toString();
}

String _escapeDrawtext(String value) => value
    .replaceAll('\\', '\\\\')
    .replaceAll(':', '\\:')
    .replaceAll("'", "\\'");

/// `subtitles=PATH` is a filter option, so `:` and `'` need the same escaping
/// drawtext values do.
String _escapeFilterPath(String value) => _escapeDrawtext(value);

/// ASS Dialogue text has no native escape for a literal `{` / `}` (they open
/// override tags) or `\` (it can start `\N` / `\n` / `\h` codes), so they
/// become same-font ASCII look-alikes instead of font-fallback seams.
String escapeAssText(String value) => value
    .replaceAll('\\', '/')
    .replaceAll('{', '(')
    .replaceAll('}', ')')
    .replaceAll(RegExp(r'\r\n|\r|\n'), r'\N');

/// Lanczos cover-crop, the sampler this pipeline has always used for stills.
List<String> lanczosCoverCrop(num width, num height, num focalX, num focalY) =>
    [
      'scale=${jsNumber(width)}:${jsNumber(height)}'
          ':force_original_aspect_ratio=increase:flags=lanczos',
      'crop=${jsNumber(width)}:${jsNumber(height)}'
          ':(iw-ow)*${jsNumber(focalX)}:(ih-oh)*${jsNumber(focalY)}',
    ];

/// Ease-in-out progress 0..1 over output frame `on` (the zoompan counter).
String easeExpr(int frames) => '(0.5-0.5*cos(PI*on/${frames - 1}))';

/// zoompan expression for one scene's plan motion. A motion whose `zoomEnd` is
/// above `zoomStart` zooms in, and one below it is the same eased travel
/// reversed, so the photo reel's alternating presets need no preset names here.
/// `none` means no filter at all.
String? motionFilter(
  RenderPlanMotion motion,
  double durationSeconds,
  num width,
  num height,
  num fps,
) {
  if (motion.isNone) return null;
  final frames = math.max(2, (durationSeconds * fps).round());
  final ease = easeExpr(frames);
  final rise = motion.rises;
  final range = (motion.zoomEnd - motion.zoomStart).abs().toStringAsFixed(4);
  const centred = "x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'";
  final size =
      'd=1:s=${jsNumber(width)}x${jsNumber(height)}:fps=${jsNumber(fps)}';
  if (motion.isZoom) {
    final sign = rise ? '+' : '-';
    return "zoompan=z='${jsNumber(motion.zoomStart)}$sign$range*$ease'"
        ':$centred:$size';
  }
  // "push" is a Ken Burns pan, not a transition. Wide sources pan X; tall
  // sources pan Y so the extra cover-crop pixels actually move.
  final scale = jsNumber(motion.panScale);
  if (motion.axis == 'x') {
    return "zoompan=z=$scale:x='(iw-iw/zoom)*$ease'"
        ":y='ih/2-(ih/zoom/2)':$size";
  }
  return "zoompan=z=$scale:x='iw/2-(iw/zoom/2)'"
      ":y='(ih-ih/zoom)*$ease':$size";
}

/// Overlay text keeps 6% of the frame width clear on each side.
const overlaySafeInset = 0.06;

int overlaySideMargin(num playResWidth) =>
    (playResWidth * overlaySafeInset).ceil();

const assWhite = '&H00FFFFFF';
const assBlack = '&H00000000';
const captionPill = '&H61000000';

String _assStyle(
  String name,
  String font,
  num size,
  String back,
  num spacing,
  int borderStyle,
  num outline,
  num shadow, {
  String secondary = '&H00AAAAAA',
  int? align,
  num? left,
  num? right,
  num? vertical,
  num? side,
}) {
  final alignment = align ?? 2;
  // A look may ask for more inset than the safe zone, never less.
  final marginLeft = math.max(side ?? overlaySideMargin(720), left ?? 0);
  final marginRight = math.max(side ?? overlaySideMargin(720), right ?? 0);
  final marginVertical = vertical ?? 140;
  return 'Style: $name,$font,${jsNumber(size)},$assWhite,$secondary,'
      '$assBlack,$back,0,0,0,0,100,100,${jsNumber(spacing)},0,$borderStyle,'
      '${jsNumber(outline)},${jsNumber(shadow)},$alignment,'
      '${jsNumber(marginLeft)},${jsNumber(marginRight)},'
      '${jsNumber(marginVertical)},1';
}

/// ASS style pair for one look, sized to the plan's PlayRes width.
class AssStyles {
  const AssStyles({
    required this.title,
    required this.caption,
    required this.titleSize,
    required this.captionSize,
  });

  final String title;
  final String caption;
  final int titleSize;
  final int captionSize;
}

AssStyles overlayAssStyles(
  String look,
  RenderPlanFonts fonts, [
  num playResWidth = 720,
]) {
  final side = overlaySideMargin(playResWidth);
  String style(
    String name,
    String font,
    int size,
    String back,
    num spacing,
    int borderStyle,
    num outline,
    num shadow, {
    String? secondary,
    int? align,
    num? left,
    num? right,
    num? vertical,
  }) => _assStyle(
    name,
    font,
    size,
    back,
    spacing,
    borderStyle,
    outline,
    shadow,
    secondary: secondary ?? '&H00AAAAAA',
    align: align,
    left: left,
    right: right,
    vertical: vertical,
    side: side,
  );

  if (look == 'title') {
    return AssStyles(
      title: style('Title', fonts.title, 78, assBlack, -3, 1, 3, 2),
      caption: style('Caption', fonts.caption, 26, captionPill, 0, 3, 8, 0),
      titleSize: 78,
      captionSize: 26,
    );
  }
  if (look == 'poster') {
    return AssStyles(
      title: style('Title', fonts.title, 52, assBlack, -2, 1, 2, 2),
      caption: style('Caption', fonts.caption, 26, assBlack, 0, 1, 0, 1),
      titleSize: 52,
      captionSize: 26,
    );
  }
  if (look == 'spoken') {
    return AssStyles(
      title: style('Title', fonts.title, 68, assBlack, -1, 1, 3, 2),
      caption: style(
        'Caption',
        fonts.title,
        68,
        assBlack,
        -1,
        1,
        3,
        2,
        secondary: '&H80FFFFFF',
        align: 5,
        left: 80,
        right: 80,
        vertical: 0,
      ),
      titleSize: 68,
      captionSize: 68,
    );
  }
  return AssStyles(
    title: style('Title', fonts.title, 64, assBlack, -2, 1, 2, 3),
    caption: style('Caption', fonts.caption, 26, captionPill, 0, 3, 8, 0),
    titleSize: 64,
    captionSize: 26,
  );
}

/// ASS WrapStyle 0 wraps on spaces only, so one long word walks straight past
/// the safe zone. A line whose longest word does not fit takes a font-size
/// override; a word too wide even shrunk is hard-broken instead.
const overlayGlyphAdvance = 0.75;
const overlayMinScale = 0.55;

class OverlayTextFit {
  const OverlayTextFit({this.fontSize, this.chunk});

  /// Font size override for the line, when the style size is too wide.
  final int? fontSize;

  /// Characters per line for a word too wide even at the smallest size.
  final int? chunk;

  bool get isEmpty => fontSize == null && chunk == null;
}

OverlayTextFit fitOverlayText(List<String> words, num size, num safeWidth) {
  final longest = words.fold<int>(
    0,
    (max, word) => math.max(max, word.trim().length),
  );
  if (longest == 0) return const OverlayTextFit();
  double expected(num chars, num at) => chars * at * overlayGlyphAdvance;
  if (expected(longest, size) <= safeWidth) return const OverlayTextFit();
  final scale = safeWidth / expected(longest, size);
  if (scale >= overlayMinScale) {
    return OverlayTextFit(fontSize: math.max(16, (size * scale).floor()));
  }
  return OverlayTextFit(
    chunk: math.max(1, (safeWidth / (size * overlayGlyphAdvance)).floor()),
  );
}

/// `\N` inside a word is the only line break ASS honors without a space.
String breakOverlayWord(String word, int chunk) {
  if (word.length <= chunk) return escapeAssText(word);
  final pieces = <String>[];
  for (var index = 0; index < word.length; index += chunk) {
    pieces.add(
      escapeAssText(
        word.substring(index, math.min(index + chunk, word.length)),
      ),
    );
  }
  return pieces.join(r'\N');
}

String overlayAssText(String text, [int? chunk]) {
  if (chunk == null) return escapeAssText(text);
  return text.split(' ').map((word) => breakOverlayWord(word, chunk)).join(' ');
}

class OverlayLayoutBox {
  const OverlayLayoutBox({
    required this.an,
    required this.titleV,
    required this.captionV,
    required this.marginL,
    required this.marginR,
  });

  final int an;
  final num titleV;
  final num captionV;
  final int marginL;
  final int marginR;
}

OverlayLayoutBox overlayLayout(
  String? place,
  bool hasTitle,
  bool hasCaption,
  String look,
) {
  if (look == 'spoken') {
    return const OverlayLayoutBox(
      an: 5,
      titleV: 0,
      captionV: 0,
      marginL: 80,
      marginR: 80,
    );
  }
  if (look == 'poster') {
    if (place == 'top') {
      return OverlayLayoutBox(
        an: 7,
        titleV: 36,
        captionV: hasTitle ? 110 : 36,
        marginL: 0,
        marginR: 0,
      );
    }
    if (place == 'center') {
      return OverlayLayoutBox(
        an: 4,
        titleV: hasCaption ? 24 : 0,
        captionV: hasTitle ? 24 : 0,
        marginL: 0,
        marginR: 0,
      );
    }
    return OverlayLayoutBox(
      an: 1,
      titleV: hasCaption ? 96 : 36,
      captionV: 36,
      marginL: 0,
      marginR: 0,
    );
  }
  if (place == 'top') {
    return OverlayLayoutBox(
      an: 8,
      titleV: 88,
      captionV: hasTitle ? 176 : 88,
      marginL: 0,
      marginR: 0,
    );
  }
  if (place == 'center') {
    return OverlayLayoutBox(
      an: 8,
      titleV: hasCaption ? 500 : 560,
      captionV: hasTitle ? 590 : 560,
      marginL: 0,
      marginR: 0,
    );
  }
  return OverlayLayoutBox(
    an: 2,
    titleV: hasCaption ? 228 : 0,
    captionV: 0,
    marginL: 0,
    marginR: 0,
  );
}

String _assDialogue(
  String style,
  num startMs,
  num endMs,
  String text,
  num marginV,
  int an, [
  OverlayTextFit fit = const OverlayTextFit(),
]) {
  final tags = [
    if (fit.fontSize != null) '\\fs${fit.fontSize}',
    if (an != 2) '\\an$an',
  ].join();
  final tag = tags.isEmpty ? '' : '{$tags}';
  return 'Dialogue: 0,${assTimestamp(startMs)},${assTimestamp(endMs)},'
      '$style,,0,0,${jsNumber(marginV)},,$tag'
      '${overlayAssText(text, fit.chunk)}';
}

String _assKaraokeDialogue(
  String style,
  List<RenderPlanWord> words,
  num marginV,
  int an, {
  int marginL = 0,
  int marginR = 0,
  OverlayTextFit fit = const OverlayTextFit(),
}) {
  final startMs = words.isEmpty ? 0 : words.first.startMs;
  final endMs = words.isEmpty ? 0 : words.last.endMs;
  final align = [
    if (fit.fontSize != null) '\\fs${fit.fontSize}',
    if (an != 2) '\\an$an',
  ].join();
  final buffer = StringBuffer();
  for (var index = 0; index < words.length; index += 1) {
    final word = words[index];
    final cs = math.max(1, ((word.endMs - word.startMs) / 10).round());
    final open = index == 0 && align.isNotEmpty ? '{$align\\k$cs}' : '{\\k$cs}';
    if (index > 0) buffer.write(' ');
    buffer.write('$open${overlayAssText(word.text, fit.chunk)}');
  }
  return 'Dialogue: 0,${assTimestamp(startMs)},${assTimestamp(endMs)},'
      '$style,,$marginL,$marginR,${jsNumber(marginV)},,${buffer.toString()}';
}

/// Formats milliseconds as an ASS timestamp: `h:mm:ss.cc` (centiseconds).
String assTimestamp(num ms) {
  final centiseconds = (ms / 10).round();
  final hundredths = centiseconds % 100;
  final totalSeconds = (centiseconds / 100).floor();
  final seconds = totalSeconds % 60;
  final totalMinutes = (totalSeconds / 60).floor();
  final minutes = totalMinutes % 60;
  final hours = (totalMinutes / 60).floor();
  return '$hours:${minutes.toString().padLeft(2, '0')}:'
      '${seconds.toString().padLeft(2, '0')}.'
      '${hundredths.toString().padLeft(2, '0')}';
}

/// Deterministic ASS subtitle document for one overlay, exactly as the plan
/// describes it. Portrait stays PlayRes 720x1280. A landscape plan uses its own
/// PlayRes so captions are not mapped through a portrait script.
String captionAss(
  RenderPlanOverlay overlay,
  num? durationMs, {
  num? playResWidth,
  num? playResHeight,
}) {
  final look = overlay.look;
  // Title copy is set in caps; every other look keeps the authored case.
  final title = look == 'title'
      ? (overlay.title ?? '').toUpperCase()
      : (overlay.title ?? '');
  final captionWords = overlay.words;
  final layout = overlayLayout(
    overlay.place,
    title.isNotEmpty,
    captionWords.isNotEmpty,
    look,
  );
  final landscape =
      playResWidth != null &&
      playResHeight != null &&
      playResWidth > playResHeight;
  final num width = landscape ? playResWidth : 720;
  final styles = overlayAssStyles(
    look,
    RenderPlanFonts(title: overlay.fontTitle, caption: overlay.fontCaption),
    width,
  );
  final safeWidth = width - 2 * overlaySideMargin(width);
  // A scene title spans the whole scene; a caption spans its words.
  final titleEnd = durationMs ?? overlay.lastWordEndMs;
  final titleFit = title.isNotEmpty
      ? fitOverlayText([title], styles.titleSize, safeWidth)
      : const OverlayTextFit();
  final captionFit = captionWords.isNotEmpty
      ? fitOverlayText(
          [for (final word in captionWords) word.text],
          styles.captionSize,
          safeWidth,
        )
      : const OverlayTextFit();
  final dialogues = [
    if (title.isNotEmpty && titleEnd > 0)
      _assDialogue(
        'Title',
        0,
        titleEnd,
        title,
        layout.titleV,
        layout.an,
        titleFit,
      ),
    if (captionWords.isNotEmpty)
      _assKaraokeDialogue(
        'Caption',
        captionWords,
        layout.captionV,
        layout.an,
        marginL: layout.marginL,
        marginR: layout.marginR,
        fit: captionFit,
      ),
  ];
  return [
    '[Script Info]',
    'ScriptType: v4.00+',
    'PlayResX: ${jsNumber(width)}',
    'PlayResY: ${jsNumber(landscape ? playResHeight : 1280)}',
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, '
        'OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, '
        'ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, '
        'Alignment, MarginL, MarginR, MarginV, Encoding',
    styles.title,
    styles.caption,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, '
        'Effect, Text',
    ...dialogues,
    '',
  ].join('\n');
}

/// POSIX path join, mirroring `node:path` for the two-segment cases the plan
/// compiler builds. Device paths are Android paths, so this stays POSIX.
String joinPath(String dir, String name) {
  if (dir.isEmpty) return name;
  return dir.endsWith('/') ? '$dir$name' : '$dir/$name';
}

List<String> vfArgs(List<String> filters) =>
    filters.isEmpty ? const [] : ['-vf', filters.join(',')];

List<String> captionFilters(String? captionAssPath, String fontsDir) {
  if (captionAssPath == null) return const [];
  return [
    'subtitles=${_escapeFilterPath(captionAssPath)}'
        ':fontsdir=${_escapeFilterPath(fontsDir)}',
  ];
}

List<String> watermarkFilters(String watermark) => [
  'drawbox=x=24:y=ih-100:w=iw-48:h=64:color=black@0.65:t=fill',
  "drawtext=text='${_escapeDrawtext(watermark)}':x=(w-text_w)/2:y=h-78"
      ':fontcolor=white:fontsize=28',
];

/// `h264` lets FFmpeg pick the available encoder (libx264 in the worker's
/// build, MediaCodec or OpenH264 on the phone). Every rate comes from the plan
/// so both renderers ask for the same stream.
List<String> clipVideoEncode(RenderPlanV1 plan) => [
  '-c:v',
  plan.encode.video,
  '-r',
  jsNumber(plan.fps),
  '-b:v',
  plan.encode.videoBitrate,
  '-pix_fmt',
  plan.encode.pixelFormat,
  '-movflags',
  '+faststart',
];

List<String> clipAudioEncode(RenderPlanV1 plan) => [
  '-c:a',
  plan.encode.audio,
  '-ar',
  jsNumber(plan.encode.audioRate),
  '-ac',
  jsNumber(plan.encode.audioChannels),
];

List<String> concatOutputArgs(
  RenderPlanV1 plan, {
  required bool encodeVideo,
  bool mixdown = false,
}) {
  if (encodeVideo) return [...clipVideoEncode(plan), ...clipAudioEncode(plan)];
  if (mixdown) {
    return [
      '-c:v',
      'copy',
      ...clipAudioEncode(plan),
      '-movflags',
      '+faststart',
    ];
  }
  return ['-c:v', 'copy', '-c:a', 'copy', '-movflags', '+faststart'];
}

/// The voiceover ducks the licensed bed by a constant gain while attached.
/// Upgrade: a sidechain compressor once dialogue is actually present.
List<String> audioFilterArgs(num audioLevel) {
  final level = audioLevel < 0 ? 0 : (audioLevel > 1 ? 1 : audioLevel);
  return level == 1 ? const [] : ['-af', 'volume=${jsNumber(level)}'];
}

List<String> silentAudioInput(num duration) => [
  '-f',
  'lavfi',
  '-t',
  jsNumber(duration),
  '-i',
  'anullsrc=r=44100:cl=stereo',
];

List<String> clipOutputArgs(
  RenderPlanV1 plan,
  String videoMap,
  String audioMap,
) => [
  '-map',
  videoMap,
  '-map',
  audioMap,
  ...clipVideoEncode(plan),
  ...clipAudioEncode(plan),
];

/// Contain keeps the whole picture: a blurred cover of the same source fills
/// the frame and carries the motion, and the picture itself is scaled to fit
/// inside the frame without being zoomed. Overlay text is burned after the
/// composite in both fits, so the motion never scales or crops it.
String containChain(
  RenderPlanV1 plan,
  RenderPlanScene scene,
  String? motion,
  List<String> captions,
) {
  final sample = scene.motion.sampleScale;
  final backdrop = [
    ...lanczosCoverCrop(
      plan.width * sample,
      plan.height * sample,
      scene.crop.focalX,
      scene.crop.focalY,
    ),
    ?motion,
    'gblur=sigma=${math.max(8, (plan.height / 60).round())}',
    'eq=brightness=-0.14:saturation=0.85',
  ];
  final picture = [
    'scale=${jsNumber(plan.width)}:${jsNumber(plan.height)}'
        ':force_original_aspect_ratio=decrease:flags=lanczos',
    'setsar=1',
  ];
  final composite =
      'overlay=(W-w)/2:(H-h)/2:shortest=1'
      '${captions.isEmpty ? '' : ',${captions.join(',')}'},setsar=1';
  return [
    '[0:v]split=2[fill][whole]',
    '[fill]${backdrop.join(',')}[back]',
    '[whole]${picture.join(',')}[fit]',
    '[back][fit]$composite[vout]',
  ].join(';');
}

/// One scene clip: inputs, filters and encodes. `mediaPath` is the file the
/// plan's media ref resolved to, or null only for the plan's gray placeholder
/// scene.
List<String> sceneClipArguments(
  RenderPlanV1 plan,
  RenderPlanScene scene,
  String? mediaPath,
  String clipPath, [
  String? captionAssPath,
  String? fontsDir,
]) {
  final duration = math.max(0.2, scene.durationMs / 1000);
  final captions = captionFilters(captionAssPath, fontsDir ?? '.');
  final motion = motionFilter(
    scene.motion,
    duration.toDouble(),
    plan.width,
    plan.height,
    plan.fps,
  );
  if (mediaPath != null) {
    final still = scene.media.isStill;
    final padAudio = still || !scene.media.hasAudio;
    final input = still
        ? [
            '-loop',
            '1',
            '-framerate',
            jsNumber(plan.fps),
            '-t',
            jsNumber(duration),
            '-i',
            mediaPath,
          ]
        : ['-stream_loop', '-1', '-t', jsNumber(duration), '-i', mediaPath];
    final audioInput = padAudio ? silentAudioInput(duration) : const <String>[];
    final audioMap = padAudio ? '1:a' : '0:a';
    if (scene.isContain) {
      return [
        '-y',
        ...input,
        ...audioInput,
        '-filter_complex',
        containChain(plan, scene, motion, captions),
        ...audioFilterArgs(scene.audioLevel),
        ...clipOutputArgs(plan, '[vout]', audioMap),
        clipPath,
      ];
    }
    // Ken Burns from a 2x cover so zoompan is not sampling an already-tiny crop.
    final sample = scene.motion.sampleScale;
    final cover = [
      ...lanczosCoverCrop(
        plan.width * sample,
        plan.height * sample,
        scene.crop.focalX,
        scene.crop.focalY,
      ),
      ?motion,
      ...captions,
    ];
    return [
      '-y',
      ...input,
      ...audioInput,
      ...vfArgs(cover),
      ...audioFilterArgs(scene.audioLevel),
      ...clipOutputArgs(plan, '0:v', audioMap),
      clipPath,
    ];
  }
  return [
    '-y',
    '-f',
    'lavfi',
    '-i',
    'color=c=#202027:s=${jsNumber(plan.width)}x${jsNumber(plan.height)}'
        ':d=${jsNumber(duration)}:r=${jsNumber(plan.fps)}',
    ...silentAudioInput(duration),
    ...vfArgs([?motion, ...captions]),
    ...audioFilterArgs(scene.audioLevel),
    ...clipOutputArgs(plan, '0:v', '1:a'),
    clipPath,
  ];
}

/// Local files and directories the plan's opaque refs resolve to.
class RenderPlanAssets {
  const RenderPlanAssets({
    required this.media,
    required this.fontsDir,
    this.brandMark,
  });

  /// Plan media ref -> absolute local path.
  final Map<String, String> media;

  /// File the plan's `brand_mark` ref resolves to.
  final String? brandMark;

  /// Directory holding the burnable faces (Inter Display / Inter).
  final String fontsDir;
}

/// Output tags, built by the caller that owns the snapshot.
class RenderPlanCompileMetadata {
  const RenderPlanCompileMetadata({
    required this.comment,
    this.soundtrack = const [],
  });

  /// `key=value` pair handed to `-metadata`, e.g. the project revision.
  final String comment;

  /// Extra `-metadata` pairs, e.g. the licensed soundtrack credit.
  final List<String> soundtrack;
}

class RenderPlanCompileOptions {
  const RenderPlanCompileOptions({
    required this.tempDir,
    required this.outputPath,
    required this.metadata,
  });

  final String tempDir;
  final String outputPath;
  final RenderPlanCompileMetadata metadata;
}

class SceneClip {
  const SceneClip({
    required this.scene,
    required this.path,
    required this.args,
    this.assPath,
    this.assContents,
  });

  final RenderPlanScene scene;
  final String path;
  final List<String> args;
  final String? assPath;
  final String? assContents;
}

/// One compiled reel: the scene clips, the concat list and the final pass.
class RenderPlanJob {
  const RenderPlanJob({
    required this.clips,
    required this.listPath,
    required this.listContents,
    required this.concatArgs,
    required this.encodeVideo,
  });

  final List<SceneClip> clips;
  final String listPath;
  final String listContents;
  final List<String> concatArgs;

  /// The plan's video encoder token, before any device substitution.
  final String encodeVideo;

  /// Total wall clock the plan asks for, before encoder overhead.
  num get totalMs =>
      clips.fold<num>(0, (sum, clip) => sum + clip.scene.durationMs);
}

/// The plan parsed, but a file it names is not on this device (or the caller
/// wired the compile call wrong). Rendering fails here rather than shipping a
/// gray frame or a silent reel.
class RenderCompileError implements Exception {
  const RenderCompileError(this.detail);

  final String detail;

  @override
  String toString() => 'render plan cannot be rendered: $detail';
}

Never _failCompile(String detail) => throw RenderCompileError(detail);

class _VideoChain {
  const _VideoChain({required this.filter, required this.label});

  final String filter;
  final String label;
}

_VideoChain _brandVideoChain(RenderPlanBrandMark mark, List<String> draws) {
  final parts = [
    '[1:v]scale=${jsNumber(mark.width)}:-1:flags=lanczos,format=yuva420p,'
        'colorchannelmixer=aa=${_fixed2(mark.opacity)}[mark]',
    '[0:v][mark]overlay=main_w-overlay_w-${jsNumber(mark.x)}'
        ':${jsNumber(mark.y)}:shortest=1:format=auto[branded]',
  ];
  if (draws.isEmpty) {
    return _VideoChain(filter: parts.join(';'), label: 'branded');
  }
  parts.add('[branded]${draws.join(',')}[vout]');
  return _VideoChain(filter: parts.join(';'), label: 'vout');
}

String _fixed2(num value) => value.toDouble().toStringAsFixed(2);

/// Final pass: concatenate the scene clips, burn the brand mark and watermark,
/// mix the audios and encode. Plain copy when the plan asks for neither an
/// overlay nor a mix, because re-encoding would only cost quality here.
List<String> concatArguments(
  String listPath,
  RenderPlanV1 plan,
  String outputPath,
  RenderPlanAssets assets,
  RenderPlanCompileMetadata metadata,
) {
  final bed = plan.audio.bed;
  final voice = plan.audio.voice;
  final bedPath = bed == null ? null : assets.media[bed.ref];
  if (bed != null && bedPath == null) {
    _failCompile('soundtrack media input missing');
  }
  final voicePath = voice == null ? null : assets.media[voice.ref];
  if (voice != null && voicePath == null) {
    _failCompile('voiceover media input missing');
  }
  final mark = plan.brandMark;
  if (mark != null && assets.brandMark == null) {
    _failCompile('brand mark asset missing');
  }
  final watermark = plan.watermark;
  final draws = watermark == null
      ? const <String>[]
      : watermarkFilters(watermark);
  final encodeVideo = draws.isNotEmpty || mark != null;
  if (bed == null && voice == null && mark == null) {
    return [
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      listPath,
      ...vfArgs(draws),
      '-metadata',
      metadata.comment,
      ...concatOutputArgs(plan, encodeVideo: encodeVideo),
      outputPath,
    ];
  }
  final extras = <String>[];
  final chains = <String>[];
  final mixInputs = <String>['[0:a]'];
  var next = mark != null ? 2 : 1;
  if (bed != null && bedPath != null) {
    if (bed.offsetMs > 0) extras.addAll(['-ss', _seconds(bed.offsetMs)]);
    extras.addAll(['-stream_loop', '-1', '-i', bedPath]);
    chains.add('[$next:a]volume=${jsNumber(plan.audio.bedGain)}[bed]');
    mixInputs.add('[bed]');
    next += 1;
  }
  if (voice != null && voicePath != null) {
    if (voice.offsetMs > 0) extras.addAll(['-ss', _seconds(voice.offsetMs)]);
    extras.addAll(['-i', voicePath]);
    chains.add('[$next:a]volume=${jsNumber(plan.audio.voiceGain)}[vo]');
    mixInputs.add('[vo]');
  }
  final brandMark = assets.brandMark;
  final branded = mark != null && brandMark != null
      ? _brandVideoChain(mark, draws)
      : null;
  final drawn = branded == null && draws.isNotEmpty
      ? _VideoChain(filter: '[0:v]${draws.join(',')}[vout]', label: 'vout')
      : null;
  final video = branded ?? drawn;
  final audioChain = bed != null || voice != null
      ? '${chains.join(';')};${mixInputs.join()}amix=inputs=${mixInputs.length}'
            ':duration=first:dropout_transition=0:normalize=0[a]'
      : '';
  final filter = [
    if (video != null) video.filter,
    if (audioChain.isNotEmpty) audioChain,
  ].join(';');
  return [
    '-y',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    listPath,
    if (mark != null && brandMark != null) ...[
      '-c:v',
      'libvpx-vp9',
      '-stream_loop',
      '-1',
      '-i',
      brandMark,
    ],
    ...extras,
    '-filter_complex',
    filter,
    '-map',
    video == null ? '0:v' : '[${video.label}]',
    '-map',
    audioChain.isEmpty ? '0:a' : '[a]',
    '-metadata',
    metadata.comment,
    ...metadata.soundtrack,
    ...concatOutputArgs(
      plan,
      encodeVideo: encodeVideo,
      mixdown: bed != null || voice != null,
    ),
    outputPath,
  ];
}

/// FFmpeg `-ss` wants seconds with millisecond precision.
String _seconds(num offsetMs) =>
    (offsetMs / 1000).toDouble().toStringAsFixed(3);

String concatListLine(String clipPath) =>
    "file '${clipPath.replaceAll("'", "'\\''")}'\n";

/// Compile a plan into a render job: one FFmpeg argument list per scene, the
/// concat list, and the final concat arguments. `assets` are the files the
/// plan's refs resolve to; a declared ref with no file fails closed instead of
/// substituting a gray frame.
RenderPlanJob compileRenderPlan(
  RenderPlanV1 plan,
  RenderPlanAssets assets,
  RenderPlanCompileOptions options,
) {
  final clips = <SceneClip>[];
  for (var index = 0; index < plan.scenes.length; index += 1) {
    final scene = plan.scenes[index];
    final mediaPath = scene.media.kind == 'none'
        ? null
        : assets.media[scene.media.ref];
    if (scene.media.kind != 'none' && mediaPath == null) {
      _failCompile('scene media input missing (${scene.media.ref})');
    }
    final path = joinPath(options.tempDir, 'scene-$index.mp4');
    final overlay = scene.overlay;
    final assPath = overlay == null
        ? null
        : joinPath(options.tempDir, 'scene-$index.ass');
    final assContents = overlay == null
        ? null
        : captionAss(
            overlay,
            scene.durationMs,
            playResWidth: plan.width,
            playResHeight: plan.height,
          );
    clips.add(
      SceneClip(
        scene: scene,
        path: path,
        assPath: assPath,
        assContents: assContents,
        args: sceneClipArguments(
          plan,
          scene,
          mediaPath,
          path,
          assPath,
          assets.fontsDir,
        ),
      ),
    );
  }
  final listPath = joinPath(options.tempDir, 'concat-list.txt');
  return RenderPlanJob(
    clips: clips,
    listPath: listPath,
    listContents: clips.map((clip) => concatListLine(clip.path)).join(),
    encodeVideo: plan.encode.video,
    concatArgs: concatArguments(
      listPath,
      plan,
      options.outputPath,
      assets,
      options.metadata,
    ),
  );
}
