// Auto speech recognition: always-on listening with VAD or Web Speech API.
// Target ≤200ms from end-of-speech to text callback (webkit path is fastest).

const SR = typeof window !== 'undefined'
  ? (window.SpeechRecognition || window.webkitSpeechRecognition)
  : null

function encodeWav(samples, sampleRate) {
  const n = samples.length
  const buf = new ArrayBuffer(44 + n * 2)
  const v = new DataView(buf)
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)) }
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE')
  w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true)
  v.setUint16(32, 2, true); v.setUint16(34, 16, true)
  w(36, 'data'); v.setUint32(40, n * 2, true)
  let off = 44
  for (let i = 0; i < n; i++, off += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return new Blob([buf], { type: 'audio/wav' })
}

export class AutoAsr {
  static ONSET_S = 0.08   // 80ms voiced audio before capture starts
  static END_S = 0.28     // 280ms silence → utterance complete (~200ms feel after last word)
  static MIN_SAMPLES = 3200 // 200ms @ 16kHz

  constructor({ onText, onPartial, onStatus, lang = 'en-US' } = {}) {
    this.onText = onText || (() => {})
    this.onPartial = onPartial || (() => {})
    this.onStatus = onStatus || (() => {})
    this.lang = lang
    this.wantsListen = false
    this.paused = false
    this.mode = null
    this._webkit = null
    this._vad = null
  }

  get listening() { return this.wantsListen && !this.paused }

  async start() {
    this.wantsListen = true
    if (!this.paused) await this._boot()
    this.onStatus(this.listening ? 'listening' : 'paused')
    return this.listening
  }

  stop() {
    this.wantsListen = false
    this.paused = false
    this._teardown()
    this.onStatus('off')
    return false
  }

  toggle() {
    return this.wantsListen ? this.stop() : this.start()
  }

  pause() {
    if (!this.wantsListen || this.paused) return
    this.paused = true
    this._teardown()
    this.onStatus('paused')
  }

  resume() {
    if (!this.wantsListen || !this.paused) return
    this.paused = false
    this._boot().catch(e => this.onStatus('error: ' + e.message))
    this.onStatus('listening')
  }

  async _boot() {
    this._teardown()
    if (SR) {
      this.mode = 'webkit'
      this._startWebkit()
      return
    }
    this.mode = 'vad'
    await this._startVad()
  }

  _teardown() {
    if (this._webkit) {
      try { this._webkit.onend = null; this._webkit.stop() } catch {}
      this._webkit = null
    }
    if (this._vad) {
      const v = this._vad
      if (v.proc) { v.proc.onaudioprocess = null; v.proc.disconnect() }
      v.stream?.getTracks().forEach(t => t.stop())
      v.ctx?.close()
      this._vad = null
    }
  }

  _startWebkit() {
    const rec = new SR()
    rec.continuous = true
    rec.interimResults = true
    rec.lang = this.lang
    rec.maxAlternatives = 1

    rec.onresult = (e) => {
      let interim = '', final = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript
        if (e.results[i].isFinal) final += t
        else interim += t
      }
      if (interim.trim()) {
        this.onStatus('hearing')
        this.onPartial(interim.trim())
      }
      const text = final.trim()
      if (text) {
        this.onPartial('')
        this.onText(text)
        this.onStatus('listening')
      }
    }

    rec.onerror = (e) => {
      if (e.error === 'not-allowed') this.onStatus('mic denied')
      else if (e.error !== 'no-speech' && e.error !== 'aborted') this.onStatus(e.error)
    }

    rec.onend = () => {
      if (this.wantsListen && !this.paused && this._webkit === rec) {
        try { rec.start() } catch {}
      }
    }

    rec.start()
    this._webkit = rec
    this.onStatus('listening')
  }

  async _startVad() {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    })
    const ctx = new AudioContext()
    const rate = ctx.sampleRate
    const src = ctx.createMediaStreamSource(stream)
    const proc = ctx.createScriptProcessor(1024, 1, 1)
    src.connect(proc)
    proc.connect(ctx.destination)

    const state = {
      ctx, stream, proc, samples: [], speaking: false,
      speechT: 0, silenceT: 0, busy: false,
    }
    this._vad = state

    proc.onaudioprocess = (e) => {
      if (!this.wantsListen || this.paused || state.busy) return
      const ch = e.inputBuffer.getChannelData(0)
      const dt = ch.length / rate
      let sum = 0
      for (let i = 0; i < ch.length; i++) sum += ch[i] * ch[i]
      const rms = Math.sqrt(sum / ch.length)

      if (rms > 0.012) {
        state.speechT += dt
        state.silenceT = 0
        if (!state.speaking && state.speechT >= AutoAsr.ONSET_S) {
          state.speaking = true
          state.samples = []
          this.onStatus('hearing')
        }
        if (state.speaking) {
          for (let i = 0; i < ch.length; i++) state.samples.push(ch[i])
        }
      } else {
        state.speechT = 0
        if (state.speaking) {
          state.silenceT += dt
          for (let i = 0; i < ch.length; i++) state.samples.push(ch[i])
          if (state.silenceT >= AutoAsr.END_S) this._flushVad(state)
        }
      }
    }
    this.onStatus('listening')
  }

  async _flushVad(state) {
    const samples = state.samples
    state.speaking = false
    state.samples = []
    state.silenceT = 0
    if (samples.length < AutoAsr.MIN_SAMPLES) {
      this.onStatus('listening')
      return
    }
    state.busy = true
    this.onPartial('…')
    try {
      // downsample to 16k before upload: whisper resamples to 16k anyway, so
      // 48k WAV is 3x the bytes for zero gain (linear interp is fine for speech)
      const srcRate = state.ctx.sampleRate
      let out = samples, rate = srcRate
      if (srcRate > 16000) {
        rate = 16000
        const ratio = srcRate / rate
        out = new Float32Array(Math.floor(samples.length / ratio))
        for (let i = 0; i < out.length; i++) {
          const p = i * ratio, j = Math.floor(p), f = p - j
          out[i] = samples[j] * (1 - f) + (samples[j + 1] ?? samples[j]) * f
        }
      }
      const blob = encodeWav(out, rate)
      const fd = new FormData()
      fd.append('audio', blob, 'speech.wav')
      const r = await fetch('/api/asr', { method: 'POST', body: fd })
      if (!r.ok) throw new Error(await r.text())
      const { text } = await r.json()
      this.onPartial('')
      if (text?.trim()) this.onText(text.trim())
    } catch (e) {
      this.onStatus('error: ' + e.message)
    } finally {
      state.busy = false
      if (this.listening) this.onStatus('listening')
    }
  }
}