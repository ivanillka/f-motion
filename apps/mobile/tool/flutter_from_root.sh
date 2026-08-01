#!/bin/sh
set -eu

flutter_bin=${FLUTTER_BIN:-flutter}
command=${1:-}

case "$command" in
  analyze)
    exec "$flutter_bin" analyze apps/mobile
    ;;
  test)
    shift
    cd apps/mobile
    exec "$flutter_bin" test "$@"
    ;;
  build-apk)
    cd apps/mobile
    exec "$flutter_bin" build apk --debug
    ;;
  *)
    echo "usage: FLUTTER_BIN=/absolute/path/flutter apps/mobile/tool/flutter_from_root.sh {analyze|test|build-apk}" >&2
    exit 64
    ;;
esac
