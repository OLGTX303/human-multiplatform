# Multi-Platform Deployment Solution for 3D Holographic Digital Human

This package extends the original Unity 2022.3.31 URP digital-human project so the same codebase deploys to **Windows, macOS, Linux, Android, iOS, and WebGL**, each with an appropriate "holographic" presentation mode.

## 1. Why the original project is Windows-only

The audit of the repo found exactly three platform blockers — everything else (URP rendering, uLipSync, LLM over HTTP, TTS over HTTP) is already cross-platform.

| # | Blocker | File | Problem |
|---|---------|------|---------|
| 1 | Transparent desktop overlay | `Assets/TransparentWindow/TransparentWindow.cs` | P/Invoke into `user32.dll` / `Dwmapi.dll` — Windows only |
| 2 | Streaming speech recognition | `Assets/Scripts/Models/VoiceRecognizerModel.cs` | `System.Net.WebSockets` is unavailable on WebGL; recognizer class is hardcoded (`new VoiceRecognizerNoWebGL()`); ASR endpoint hardcoded to `ws://1.94.131.28:19463` (cleartext — blocked by iOS ATS, Android 9+, and https pages) |
| 3 | Microphone capture | same | `UnityEngine.Microphone` does not exist on WebGL; mobile needs runtime permissions |

Minor: `Clipboard.cs` also branches on platform, and the single scene is named `Windows.unity`.

## 2. Architecture of the solution

Strategy pattern + dependency injection (consistent with the project's existing `LKZ.DependencyInject` container): platform-specific code lives behind two interfaces, selected once at startup.

```
PlatformBootstrap (MonoBehaviour, in scene)
 ├── IHolographicDisplay          ← how the hologram is shown
 │    ├── WindowsTransparentOverlayDisplay   (Win32, #if UNITY_STANDALONE_WIN)
 │    ├── PepperGhostPyramidDisplay          (4-view, ALL platforms)
 │    │     └── SingleViewMode               (45° glass / holo fan)
 │    └── StandardDisplay                    (plain fullscreen)
 └── IVoiceRecognizer             ← streaming ASR
      ├── NativeStreamingRecognizer          (Win/mac/Linux/Android/iOS:
      │                                       Microphone + ClientWebSocket)
      └── WebGLStreamingRecognizer           (browser: HoloVoice.jslib →
                                              getUserMedia + native WebSocket)
```

Per-platform defaults chosen by `PlatformBootstrap.DefaultModeForPlatform()`:

| Platform | Default holographic mode | Rationale |
|----------|-------------------------|-----------|
| Windows | Transparent desktop overlay | Original "desktop mate" experience preserved |
| Android / iOS | Pepper's Ghost 4-view pyramid | Phone lies flat under a cheap acrylic pyramid → floating 3D character; pure camera work, no native code |
| WebGL | Standard (pyramid selectable) | Embeds in any web page; user can toggle pyramid mode for a tablet+pyramid kiosk |
| macOS / Linux | Standard | No DWM equivalent wrapped yet; pyramid/single-reflection available for kiosk hardware |
| Holographic fan / 45° glass showcase (any OS) | SingleReflection | One vertically-mirrored view |

## 3. Files in this package

```
Assets/CrossPlatform/
  Display/IHolographicDisplay.cs             interface + mode enum
  Display/WindowsTransparentOverlayDisplay.cs original Win32 overlay, safely guarded
  Display/PepperGhostPyramidDisplay.cs       4-view + single-reflection hologram rig
  Voice/IVoiceRecognizer.cs                  ASR interface
  Voice/NativeStreamingRecognizer.cs         desktop + mobile implementation
  Voice/WebGLStreamingRecognizer.cs          browser implementation
  Plugins/WebGL/HoloVoice.jslib              browser mic + WebSocket bridge
  Bootstrap/PlatformBootstrap.cs             wiring, runtime mode switching
Assets/Editor/
  MultiPlatformBuilder.cs                    menu + CI builds for all targets
docs/
  INTEGRATION.md                             step-by-step integration into the repo
  PLATFORM_NOTES.md                          per-platform checklists & gotchas
```

> **Status: integrated.** The full Unity project (character assets, scripts, shaders, scene) now lives at the repo root (`Assets/`, `Packages/`, `ProjectSettings/`). `Assets/Scenes/Main.unity` is the cross-platform scene wired to `PlatformBootstrap`; `Assets/Scenes/Windows.unity` is the untouched original. Steps below are kept for reference.

## 4. Integration in five steps

1. **Copy** `Assets/CrossPlatform` and `Assets/Editor/MultiPlatformBuilder.cs` into the project.
2. **Replace** the `TransparentWindow` component in `Windows.unity` with `PlatformBootstrap`; assign `MainCamera` and the character root (the KPOP_Mina prefab instance).
3. **Modify `VoiceRecognizerModel.cs`**: delete `voiceRecognizer = new VoiceRecognizerNoWebGL();` and instead inject/subscribe to `PlatformBootstrap.OnSpeechRecognized`, forwarding text into the existing `VoiceRecognitionResultCommand`. The rest of the pipeline (LLM → TTS → uLipSync) is untouched — it is already platform-neutral HTTP + audio.
4. **Move the ASR URL to config**: put it next to `Resources/LLMConfig` instead of the hardcoded IP, and deploy the ASR server behind TLS (`wss://`). This is mandatory for WebGL-on-https, iOS, and Android 9+.
5. **Duplicate the scene** as `Main.unity` (drop the `Windows` name), add it to Build Settings, and build via `Tools > Holo Human > Build ...` or CI:
   `Unity -batchmode -quit -projectPath . -executeMethod LKZ.CrossPlatform.EditorTools.MultiPlatformBuilder.BuildAll`

## 5. The Pepper's Ghost pyramid mode (the truly portable hologram)

`PepperGhostPyramidDisplay` renders the character from front/back/left/right with four cameras into a plus-shaped viewport layout on a black background. Placing a transparent 4-sided pyramid on the screen reflects each view on one face, so viewers see a floating character from any side. Because it is only cameras and viewport rects, it runs identically on every Unity platform including WebGL — this is the recommended universal "holographic" deployment:

- Phone/tablet + ~$5 acrylic pyramid → portable hologram
- Large monitor laid flat + big pyramid → exhibition kiosk
- `SingleViewMode` → 45° glass showcases and holographic fan content capture

Tune `CameraDistance`, `LookAtHeight`, and `ViewSize` in code or expose them in your settings UI; `SwitchDisplay()` lets users change modes at runtime.

## 6. What stays exactly the same

- URP rendering, shaders, character assets — URP already targets all these platforms
- uLipSync — explicitly multi-platform
- LLM integration (`LLM.cs`, `LLMConfig`) — plain `UnityWebRequest`/HTTP, works everywhere
- TTS submission — HTTP, works everywhere (just use https endpoints)
- Fay framework integration — unchanged; note that on WebGL/mobile, `127.0.0.1:5000` must be replaced with a reachable host

See `docs/PLATFORM_NOTES.md` for the per-platform build checklists (permissions, ATS, WebGL memory/compression, IL2CPP stripping).
