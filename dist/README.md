# `dist/` — prebuilt handset app

`zeroui.apk` is the release build of the Flutter app in [../mobile-app](../mobile-app), committed
so the console's **Download APK** button works on a machine that has never run the Android
toolchain.

- **Package** `com.zeroui.app`, minSdk 24, targetSdk 36
- **Size** 52,617,688 bytes (50.2 MB)
- **SHA-256** `12789a0017bb15e1ca07fecf27460b6a098d759cbb8f569a5fd8b4b30e5cf83d`
  (also in [zeroui.apk.sha256](zeroui.apk.sha256))

## Where it is served

`GET /download/zeroui.apk` on the backend serves this file. The route is unauthenticated on
purpose — the phone installing the app has no dashboard session yet, and the APK is public build
output rather than data.

Resolution order:

1. `ZEROUI_APK_PATH` (default `mobile-app/build/app/outputs/flutter-apk/app-release.apk`) — a fresh
   local build always wins.
2. `ZEROUI_APK_FALLBACK_PATH` (default `dist/zeroui.apk`) — this committed copy.
3. Neither present: `404` listing both paths and the exact build command, never a stale or partial
   file.

## The build is baked with a server address

The APK was compiled with:

```bash
cd mobile-app
flutter build apk --release --dart-define=ZEROUI_API_BASE=http://192.168.1.2:8000
```

`ZEROUI_API_BASE` is compiled in, so this binary talks to `192.168.1.2:8000`. On a different network
the phone must be pointed at the right host — either rebuild with the correct `--dart-define`, or
change the server address in the app's onboarding/settings screen, which persists it on the device.

## Installing

1. Start the backend (`npm run dev` from the repo root).
2. On the phone, open `http://<your-LAN-IP>:8000` and tap **Download APK**, or scan/enter
   `http://<your-LAN-IP>:8000/download/zeroui.apk`.
3. Android will ask to allow installing unknown apps for your browser; accept, then install.
4. Grant notification, location and microphone permissions when prompted — the foreground service
   needs them for the fall detector, GPS trail and audio segments.

## Rebuilding this file

```bash
cd mobile-app
flutter build apk --release --dart-define=ZEROUI_API_BASE=http://<your-LAN-IP>:8000
cp build/app/outputs/flutter-apk/app-release.apk ../dist/zeroui.apk
sha256sum ../dist/zeroui.apk > ../dist/zeroui.apk.sha256
```

`mobile-app/build/` is gitignored (~930 MB); this copy is the only APK in version control. A 50 MB
binary in Git is deliberate here — it is a deliverable, not build residue.
