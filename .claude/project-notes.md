# Project Notes

## LLM prompt (accuracy)

- `config.yaml` `system_prompt` must keep accuracy rules: never invent user personal facts,
  never fake memory of past sessions, say "I don't know" instead of guessing, accept corrections,
  caveat medical/legal/financial advice. Temperature 0.6 default.

## Mina posture & idle

- Mina should keep a relaxed human posture: arms dropped naturally beside her torso with visible side clearance, soft elbows/wrists, subtle asymmetry, and small idle dynamics from breath, elbow lag, and wrist motion. Avoid stiff forward-reaching, inward-tucked, clipping, or zombie-like arm poses when changing `holohuman/web/src/mina.js` or `holohuman/web/src/behavior.js`.
- Mina's hands should remain outside the short dress/skirt silhouette. Wrist and forearm idle motion should be outward-only or neutral, never inward through the skirt.
- Mina's idle should have whole-body micro-motion: breath through chest, slight hip/spine counter-sway, tiny head/neck/arm/leg offsets, and no visible sliding or exaggerated puppet movement.
- Feet planted: `mina.js` sets `groundY` from foot/ankle bones; `behavior.js` keeps `scene.position.y = groundY` always — never bob the root (reads as floating). Bounce lives in spine/thighs only.

## Mina while talking

- Lips: fast `jawFast` track for responsive open/close; `funnel`/`stretch` for vowel shape;
  asymmetric `lipSideL/R`, `smileL/R`, `lipRollU/L` for supple corners (not a stiff hinge).
  Body still uses smoothed `talkEnv` — only the mouth gets the faster lipK envelope.
- Arms: soft elbow bend in rest pose (~0.22 rad); shoulder/elbow/wrist use **independent phased
  drivers** + `limbK` smoothing + idle `armDrift` — forearm must not stay collinear with upper arm.
  Hands outside skirt.
- All bones: use `bundle()` + chain propagation (spine→chest→neck→head). Never uncorrelated
  per-axis wobble on the same joint.
- Mina's hair should read as soft strands, not a dense helmet: preserve alpha masking/transparency and avoid overly dark, opaque, stiff-looking hair material settings.
- Mina's hair motion should follow spring-damper behavior: roots move least, tips lag more, motion damps quickly, and hair responds opposite to head/body motion instead of rotating as one rigid block.

## Mina dance

- Dance must blend in/out (~100ms) via `danceBlend` — never snap joints stiff.
- Motion is hip-led with staggered limb phases, sharper downbeat hits (`hit` envelope), alternating arms, thigh bounce, and live wrist offsets. Avoid symmetric pure-sine puppet pumping.
- Hands stay outside the skirt; use outward-only wrist motion.
- On stop, restore all dance bones: head, neck, chest, spine, arms, hands, thighs.

## Lip sync (audio-driven)

- TTS audio must play through `lipsync.js`: `BufferSource → gain → analyser → speakers`.
- `lipLevel` (fast) drives jaw/lips; `level` (slow) drives body emphasis. `playing` is true
  while scheduled TTS is audible — `behavior.js` uses `lip.playing` + `lipLevel` for talk state.
- Never animate the mouth without audio unless emotion blendshapes require it.

## TTS playback loop

- Target: **≤200ms gap** between back-to-back sentence clips.
- `pipeline.js` prefetches TTS (fetch + decode) as soon as a sentence is flushed from the LLM stream — while earlier clips are still playing.
- `lipsync.js` chains clips with `AudioContext` scheduling (`chainEnd`, `MAX_GAP_S = 0.2`). Natural micro-pause is ~20ms; hard cap is 200ms.
- Lip-sync level uses fast attack (0.82) / softer release (0.38) so the mouth tracks speech without lag.
- New user message clears the speech queue and calls `lipsync.stop()` to cancel stale playback.

## ASR (auto listen)

- Target: **≤200ms** from end-of-speech to recognised text hitting the LLM pipeline.
- `asr.js` `AutoAsr` auto-activates on first user gesture (browser mic policy), then stays always-on until the 🎤 button mutes it.
- **Primary path**: browser `SpeechRecognition` / `webkitSpeechRecognition` — continuous + interim results, auto-restarts, typically <200ms to final transcript.
- **Fallback path** (Firefox etc.): VAD over `AudioContext` — 80ms onset, 280ms silence end, WAV upload to `/api/asr`.
- ASR pauses while TTS plays (`pipeline.js` `drainSpeech`) to avoid echo; resumes when done.
- Server: faster-whisper with `beam_size=1`, `vad_filter=True`; models pre-warmed on startup.
- Mic button states: green `on` = listening, red `rec` = hearing speech.