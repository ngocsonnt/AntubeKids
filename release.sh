#!/usr/bin/env bash
# Build the APK and publish it so installed apps can self-update from GitHub.
# Usage: ./release.sh "Release notes here"
#
# Steps it does:
#   1) reads versionCode/versionName from app/build.gradle
#   2) builds the debug APK
#   3) copies it to apk/AntubeKids-latest.apk  (stable URL the app downloads)
#   4) writes update.json with that versionCode/versionName + notes
#   5) commits and pushes to GitHub
#
# Remember to BUMP versionCode (and versionName) in app/build.gradle BEFORE running,
# otherwise installed apps won't see it as newer.
set -e
cd "$(dirname "$0")"

export JAVA_HOME="${JAVA_HOME:-/Applications/Android Studio.app/Contents/jbr/Contents/Home}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"

NOTES="${1:-Update}"
VCODE=$(grep -oE 'versionCode[[:space:]]+[0-9]+' app/build.gradle | grep -oE '[0-9]+')
VNAME=$(grep -oE 'versionName[[:space:]]+"[^"]+"' app/build.gradle | sed -E 's/.*"([^"]+)".*/\1/')
echo "Releasing versionCode=$VCODE versionName=$VNAME"

./gradlew --no-daemon assembleDebug
mkdir -p apk
cp app/build/outputs/apk/debug/app-debug.apk apk/AntubeKids-latest.apk

cat > update.json <<EOF
{
  "versionCode": $VCODE,
  "versionName": "$VNAME",
  "apkUrl": "https://github.com/ngocsonnt/AntubeKids/raw/main/apk/AntubeKids-latest.apk",
  "notes": "$NOTES"
}
EOF

git add -A
git commit -m "Release v$VNAME (versionCode $VCODE): $NOTES"
git push
echo "Done. Installed apps will detect v$VNAME on next launch / Settings check."
