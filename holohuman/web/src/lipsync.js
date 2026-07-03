// Audio-driven lip sync: TTS plays through AnalyserNode → RMS + bands → mouth visemes.
export class LipSync {
  static MAX_GAP_S = 0.2

  constructor() {
    this.ctx = new (window.AudioContext || window.webkitAudioContext)()
    this.gain = this.ctx.createGain()
    this.gain.gain.value = 1
    this.analyser = this.ctx.createAnalyser()
    this.analyser.fftSize = 2048
    this.analyser.smoothingTimeConstant = 0.35
    this.gain.connect(this.analyser)
    this.analyser.connect(this.ctx.destination)
    this.buf = new Float32Array(this.analyser.fftSize)
    this.freq = new Uint8Array(this.analyser.frequencyBinCount)
    this.level = 0       // body/emphasis envelope (smoothed)
    this.lipLevel = 0    // mouth envelope (faster, follows TTS closely)
    this.bandLow = 0
    this.bandHigh = 0
    this.chainEnd = 0
    this.playingUntil = 0
    this.sources = []
    // synthetic mode: browser speechSynthesis can't route through the analyser,
    // so while it speaks we generate a speech-like envelope instead
    this.synth = false
    const unlock = () => { if (this.ctx.state === 'suspended') this.ctx.resume() }
    addEventListener('pointerdown', unlock)
    addEventListener('keydown', unlock)
  }

  get playing() {
    return this.synth || this.ctx.currentTime < this.playingUntil || this.sources.length > 0
  }

  play(audioBuffer) {
    return new Promise(resolve => {
      const now = this.ctx.currentTime
      const earliest = this.chainEnd > 0 ? this.chainEnd + 0.02 : now
      const latest = this.chainEnd > 0 ? this.chainEnd + LipSync.MAX_GAP_S : now
      const start = Math.min(Math.max(now, earliest), latest)
      const end = start + audioBuffer.duration

      const src = this.ctx.createBufferSource()
      src.buffer = audioBuffer
      src.connect(this.gain)
      this.sources.push(src)
      this.chainEnd = end
      this.playingUntil = Math.max(this.playingUntil, end)

      src.onended = () => {
        const i = this.sources.indexOf(src)
        if (i >= 0) this.sources.splice(i, 1)
        resolve()
      }
      src.start(start)
    })
  }

  stop() {
    for (const s of this.sources) {
      try { s.stop() } catch {}
      try { s.disconnect() } catch {}
    }
    this.sources = []
    this.synth = false
    this.chainEnd = 0
    this.playingUntil = 0
    this.level = 0
    this.lipLevel = 0
    this.bandLow = 0
    this.bandHigh = 0
  }

  async decode(arrayBuffer) {
    if (this.ctx.state === 'suspended') await this.ctx.resume()
    return this.ctx.decodeAudioData(arrayBuffer)
  }

  tick() {
    if (this.synth) {
      // layered sines ≈ syllable rhythm; good enough to read as speech
      const t = performance.now() / 1000
      const e = Math.max(0, 0.42
        + Math.sin(t * 9.1) * 0.33
        + Math.sin(t * 13.7 + 1.2) * 0.22
        + Math.sin(t * 5.3 + 0.4) * 0.16)
      const target = Math.min(1, e)
      this.lipLevel += (target - this.lipLevel) * (target > this.lipLevel ? 0.58 : 0.32)
      this.level += (target - this.level) * 0.22
      this.bandLow += (0.5 + Math.sin(t * 3.1) * 0.3 - this.bandLow) * 0.3
      this.bandHigh += (0.5 - Math.sin(t * 3.1 + 0.7) * 0.3 - this.bandHigh) * 0.3
      return
    }
    const live = this.playing
    if (!live) {
      this.lipLevel *= 0.72
      this.level *= 0.82
      this.bandLow *= 0.8
      this.bandHigh *= 0.8
      return
    }

    this.analyser.getFloatTimeDomainData(this.buf)
    let sum = 0
    for (let i = 0; i < this.buf.length; i++) sum += this.buf[i] * this.buf[i]
    const rms = Math.sqrt(sum / this.buf.length)
    const target = Math.min(1, rms * 11)

    const lipK = target > this.lipLevel ? 0.58 : 0.32
    this.lipLevel += (target - this.lipLevel) * lipK

    const bodyK = target > this.level ? 0.28 : 0.16
    this.level += (target - this.level) * bodyK

    this.analyser.getByteFrequencyData(this.freq)
    const hz = this.ctx.sampleRate / 2 / this.freq.length
    const sumBand = (a, b) => {
      let s = 0
      for (let i = Math.floor(a / hz); i < Math.min(this.freq.length, Math.ceil(b / hz)); i++) s += this.freq[i]
      return s
    }
    const low = sumBand(100, 600), high = sumBand(1800, 6000), total = sumBand(100, 6000) + 1
    const rawLow = low / total, rawHigh = high / total
    const bk = 0.35
    this.bandLow += (rawLow - this.bandLow) * bk
    this.bandHigh += (rawHigh - this.bandHigh) * bk
  }

  bands() {
    return { low: this.bandLow, high: this.bandHigh }
  }
}