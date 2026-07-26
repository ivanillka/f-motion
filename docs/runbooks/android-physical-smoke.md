# Android physical-device smoke

Tested target: Samsung SM-F721B or another API-compatible physical Android
device. Enable developer mode and USB debugging, then:

1. Confirm exactly the intended device with `adb devices -l`.
2. Install the debug APK with `adb install -r apps/mobile/build/app/outputs/flutter-apk/app-debug.apk`.
3. Complete magic-link/Google entry, brief, three-concept selection, media
   attachment, storyboard edit, approximate preview, accurate render, reconnect,
   and download.
4. Force-stop/restart after a draft edit and confirm the draft returns.
5. Disconnect networking during upload/render, confirm explicit reconnect
   status, restore networking, and resume.
6. Trigger a stale revision from the web client and verify Android offers reload
   latest or save as new project without merging.
7. Confirm TalkBack labels, 48dp touch targets, safe areas, and reduced motion.

Record device model, Android version, APK hash, API commit, and pass/fail notes.
