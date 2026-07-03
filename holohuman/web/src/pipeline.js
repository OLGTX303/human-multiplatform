// Chat pipeline: text/mic -> LLM (SSE stream) -> sentence split -> TTS queue
// -> sequential playback with lip sync. Mirrors the original Unity project's
// "segment TTS while the LLM is still streaming" behaviour.

import { AutoAsr } from './asr.js'

const SENTENCE_END = /([。！？；!?;]|\.\s|\n)/
const ASR_LANG = { en: 'en-US', zh: 'zh-CN', ja: 'ja-JP', ko: 'ko-KR' }

export class Pipeline {
  constructor(lipsync) {
    this.lipsync = lipsync
    this.messages = []
    this.gen = 0
    this.speechQ = []
    this.speechBusy = false
    this.speechDone = Promise.resolve()

    this.$text = document.getElementById('text')
    this.$sub = document.getElementById('subtitle')
    this.$status = document.getElementById('status')

    document.getElementById('send').onclick = () => this.sendText()
    this.$text.addEventListener('keydown', e => { if (e.key === 'Enter') this.sendText() })
    this.initMic()

    fetch('/api/config').then(r => r.json())
      .then(c => {
        this.$status.textContent = `LLM ${c.llm_model} · TTS ${c.tts_engine} · ASR ${c.asr_engine}`
        if (this.asr) this.asr.lang = ASR_LANG[c.asr_lang] || c.asr_lang || 'en-US'
      })
      .catch(() => { this.$status.textContent = 'backend offline' })
  }

  sendText() {
    const t = this.$text.value.trim()
    if (!t) return
    this.$text.value = ''
    this.send(t)
  }

  async send(userText) {
    const gen = (this.gen = (this.gen || 0) + 1)
    this.speechQ = []
    this.lipsync.stop()
    // direct commands: "dance for me" starts dancing, "stop" ends it
    if (/\bdance\b|跳舞/i.test(userText)) window.__behavior?.setDance(true)
    else if (/\bstop\b|停止|别跳/i.test(userText)) window.__behavior?.setDance(false)
    this.messages.push({ role: 'user', content: userText })
    this.subtitle('…')
    let full = '', pending = ''
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: this.messages }),
      })
      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let buf = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        if (this.gen !== gen) return
        buf += dec.decode(value, { stream: true })
        let idx
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const line = buf.slice(0, idx).replace(/^data: /, '')
          buf = buf.slice(idx + 2)
          if (line === '[DONE]') continue
          const msg = JSON.parse(line)
          if (msg.error) { this.subtitle('⚠ ' + msg.error); return }
          full += msg.delta
          pending += msg.delta
          this.subtitle(full)
          // flush complete sentences to TTS while still streaming
          let m
          while ((m = SENTENCE_END.exec(pending))) {
            const sentence = pending.slice(0, m.index + m[0].length).trim()
            pending = pending.slice(m.index + m[0].length)
            if (sentence) this.enqueueSpeech(sentence, gen)
          }
        }
      }
      if (this.gen !== gen) return
      if (pending.trim()) this.enqueueSpeech(pending.trim(), gen)
      this.messages.push({ role: 'assistant', content: full })
      this.speechDone = this.speechDone.then(() => { if (this.gen === gen) this.subtitle('') })
    } catch (e) {
      this.subtitle('⚠ ' + e.message)
    }
  }

  prefetchTts(sentence) {
    return (async () => {
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: sentence }),
      })
      if (!res.ok) throw new Error(await res.text())
      return this.lipsync.decode(await res.arrayBuffer())
    })()
  }

  enqueueSpeech(sentence, gen = this.gen) {
    const job = { sentence, gen, audio: this.prefetchTts(sentence) }
    this.speechQ.push(job)
    this.drainSpeech()
  }

  async drainSpeech() {
    if (this.speechBusy) return
    this.speechBusy = true
    this.asr?.pause()
    while (this.speechQ.length) {
      const job = this.speechQ[0]
      if (job.gen !== this.gen) { this.speechQ.shift(); continue }
      this.speechQ.shift()
      window.__behavior?.cueSentence(job.sentence)
      try {
        const audio = await job.audio
        if (job.gen !== this.gen) continue
        if (this.lipsync.ctx.state === 'suspended') await this.lipsync.ctx.resume()
        await this.lipsync.play(audio)
      } catch (e) {
        console.warn('tts failed:', e)
        this.$status.textContent = '⚠ TTS: ' + e.message
      }
    }
    this.speechBusy = false
    this.asr?.resume()
  }

  subtitle(t) {
    this.$sub.textContent = t
    this.$sub.classList.toggle('show', !!t)
  }

  // -------------------------------------------------- mic (auto listen + recognise)
  initMic() {
    const btn = document.getElementById('mic')
    const syncBtn = (state) => {
      btn.classList.toggle('on', state === 'listening')
      btn.classList.toggle('rec', state === 'hearing')
      btn.title = state === 'off' ? 'Click to listen' : state === 'hearing' ? 'Hearing…' : 'Listening (click to mute)'
    }

    this.asr = new AutoAsr({
      onText: t => this.send(t),
      onPartial: t => { if (t) this.subtitle('🎧 ' + t); else if (!this.speechBusy) this.subtitle('') },
      onStatus: s => {
        if (s.startsWith('error:') || s === 'mic denied') this.subtitle('⚠ ' + s.replace('error: ', ''))
        syncBtn(s === 'paused' ? 'listening' : s)
      },
    })

    btn.onclick = () => {
      const on = this.asr.toggle()
      syncBtn(on ? 'listening' : 'off')
    }

    // auto-activate after first user gesture (browser mic policy)
    const boot = () => {
      this.asr.start().then(on => syncBtn(on ? 'listening' : 'off'))
        .catch(e => this.subtitle('⚠ mic: ' + e.message))
    }
    addEventListener('pointerdown', boot, { once: true })
    addEventListener('keydown', boot, { once: true })
  }
}