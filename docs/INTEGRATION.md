# Integration Guide — wiring the package into LKZMuZiLi/human

## Step 1 — Copy files
Copy `Assets/CrossPlatform/` and `Assets/Editor/MultiPlatformBuilder.cs` into
the project root's `Assets/` folder. Unity will compile them immediately; there
are no new package dependencies.

## Step 2 — Scene setup (replaces TransparentWindow)
1. Open `Assets/Scenes/Windows.unity`, save a copy as `Assets/Scenes/Main.unity`.
2. Find the GameObject carrying the old `TransparentWindow` component and
   remove that component (keep the `TransparentWindowRendererFeature` on the
   URP renderer asset — Windows overlay still needs it).
3. Add `PlatformBootstrap` to a root GameObject:
   - `MainCamera` → the scene camera
   - `CharacterRoot` → the KPOP_Mina character instance
   - `AsrUrl` → your `wss://` endpoint
4. Add `Main.unity` to Build Settings and enable it for all targets.

## Step 3 — Route recognition results into the existing command system
In `Assets/Scripts/Models/VoiceRecognizerModel.cs`, replace the hardcoded
recognizer with the bootstrap event. Minimal diff:

```csharp
// OLD
// voiceRecognizer = new VoiceRecognizerNoWebGL();
// voiceRecognizer.Initialized(this._mono, url, this.DisponseRecognition);

// NEW
var bootstrap = UnityEngine.Object.FindObjectOfType<LKZ.CrossPlatform.PlatformBootstrap>();
bootstrap.OnSpeechRecognized += this.DisponseRecognition;
```

And route the start/stop command to it:

```csharp
private void SettingVoiceRecognitionCommandCallback(SettingVoiceRecognitionCommand obj)
{
    var bootstrap = UnityEngine.Object.FindObjectOfType<LKZ.CrossPlatform.PlatformBootstrap>();
    if (obj.IsStartVoiceRecognition) bootstrap.StartListening();
    else bootstrap.StopListening();
}
```

(If you prefer, register `PlatformBootstrap` in the existing `LKZ.DependencyInject`
container instead of `FindObjectOfType` — bind it as a singleton in `GameApp`.)

## Step 4 — Config instead of hardcoded endpoint
Remove `const string url = "ws://1.94.131.28:19463/recognition";` and read the
URL from a `Resources/VoiceConfig` asset mirroring the existing `LLMConfig`
pattern, or simply set it in the `PlatformBootstrap` Inspector per build.

## Step 5 — UI hook for WebGL/mobile
Browsers and phones require a user gesture before mic capture. The project
already has voice UI under `Assets/Scripts/UI/Voice` — make its press-to-talk
button call `StartListening()` / `StopListening()`. Do not auto-start listening
in `Awake/Start` on WebGL.

## Step 6 — Build
Editor menu `Tools > Holo Human > Build ...`, or batch mode:

```
Unity -batchmode -quit -projectPath . ^
  -executeMethod LKZ.CrossPlatform.EditorTools.MultiPlatformBuilder.BuildAll
```

## Verification checklist
- [ ] Windows build: character floats on desktop, click-through as before
- [ ] Android build on phone + pyramid: 4 views in plus layout, mic prompt appears
- [ ] WebGL over https: press-to-talk works, wss connects, TTS plays after first click
- [ ] Runtime mode switch: `bootstrap.SwitchDisplay(HoloDisplayMode.PepperGhostPyramid)`
- [ ] LLM/TTS endpoints reachable from mobile/browser (no 127.0.0.1, CORS enabled)
