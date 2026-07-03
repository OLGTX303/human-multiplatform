"""HoloHuman backend: LLM proxy (SSE) + TTS + ASR + static frontend.

Run:  uvicorn server.main:app --host 0.0.0.0 --port 8080
Everything is configured in config.yaml — each of LLM/TTS/ASR can run
fully local or against any OpenAI-compatible API.
"""
import asyncio
import io
import json
import os
import re
import struct
import urllib.request
from pathlib import Path

import yaml
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.responses import Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from openai import AsyncOpenAI

ROOT = Path(__file__).resolve().parent.parent
LOCAL_CACHE = ROOT / ".cache"
os.environ.setdefault("HF_HOME", str(LOCAL_CACHE / "huggingface"))
os.environ.setdefault("XDG_CACHE_HOME", str(LOCAL_CACHE / "xdg"))
os.environ.setdefault("PIP_CACHE_DIR", str(LOCAL_CACHE / "pip"))


def _load_env(path: Path):
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def _expand_env(value):
    if isinstance(value, dict):
        return {k: _expand_env(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_expand_env(v) for v in value]
    if isinstance(value, str):
        return re.sub(r"\$\{([A-Z0-9_]+)\}", lambda m: os.environ.get(m.group(1), ""), value)
    return value


_load_env(ROOT / ".env")
CFG = _expand_env(yaml.safe_load((ROOT / "config.yaml").read_text(encoding="utf-8")))
MODELS_DIR = ROOT / "server" / "models"
MODELS_DIR.mkdir(exist_ok=True)

app = FastAPI(title="HoloHuman")


@app.on_event("startup")
async def _warmup_models():
    # preload sync models so first ASR/TTS request isn't a cold-start penalty
    if CFG["asr"]["engine"] == "local":
        asyncio.create_task(asyncio.to_thread(_get_whisper))
    if CFG["tts"]["engine"] == "kokoro":
        asyncio.create_task(asyncio.to_thread(_get_kokoro))


# ---------------------------------------------------------------- LLM
@app.post("/api/chat")
async def chat(body: dict):
    cfg = CFG["llm"]
    client = AsyncOpenAI(base_url=cfg["base_url"], api_key=cfg["api_key"])
    messages = [{"role": "system", "content": cfg["system_prompt"]}] + body["messages"]

    async def gen():
        try:
            stream = await client.chat.completions.create(
                model=cfg["model"], messages=messages, stream=True,
                temperature=float(cfg.get("temperature", 0.7)))
            async for chunk in stream:
                delta = chunk.choices[0].delta.content if chunk.choices else None
                if delta:
                    yield f"data: {json.dumps({'delta': delta})}\n\n"
        except Exception as e:  # surface LLM errors to the UI instead of dying silently
            yield f"data: {json.dumps({'error': str(e)})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream")


# ---------------------------------------------------------------- TTS
_kokoro = None


def _download(url: str, dest: Path):
    if dest.exists():
        return dest
    print(f"downloading {url} -> {dest} ...")
    tmp = dest.with_suffix(".part")
    urllib.request.urlretrieve(url, tmp)
    tmp.rename(dest)
    return dest


def _get_kokoro():
    global _kokoro
    if _kokoro is None:
        from kokoro_onnx import Kokoro
        k = CFG["tts"]["kokoro"]
        model = _download(k["model_url"], MODELS_DIR / Path(k["model_url"]).name)
        voices = _download(k["voices_url"], MODELS_DIR / Path(k["voices_url"]).name)
        _kokoro = Kokoro(str(model), str(voices))
    return _kokoro


def _wav_bytes(samples, sr: int) -> bytes:
    import numpy as np
    pcm = (np.clip(samples, -1, 1) * 32767).astype("<i2").tobytes()
    hdr = struct.pack("<4sI4s4sIHHIIHH4sI", b"RIFF", 36 + len(pcm), b"WAVE",
                      b"fmt ", 16, 1, 1, sr, sr * 2, 2, 16, b"data", len(pcm))
    return hdr + pcm


def _tts_sanitize(text: str) -> str:
    # phonemizer dies on newlines / emoji / stray symbols ("input=1, output=2");
    # TTS only needs speakable characters anyway
    text = re.sub(r"[\r\n]+", " ", text)
    text = re.sub(r"[^\w\s.,!?;:'\"()\-%$€£¥°]", " ", text, flags=re.UNICODE)
    return re.sub(r"\s{2,}", " ", text).strip()


async def _tts_edge(text: str) -> Response:
    import edge_tts
    buf = io.BytesIO()
    async for chunk in edge_tts.Communicate(text, CFG["tts"]["edge"]["voice"]).stream():
        if chunk["type"] == "audio":
            buf.write(chunk["data"])
    return Response(buf.getvalue(), media_type="audio/mpeg")


@app.post("/api/tts")
async def tts(body: dict):
    text = _tts_sanitize(body.get("text", ""))
    if not text:
        raise HTTPException(400, "empty text")
    engine = body.get("engine") or CFG["tts"]["engine"]

    if engine == "kokoro":
        k = CFG["tts"]["kokoro"]
        try:
            # to_thread: onnx inference is sync CPU work — must not block the event loop
            samples, sr = await asyncio.to_thread(
                _get_kokoro().create, text,
                voice=body.get("voice") or k["voice"], speed=k["speed"], lang=k["lang"])
            return Response(_wav_bytes(samples, sr), media_type="audio/wav")
        except Exception as e:
            # never leave her mute: fall back to edge for this sentence
            print(f"kokoro failed ({e!r}), falling back to edge")
            engine = "edge"

    if engine == "edge":
        return await _tts_edge(text)

    if engine == "openai":
        o = CFG["tts"]["openai"]
        client = AsyncOpenAI(base_url=o["base_url"], api_key=o["api_key"])
        resp = await client.audio.speech.create(
            model=o["model"], voice=o["voice"], input=text)
        return Response(resp.content, media_type="audio/mpeg")

    raise HTTPException(400, f"unknown tts engine {engine}")


# ---------------------------------------------------------------- ASR
_whisper = None


def _get_whisper():
    global _whisper
    if _whisper is None:
        from faster_whisper import WhisperModel
        # ponytail: CPU int8 always works; set device: cuda in config if you
        # have the CUDA 12 runtime installed
        _whisper = WhisperModel(CFG["asr"]["local"]["model"],
                                device=CFG["asr"]["local"].get("device", "cpu"),
                                compute_type="int8")
    return _whisper


@app.post("/api/asr")
async def asr(audio: UploadFile = File(...)):
    data = await audio.read()
    if CFG["asr"]["engine"] == "openai":
        o = CFG["asr"]["openai"]
        client = AsyncOpenAI(base_url=o["base_url"], api_key=o["api_key"])
        resp = await client.audio.transcriptions.create(
            model=o["model"], file=(audio.filename or "audio.webm", data))
        return {"text": resp.text}

    def run():
        kw = dict(
            language=CFG["asr"]["local"]["language"],
            beam_size=1,
            vad_filter=True,
            condition_on_previous_text=False,
        )
        segments, _info = _get_whisper().transcribe(io.BytesIO(data), **kw)
        return "".join(s.text for s in segments).strip()
    return {"text": await asyncio.to_thread(run)}


@app.get("/api/config")
async def config():
    return {"llm_model": CFG["llm"]["model"], "tts_engine": CFG["tts"]["engine"],
            "asr_engine": CFG["asr"]["engine"],
            "asr_lang": CFG["asr"]["local"].get("language", "en")}


# ---------------------------------------------------------------- static
# drop your .vrm files into holohuman/models/ (default: avatar.vrm)
(ROOT / "models").mkdir(exist_ok=True)
app.mount("/models", StaticFiles(directory=ROOT / "models"), name="models")
dist = ROOT / "web" / "dist"
if dist.exists():
    app.mount("/", StaticFiles(directory=dist, html=True), name="web")
