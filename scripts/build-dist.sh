#!/usr/bin/env bash
# 配布用 zip を dist/ に作る。使い方: scripts/build-dist.sh [バージョン]
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION="${1:-1.0}"
NAME="OnScreenPrinter"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

mkdir -p "$STAGE/$NAME"
cp -R index.html manual.html css js "$STAGE/$NAME/"
mkdir -p "$STAGE/$NAME/manual"
cp -R manual/img "$STAGE/$NAME/manual/"
sed "s/{{VERSION}}/$VERSION/g" scripts/dist-readme.txt > "$STAGE/$NAME/はじめにお読みください.txt"
sed -i.bak "s/OnScreenPrinter v[0-9.]*</OnScreenPrinter v$VERSION</" "$STAGE/$NAME/manual.html" && rm "$STAGE/$NAME/manual.html.bak"

mkdir -p dist
OUT="dist/${NAME}-v${VERSION}.zip"
rm -f "$OUT"
(cd "$STAGE" && zip -qr -X "$OLDPWD/$OUT" "$NAME")
echo "$OUT"
