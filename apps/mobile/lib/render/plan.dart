/// Platform neutral render plan v1, the Dart half of
/// `packages/reel-engine/src/render-plan.ts`.
///
/// The plan is the whole contract between whoever decides what a reel is (the
/// engine) and whoever draws it (the worker today, this app in the spike):
/// every number the renderer used to hard-code lives in the plan, media is
/// referenced by opaque `ref` strings this device resolves locally, and the
/// same plan produces the same frames on the server and on the phone.
library;

import '../api.dart';

/// Plan envelope marker; a plan carrying anything else is refused.
const renderPlanSchema = 'fmotion.render-plan';

/// Plan shape this reader understands. A newer version is refused, not guessed.
const renderPlanVersion = 1;

/// Asset id this app resolves to its own bundled copy of the brand mark.
const renderPlanBrandMarkRef = 'brand_mark';

/// Frame rate every renderer emits; carried in the plan so it can be checked.
const renderPlanFps = 30;

/// Catalog beds travel as `music:<stock id>` so no path crosses the seam.
const renderPlanMusicPrefix = 'music:';

/// Faces the plan asks for: Inter Display ExtraBold titles, Inter SemiBold
/// captions. The ASS the worker burns and the text this app draws use them.
class RenderPlanFonts {
  const RenderPlanFonts({required this.title, required this.caption});

  final String title;
  final String caption;
}

const renderPlanFonts = RenderPlanFonts(
  title: 'Inter Display ExtraBold',
  caption: 'Inter SemiBold',
);

/// Stock id inside a `music:` ref, or null for a renderer-local ref.
String? renderPlanMusicId(String ref) {
  if (!ref.startsWith(renderPlanMusicPrefix)) return null;
  final id = ref.substring(renderPlanMusicPrefix.length);
  return id.isEmpty ? null : id;
}

String renderPlanMusicRef(String stockId) => '$renderPlanMusicPrefix$stockId';

/// Encoder settings both renderers target: H.264 8 Mbit, yuv420p, AAC stereo
/// at 44.1 kHz.
class RenderPlanEncode {
  const RenderPlanEncode({
    required this.video,
    required this.videoBitrate,
    required this.pixelFormat,
    required this.audio,
    required this.audioRate,
    required this.audioChannels,
  });

  final String video;
  final String videoBitrate;
  final String pixelFormat;
  final String audio;
  final num audioRate;
  final num audioChannels;

  JsonMap toJson() => {
    'video': video,
    'video_bitrate': videoBitrate,
    'pixel_format': pixelFormat,
    'audio': audio,
    'audio_rate': audioRate,
    'audio_channels': audioChannels,
  };
}

const renderPlanEncodeDefaults = RenderPlanEncode(
  video: 'h264',
  videoBitrate: '8M',
  pixelFormat: 'yuv420p',
  audio: 'aac',
  audioRate: 44100,
  audioChannels: 2,
);

/// Thrown for every plan the reader refuses. The message names the field, so a
/// server side test and a device log point at the same place.
class RenderPlanError implements Exception {
  RenderPlanError(this.detail);
  final String detail;

  @override
  String toString() => 'invalid render plan: $detail';
}

Never _fail(String detail) => throw RenderPlanError(detail);

/// Parsed field accessors. Every one names the JSON path it read, so a bad plan
/// says `scenes[0].motion.axis must be one of x, y` and not just "bad plan".
String _string(JsonMap source, String key, String path) {
  final value = source[key];
  if (value is! String) _fail('$path.$key must be a string');
  return value;
}

num _number(JsonMap source, String key, String path) {
  final value = source[key];
  if (value is! num) _fail('$path.$key must be a number');
  return value;
}

bool _boolean(JsonMap source, String key, String path) {
  final value = source[key];
  if (value is! bool) _fail('$path.$key must be a boolean');
  return value;
}

JsonMap _record(JsonMap source, String key, String path) {
  final value = source[key];
  if (value is! Map) _fail('$path.$key must be an object');
  return _asMap(value);
}

JsonMap? _nullableRecord(JsonMap source, String key, String path) {
  final value = source[key];
  if (value == null) return null;
  if (value is! Map) _fail('$path.$key must be an object or null');
  return _asMap(value);
}

JsonMap _asMap(Object? value) {
  if (value is! Map) _fail('value must be an object');
  return {for (final entry in value.entries) entry.key.toString(): entry.value};
}

String _enumValue(
  JsonMap source,
  String key,
  String path,
  List<String> allowed,
) {
  final value = source[key];
  if (value is! String || !allowed.contains(value)) {
    _fail('$path.$key must be one of ${allowed.join(', ')}');
  }
  return value;
}

num _positive(num value, String path) {
  if (value <= 0) _fail('$path must be greater than zero');
  return value;
}

num _unit(num value, String path) {
  if (value < 0 || value > 1) _fail('$path must stay between 0 and 1');
  return value;
}

const _mediaKinds = ['still', 'video', 'none'];
const _motionTypes = ['none', 'zoom', 'push'];
const _motionAxes = ['x', 'y'];
const _fits = ['cover', 'contain'];
const _overlayLooks = ['caption', 'title', 'poster', 'spoken'];
const _overlayPlaces = ['bottom', 'center', 'top'];

/// What the renderer must feed a scene. Dimensions drive the pan axis.
class RenderPlanMedia {
  const RenderPlanMedia({
    required this.ref,
    required this.kind,
    required this.width,
    required this.height,
    required this.hasAudio,
  });

  /// Opaque local reference, empty only for the gray placeholder scene.
  final String ref;
  final String kind;
  final num width;
  final num height;
  final bool hasAudio;

  bool get isStill => kind == 'still';
  bool get isVideo => kind == 'video';

  JsonMap toJson() => {
    'ref': ref,
    'kind': kind,
    'width': width,
    'height': height,
    'has_audio': hasAudio,
  };
}

class RenderPlanCrop {
  const RenderPlanCrop({required this.focalX, required this.focalY});
  final num focalX;
  final num focalY;

  JsonMap toJson() => {'focal_x': focalX, 'focal_y': focalY};
}

/// One scene's eased travel. A `zoom` whose `zoomStart` is above `zoomEnd` is a
/// pull out, so the photo reel's alternating presets stay one motion type.
class RenderPlanMotion {
  const RenderPlanMotion({
    required this.type,
    required this.zoomStart,
    required this.zoomEnd,
    required this.panScale,
    required this.axis,
    required this.easing,
    required this.sampleScale,
  });

  final String type;
  final num zoomStart;
  final num zoomEnd;
  final num panScale;
  final String axis;
  final String easing;

  /// Source overscan before the motion, so the sampler never takes a tiny crop.
  final num sampleScale;

  bool get isNone => type == 'none';
  bool get isZoom => type == 'zoom';
  bool get isPush => type == 'push';

  /// True when the travel rises from `zoomStart` to `zoomEnd`.
  bool get rises => zoomEnd >= zoomStart;

  JsonMap toJson() => {
    'type': type,
    'zoom_start': zoomStart,
    'zoom_end': zoomEnd,
    'pan_scale': panScale,
    'axis': axis,
    'easing': easing,
    'sample_scale': sampleScale,
  };
}

class RenderPlanWord {
  const RenderPlanWord({
    required this.text,
    required this.startMs,
    required this.endMs,
  });

  final String text;
  final num startMs;
  final num endMs;

  JsonMap toJson() => {'text': text, 'start_ms': startMs, 'end_ms': endMs};
}

/// Burned overlay copy. `title` is already resolved by the engine: a title look
/// without a title borrows the caption, and then carries no caption words.
class RenderPlanOverlay {
  const RenderPlanOverlay({
    required this.look,
    required this.place,
    required this.title,
    required this.words,
    required this.fontTitle,
    required this.fontCaption,
  });

  final String look;
  final String place;
  final String? title;
  final List<RenderPlanWord> words;
  final String fontTitle;
  final String fontCaption;

  bool get isSpoken => look == 'spoken';
  bool get isTitle => look == 'title';
  bool get isPoster => look == 'poster';

  /// Last word end, the length of a caption with no explicit scene duration.
  num get lastWordEndMs => words.isEmpty ? 0 : words.last.endMs;

  JsonMap toJson() => {
    'look': look,
    'place': place,
    'title': title,
    'words': [for (final word in words) word.toJson()],
    'font_title': fontTitle,
    'font_caption': fontCaption,
  };
}

class RenderPlanScene {
  const RenderPlanScene({
    required this.id,
    required this.durationMs,
    required this.media,
    required this.crop,
    required this.motion,
    required this.overlay,
    required this.fit,
    required this.audioLevel,
  });

  final String id;
  final num durationMs;
  final RenderPlanMedia media;
  final RenderPlanCrop crop;
  final RenderPlanMotion motion;
  final RenderPlanOverlay? overlay;
  final String fit;
  final num audioLevel;

  /// Scene length as FFmpeg's `-t` sees it, matching the worker's clamp.
  double get seconds => durationMs / 1000;

  /// Frames this scene burns, the count the easing is sampled over.
  int get frames =>
      (durationMs / 1000 * renderPlanFps).round().clamp(2, 1 << 31);

  bool get isContain => fit == 'contain';

  JsonMap toJson() => {
    'id': id,
    'duration_ms': durationMs,
    'media': media.toJson(),
    'crop': crop.toJson(),
    'motion': motion.toJson(),
    'overlay': overlay?.toJson(),
    'fit': fit,
    'audio_level': audioLevel,
  };
}

class RenderPlanAudioTrack {
  const RenderPlanAudioTrack({
    required this.ref,
    required this.level,
    required this.offsetMs,
  });

  final String ref;
  final num level;
  final num offsetMs;

  JsonMap toJson() => {'ref': ref, 'level': level, 'offset_ms': offsetMs};
}

/// Licensed beds repeat under the reel, so the renderer loops the source.
class RenderPlanBed extends RenderPlanAudioTrack {
  const RenderPlanBed({
    required super.ref,
    required super.level,
    required super.offsetMs,
  });

  @override
  JsonMap toJson() => {...super.toJson(), 'loop': true};
}

/// Bed gain is ducked while a voice track is attached, exactly like the worker.
class RenderPlanAudio {
  const RenderPlanAudio({
    required this.bed,
    required this.voice,
    required this.duck,
  });

  final RenderPlanBed? bed;
  final RenderPlanAudioTrack? voice;
  final num duck;

  /// Gain the bed plays at once the voiceover duck is applied.
  num get bedGain {
    if (bed == null) return 1;
    final ducking = voice != null && voice!.level > 0 ? duck : 1;
    return _round3(_clampUnit(bed!.level) * ducking);
  }

  /// Gain the voiceover plays at.
  num get voiceGain => voice == null ? 1 : _clampUnit(voice!.level);

  JsonMap toJson() => {
    'bed': bed?.toJson(),
    'voice': voice?.toJson(),
    'duck': duck,
  };
}

class RenderPlanBrandMark {
  const RenderPlanBrandMark({
    required this.ref,
    required this.width,
    required this.x,
    required this.y,
    required this.opacity,
  });

  final String ref;
  final num width;
  final num x;
  final num y;
  final num opacity;

  JsonMap toJson() => {
    'ref': ref,
    'width': width,
    'x': x,
    'y': y,
    'opacity': opacity,
  };
}

num _clampUnit(num value) => value < 0 ? 0 : (value > 1 ? 1 : value);

num _round3(num value) => (value * 1000).round() / 1000;

/// One reel render, exactly as the engine described it.
///
/// Unknown fields are ignored so a v1 plan written before an additive field
/// still renders, but every field a renderer acts on is checked, including the
/// version: a v2 plan is refused, not guessed.
class RenderPlanV1 {
  const RenderPlanV1({
    required this.width,
    required this.height,
    required this.fps,
    required this.scenes,
    required this.audio,
    required this.brandMark,
    required this.watermark,
    required this.encode,
  });

  factory RenderPlanV1.parse(Object? value) {
    if (value is! Map) _fail('plan must be an object');
    final plan = _asMap(value);
    if (plan['schema'] != renderPlanSchema) {
      _fail('schema must be $renderPlanSchema');
    }
    if (plan['version'] != renderPlanVersion) {
      _fail('unsupported version ${plan['version']}');
    }
    final scenes = plan['scenes'];
    if (scenes is! List || scenes.isEmpty) {
      _fail('scenes must be a non-empty array');
    }
    final mark = _nullableRecord(plan, 'brand_mark', 'plan');
    return RenderPlanV1(
      width: _positive(_number(plan, 'width', 'plan'), 'width'),
      height: _positive(_number(plan, 'height', 'plan'), 'height'),
      fps: _positive(_number(plan, 'fps', 'plan'), 'fps'),
      scenes: [
        for (var index = 0; index < scenes.length; index += 1)
          _scene(scenes[index], 'scenes[$index]'),
      ],
      audio: _audio(_record(plan, 'audio', 'plan')),
      brandMark: mark == null ? null : _brandMark(mark),
      watermark: plan['watermark'] == null
          ? null
          : _string(plan, 'watermark', 'plan'),
      encode: _encode(_record(plan, 'encode', 'plan')),
    );
  }

  /// True when [value] is a plan this reader would render.
  static bool accepts(Object? value) {
    try {
      RenderPlanV1.parse(value);
      return true;
    } on RenderPlanError {
      return false;
    }
  }

  final num width;
  final num height;
  final num fps;
  final List<RenderPlanScene> scenes;
  final RenderPlanAudio audio;
  final RenderPlanBrandMark? brandMark;
  final String? watermark;
  final RenderPlanEncode encode;

  /// Honest total, the sum the concat sees, not the first scene only.
  num get totalMs =>
      scenes.fold<num>(0, (sum, scene) => sum + scene.durationMs);

  /// Width over height above 1 is a landscape plan, which sizes its own
  /// subtitle PlayRes and brand mark box.
  bool get isLandscape => width > height;

  JsonMap toJson() => {
    'schema': renderPlanSchema,
    'version': renderPlanVersion,
    'width': width,
    'height': height,
    'fps': fps,
    'scenes': [for (final scene in scenes) scene.toJson()],
    'audio': audio.toJson(),
    'brand_mark': brandMark?.toJson(),
    'watermark': watermark,
    'encode': encode.toJson(),
  };
}

RenderPlanMedia _media(JsonMap value, String path) => RenderPlanMedia(
  ref: _string(value, 'ref', path),
  kind: _enumValue(value, 'kind', path, _mediaKinds),
  width: _number(value, 'width', path),
  height: _number(value, 'height', path),
  hasAudio: _boolean(value, 'has_audio', path),
);

RenderPlanWord _word(Object? value, String path) {
  final word = _asMap(value);
  return RenderPlanWord(
    text: _string(word, 'text', path),
    startMs: _number(word, 'start_ms', path),
    endMs: _number(word, 'end_ms', path),
  );
}

RenderPlanOverlay _overlay(JsonMap value, String path) {
  final words = value['words'];
  if (words is! List) _fail('$path.words must be an array');
  return RenderPlanOverlay(
    look: _enumValue(value, 'look', path, _overlayLooks),
    place: _enumValue(value, 'place', path, _overlayPlaces),
    title: value['title'] == null ? null : _string(value, 'title', path),
    words: [
      for (var index = 0; index < words.length; index += 1)
        _word(words[index], '$path.words[$index]'),
    ],
    fontTitle: _string(value, 'font_title', path),
    fontCaption: _string(value, 'font_caption', path),
  );
}

String _constValue(JsonMap source, String key, String path, String allowed) {
  final value = source[key];
  if (value != allowed) _fail('$path.$key must be one of $allowed');
  return allowed;
}

RenderPlanScene _scene(Object? value, String path) {
  final scene = _asMap(value);
  final motion = _record(scene, 'motion', path);
  final motionPath = '$path.motion';
  final crop = _record(scene, 'crop', path);
  final cropPath = '$path.crop';
  final overlay = _nullableRecord(scene, 'overlay', path);
  return RenderPlanScene(
    id: _string(scene, 'id', path),
    durationMs: _positive(
      _number(scene, 'duration_ms', path),
      '$path.duration_ms',
    ),
    media: _media(_record(scene, 'media', path), '$path.media'),
    crop: RenderPlanCrop(
      focalX: _unit(_number(crop, 'focal_x', cropPath), '$cropPath.focal_x'),
      focalY: _unit(_number(crop, 'focal_y', cropPath), '$cropPath.focal_y'),
    ),
    motion: RenderPlanMotion(
      type: _enumValue(motion, 'type', motionPath, _motionTypes),
      zoomStart: _positive(
        _number(motion, 'zoom_start', motionPath),
        '$motionPath.zoom_start',
      ),
      zoomEnd: _positive(
        _number(motion, 'zoom_end', motionPath),
        '$motionPath.zoom_end',
      ),
      panScale: _positive(
        _number(motion, 'pan_scale', motionPath),
        '$motionPath.pan_scale',
      ),
      axis: _enumValue(motion, 'axis', motionPath, _motionAxes),
      easing: _constValue(motion, 'easing', motionPath, 'cosine'),
      sampleScale: _positive(
        _number(motion, 'sample_scale', motionPath),
        '$motionPath.sample_scale',
      ),
    ),
    overlay: overlay == null ? null : _overlay(overlay, '$path.overlay'),
    fit: _enumValue(scene, 'fit', path, _fits),
    audioLevel: _unit(_number(scene, 'audio_level', path), '$path.audio_level'),
  );
}

RenderPlanAudioTrack _track(JsonMap value, String path) => RenderPlanAudioTrack(
  ref: _string(value, 'ref', path),
  level: _unit(_number(value, 'level', path), '$path.level'),
  offsetMs: _number(value, 'offset_ms', path),
);

RenderPlanBed _bed(JsonMap value, String path) {
  if (value['loop'] != true) _fail('$path.loop must be true');
  return RenderPlanBed(
    ref: _string(value, 'ref', path),
    level: _unit(_number(value, 'level', path), '$path.level'),
    offsetMs: _number(value, 'offset_ms', path),
  );
}

RenderPlanAudio _audio(JsonMap value) {
  final bed = _nullableRecord(value, 'bed', 'audio');
  final voice = _nullableRecord(value, 'voice', 'audio');
  return RenderPlanAudio(
    bed: bed == null ? null : _bed(bed, 'audio.bed'),
    voice: voice == null ? null : _track(voice, 'audio.voice'),
    duck: _unit(_number(value, 'duck', 'audio'), 'audio.duck'),
  );
}

RenderPlanBrandMark _brandMark(JsonMap value) {
  const path = 'brand_mark';
  return RenderPlanBrandMark(
    ref: _string(value, 'ref', path),
    width: _positive(_number(value, 'width', path), '$path.width'),
    x: _number(value, 'x', path),
    y: _number(value, 'y', path),
    opacity: _unit(_number(value, 'opacity', path), '$path.opacity'),
  );
}

RenderPlanEncode _encode(JsonMap value) {
  const path = 'encode';
  return RenderPlanEncode(
    video: _constValue(value, 'video', path, 'h264'),
    videoBitrate: _string(value, 'video_bitrate', path),
    pixelFormat: _constValue(value, 'pixel_format', path, 'yuv420p'),
    audio: _constValue(value, 'audio', path, 'aac'),
    audioRate: _positive(
      _number(value, 'audio_rate', path),
      '$path.audio_rate',
    ),
    audioChannels: _positive(
      _number(value, 'audio_channels', path),
      '$path.audio_channels',
    ),
  );
}
