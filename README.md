# Antube Kids

A simple, kid-friendly Android app for **smart projectors / Android TV** that plays a
curated list of YouTube videos. The playlist lives in a public **Google Sheet** — no
sign-in required. Edit the sheet from your phone, press 🔄 on the projector, done.

Built as a lightweight **WebView kiosk**: the whole UI lives in `app/src/main/assets/`
(HTML/CSS/JS); the native shell only provides a full-screen WebView and a tiny bridge
that fetches the sheet (done natively to avoid WebView CORS).

## Features

- 🎬 Big-thumbnail grid, controllable by **touch and remote (D-pad)**
- 📄 Video list from a **public Google Sheet** (column A = title, column B = YouTube link)
- 🗂️ If the spreadsheet has multiple tabs, they appear as **playlists** on the right
- ⏱️ Thumbnails show the **clip duration**, captured from the player on first play and cached
  (no API key, no page scraping — earlier watch-page scraping got rate-limited with HTTP 429)
- 💬 Optional **captions (CC)** toggle — shows YouTube subtitles (incl. auto-generated) when available
- ▶️ Uses YouTube's native player controls (timeline/scrubber); remote keys also drive
  the player (OK = play/pause, ◀▶ = seek 10s, ▲▼ = previous/next video)
- 🔁 Auto-advances to the next video; videos that block embedding are skipped
- 📐 Reads the projector's **real resolution** and sizes the player to fill the screen
- 🔒 Bundles Google Trust Services root CAs (helps older projectors with stale CA stores)
- ⚙️ In-app settings to change the sheet link, with the app version shown
- 📱 **Enter the link from your phone over Wi-Fi**: the projector runs a tiny on-demand
  web server and shows an address (e.g. `http://192.168.1.5:8080`); open it on a phone on
  the same Wi-Fi, paste the link, tap Send — no typing on the remote
- ⬆️ **Self-update from GitHub**: checks `update.json` on launch, shows a banner, and
  downloads + installs the new APK (one confirmation tap — Android requires it for sideloaded apps)

## Google Sheet format

Share the sheet as **"Anyone with the link → Viewer"**. One video per row:

| A (Title)            | B (Link)                                    |
|----------------------|---------------------------------------------|
| Alphabet Song        | https://www.youtube.com/watch?v=75p-N9YKqNo |
| Count 1–10           | https://youtu.be/DR-cfDsHCGA                |

A header row is detected and skipped automatically.

## Build

Requires Android Studio (bundled JDK + SDK). From the project root:

```bash
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
export ANDROID_HOME="$HOME/Library/Android/sdk"
./gradlew assembleDebug
```

Output: `app/build/outputs/apk/debug/app-debug.apk`. A prebuilt debug APK is in [`apk/`](apk/).

Install on the projector via `adb install -r app-debug.apk` or by copying the APK and
opening it with the device's file manager (enable "install from unknown sources").

## Releasing an update (so installed apps auto-update)

1. Bump `versionCode` (and `versionName`) in `app/build.gradle`.
2. Run `./release.sh "what changed"` — it builds the APK, copies it to
   `apk/AntubeKids-latest.apk`, writes `update.json`, then commits & pushes.
3. Installed apps detect the new `versionCode` on next launch and offer to update.

> The downloaded APK must be signed with the **same key** as the installed app, or Android
> rejects the update ("App not installed"). Debug builds from the same machine share the
> debug keystore. For wider distribution, switch to a dedicated release keystore.

## Tech notes

- minSdk 26 (Android 8.0), targetSdk 35, no third-party dependencies
- UI served over a virtual `https://appassets.androidplatform.net` origin so the
  YouTube IFrame Player accepts it (a `file://` origin causes player error 153)
- See `HUONG_DAN.md` for a user guide in Vietnamese
- See `HUONG_DAN_TAO_LAI.md` for a full step-by-step **recreation guide** (architecture,
  the no-auth Google Sheet approach, and every real-world bug + fix encountered)
