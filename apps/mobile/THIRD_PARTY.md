# Third-party notices — on-device render prototype

The render bench adds two third-party pieces to the app. Everything else on the
render path is first-party code shared with the worker; no other dependency was
added for this spike.

## Bundled font files

`assets/render/fonts/InterDisplay-ExtraBold.ttf` and
`assets/render/fonts/Inter-SemiBold.ttf` are unmodified release files from the
[Inter](https://github.com/rsms/inter) project, © 2016 The Inter Project
Authors, licensed under the **SIL Open Font License 1.1**. The full licence text
ships next to them in `assets/render/fonts/LICENSE.txt` and is included in the
app bundle.

The plan names these faces for titles and captions, and the worker burns the same
two files with libass. Shipping them as assets is what keeps glyph metrics
identical on both sides.

## FFmpeg

`ffmpeg_kit_flutter_new_full` 2.5.8 is a maintained fork of the retired
FFmpegKit wrapper. It bundles prebuilt **FFmpeg 8.1.2** libraries (libavcodec,
libavformat, libavfilter, libavutil, libswscale, libswresample, libavdevice) plus
FFprobe for Android, iOS, macOS, Linux and Windows.

- Wrapper and native builds: **LGPL 3.0** (`~/.pub-cache/.../LICENSE`).
- The Full variant deliberately excludes the GPL codecs. There is **no
  `libx264`/`libx265` in the app**, which is why the plan's `h264` encoder is
  retargeted to the platform encoder (`h264_mediacodec`) at run time; see
  `lib/render/render.dart`.
- The plugin never opens a network connection, and neither does the render path:
  every input is a file the app wrote itself.

Replacing this package (or switching to a GPL-enabled variant) changes the
licence obligations of the whole app, so it is called out in the PR rather than
treated as an implementation detail.
