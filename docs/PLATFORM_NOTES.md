# Per-Platform Notes & Checklists

## Windows (StandaloneWindows64)
- Default mode: **TransparentDesktopOverlay** (original behaviour).
- The overlay requires the main camera to clear with alpha 0 and the
  `TransparentWindowRendererFeature` from the original project to keep the URP
  output alpha intact — keep that RendererFeature in the URP renderer asset.
- If you previously used the `TRANSPARENT_WINDOW` scripting define, it is no
  longer needed; the new class compiles the Win32 code automatically for
  Windows player builds only.

## macOS / Linux (StandaloneOSX / StandaloneLinux64)
- Default mode: Standard. Pyramid and SingleReflection work out of the box.
- True transparent overlays would need NSWindow (mac) / X11-compositor (Linux)
  native plugins — out of scope; the IHolographicDisplay interface is where a
  future `MacTransparentOverlayDisplay` would slot in.
- Scripting backend: Mono or IL2CPP both fine. macOS notarization required for
  distribution outside the App Store.

## Android
- Min SDK 24; IL2CPP + ARM64 for Play Store.
- Microphone: `RECORD_AUDIO` is auto-added; the recognizer also requests it at
  runtime (Android 6+ requirement).
- Cleartext `ws://` is blocked on Android 9+. Either use `wss://` (recommended)
  or add a `network_security_config` allowing your dev host only.
- Pyramid mode: force landscape or lock rotation for a stable layout;
  set `Screen.sleepTimeout = SleepTimeout.NeverSleep` for kiosk use.

## iOS
- Xcode project output; set Team/signing in Xcode.
- `NSMicrophoneUsageDescription` is set by the build script — edit the wording.
- App Transport Security blocks non-TLS: `wss://` and `https://` only
  (LLM/TTS endpoints included).
- IL2CPP stripping: if JSON types get stripped, add a `link.xml` preserving
  `Newtonsoft.Json`.

## WebGL
- No threads for `System.Net.WebSockets`, no `Microphone` — both replaced by
  `HoloVoice.jslib` (native browser WebSocket + getUserMedia).
- Page must be served over **https** for mic access, hence ASR must be **wss**.
- Mic capture only starts after a user gesture (button click) — wire
  `PlatformBootstrap.StartListening()` to a UI button, never to `Start()`.
- Build settings applied by the builder: Brotli compression + decompression
  fallback. Consider `WebGLMemorySize`/geometry compression if the character
  textures push memory; the KPOP_Mina asset is heavy — create an addressable
  or reduced-texture variant for web.
- LLM/TTS servers must send CORS headers (`Access-Control-Allow-Origin`) since
  requests originate from the browser.
- Audio playback (TTS) also requires a prior user gesture to unlock
  `AudioContext` — the same "start" button covers it.

## Streaming ASR server
- The original build points at a hardcoded `ws://` IP. For production:
  1. Host your own streaming ASR (e.g. sherpa-onnx / FunASR / Vosk server)
     behind an nginx TLS terminator → `wss://asr.yourdomain.com/recognition`.
  2. Protocol used by the provided recognizers: client streams 16 kHz mono
     PCM16 binary frames (~80 ms); server replies with UTF-8 text frames.
     Adapt `PumpAudio`/`onaudioprocess` if your server expects JSON envelopes.

## CI example (GitHub Actions + game-ci)
```yaml
strategy:
  matrix:
    targetPlatform: [StandaloneWindows64, StandaloneLinux64, Android, WebGL]
steps:
  - uses: actions/checkout@v4
  - uses: game-ci/unity-builder@v4
    with:
      unityVersion: 2022.3.31f1
      targetPlatform: ${{ matrix.targetPlatform }}
      buildMethod: LKZ.CrossPlatform.EditorTools.MultiPlatformBuilder.BuildAll
```
