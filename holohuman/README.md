# HoloHuman — 3D holographic digital human, no Unity

Web-native rebuild of the [LKZMuZiLi/human](https://github.com/LKZMuZiLi/human) pipeline:
**mic → ASR → LLM → TTS → lip-synced 3D avatar**, with the same holographic display
modes as the Unity multi-platform package, but running in any browser.

- **Avatar**: the original **KPOP_Mina** character (FBX + textures from the repo,
  in `models/mina/`) with her ARKit-52 blendshape face rig driving lip sync and
  blinking. Any `.vrm` (VRoid Studio etc.) can be dropped onto the page instead.
- **LLM**: any OpenAI-compatible endpoint — local (Ollama / LM Studio / llama.cpp)
  or cloud (OpenAI, DeepSeek, Zhipu, Kimi, …). One line in `config.yaml`.
- **TTS**: local **kokoro-onnx** (default, no internet after model download) /
  edge-tts (free cloud) / any OpenAI-compatible `/audio/speech`
- **ASR**: local **faster-whisper** (default) / any OpenAI-compatible `/audio/transcriptions`
- **Lip sync**: WebAudio analysis of the TTS stream drives VRM mouth blendshapes
- Streaming end-to-end: sentences are synthesized and spoken while the LLM is still generating

## Run

```powershell
cd holohuman
pip install -r requirements.txt
cd web; npm install; npm run build; cd ..
python -m uvicorn server.main:app --host 0.0.0.0 --port 8710
```

Open http://localhost:8710. First TTS/ASR use auto-downloads the local models
(kokoro ~340 MB, whisper-small ~460 MB) into `server/models/`.

For a **local LLM**, install [Ollama](https://ollama.com) and `ollama pull qwen2.5:7b` —
`config.yaml` already points at it. To use a cloud API instead, change
`llm.base_url` / `api_key` / `model`.

### Development (hot reload)

```powershell
python -m uvicorn server.main:app --port 8710 --reload   # terminal 1
cd web; npm run dev                                       # terminal 2 → http://localhost:5173
```

## Your character

KPOP_Mina loads by default from `models/mina/`. To use a different character,
put a `.vrm` at `models/avatar.vrm` (loaded if Mina's files are missing) or
drag-and-drop a `.vrm` onto the page.

## Holographic modes (same as the Unity package)

| Mode | Use |
|---|---|
| Standard | plain view, web page / kiosk |
| Pyramid 4-view | tablet/monitor laid flat under an acrylic pyramid — Pepper's Ghost floating character |
| Single reflection | 45° glass showcase / holographic fan (vertically mirrored) |

## Remote / phone access

Mic capture requires a secure context: `http://localhost` works as-is; from another
device serve over HTTPS (e.g. `caddy reverse-proxy --from https://host --to localhost:8710`).

## Notes

- `tts.engine: edge` needs internet and Microsoft occasionally blocks the free
  endpoint (`NoAudioReceived`) — kokoro (local) is the reliable default.
- Whisper runs CPU int8 by default; set `asr.local.device: cuda` for GPU (needs CUDA 12 runtime).
- Everything defaults to **English** (kokoro `af_heart`, whisper `language: en`).
  For Chinese: switch the kokoro `model_url`/`voices_url` to the `model-files-v1.1`
  zh files, `voice: zf_001`, `lang: cmn`, and `asr.local.language: zh`.
- Mic is **hold-to-talk**: press and hold 🎤 while speaking, release to send.
  The browser will ask for microphone permission on first use.
