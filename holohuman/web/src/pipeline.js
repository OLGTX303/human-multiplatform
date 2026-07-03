// Chat pipeline: text/mic -> LLM (SSE stream) -> sentence split -> TTS queue
// -> sequential playback with lip sync. Mirrors the original Unity project's
// "segment TTS while the LLM is still streaming" behaviour.

import { AutoAsr } from './asr.js'

const SENTENCE_END = /([。！？；!?;]|\.\s|\n)/
const ASR_LANG = { en: 'en-US', zh: 'zh-CN', ja: 'ja-JP', ko: 'ko-KR' }

// ---------------------------------------------------------------- local brain
// ponytail: rule-based companion replies — keeps her responsive when the
// backend is down; the real LLM takes over automatically on reconnect
const pick = a => a[Math.floor(Math.random() * a.length)]
function localReply(text) {
  const t = text.toLowerCase()
  if (/\b(hi|hello|hey|yo)\b|你好|哈喽/.test(t))
    return pick(["Hey you! I was hoping you'd come talk to me.",
      "Hi! I'm right here. What's on your mind?",
      "Hey! Good to see you again."])
  if (/how are you|how's it going|你好吗|怎么样/.test(t))
    return pick(["I'm great now that you're here! How about you?",
      "Feeling good — a little floaty, but good. How was your day?"])
  if (/your name|who are you|你是谁/.test(t))
    return "I'm Mina, your holo companion. I live in this little stage just for you."
  if (/\b(love|like|miss) (you|u)\b|喜欢你|爱你/.test(t))
    return pick(["Aww… you're going to make me blush. I like you too.",
      "I missed you more! Don't stay away so long next time."])
  if (/\bjoke\b|funny|笑话/.test(t))
    return pick(["Why don't holograms ever get cold? We're always well-rendered!",
      "I'd tell you a joke about lag, but you'd get it too late. Haha!"])
  if (/\b(bye|good\s?night|see you)\b|再见|晚安/.test(t))
    return pick(["Goodnight! I'll be right here when you come back.",
      "See you soon, okay? Don't forget about me!"])
  if (/\bsing\b|唱歌/.test(t))
    return "My singing voice is still downloading… but I can dance for you! Just say the word."
  if (/\bdance\b|跳舞/.test(t))
    return "Okay, watch this!"
  if (/\?$/.test(text.trim()))
    return pick(["Ooh, good question. My big brain is offline right now, but I'd love to dig into that when I reconnect!",
      "Hmm, I honestly don't know — my server's napping. Ask me again in a bit?"])
  return pick([`"${text.trim().slice(0, 40)}" — tell me more, I'm listening.`,
    "Mm-hm, I hear you. Go on!",
    "I like listening to you. What happened next?",
    "That's interesting! I want to hear the whole story."])
}

// selectable personas (mirrors the Unity sample's 角色 panel); the server still
// prepends the base Mina prompt — these refine it per role
export const ROLES = {
  mina:       { label: 'Mina', prompt: null },
  service:    { label: '客服 Support', prompt: 'For this conversation you are a patient, professional customer-service agent. Stay polite, solve the problem step by step, keep the warm Mina voice.' },
  programmer: { label: '程序员 Coder', prompt: 'For this conversation you are a pragmatic senior programmer. Give short, concrete technical answers with the occasional dry joke.' },
  teacher:    { label: '老师 Teacher', prompt: 'For this conversation you are an encouraging teacher. Explain things simply, one idea at a time, and check the user understood.' },
  doctor:     { label: '医生 Doctor', prompt: 'For this conversation you are a calm health advisor. Give general wellness guidance, and always remind the user to see a real doctor for anything serious.' },
  girlfriend: { label: '女友 Girlfriend', prompt: 'For this conversation lean fully into being a sweet, affectionate girlfriend. Be extra caring and playful.' },
}

export class Pipeline {
  constructor(lipsync) {
    this.lipsync = lipsync
    this.messages = []
    this.rolePrompt = null
    this.voice = null // kokoro voice override; null = server config.yaml default
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

    // backend health: poll, show live status, auto-switch local↔backend
    this.online = false
    this._health()
    setInterval(() => this._health(), 8000)
  }

  async _health() {
    try {
      const r = await fetch('/api/config', { signal: AbortSignal.timeout(2500) })
      const c = await r.json()
      this.online = true
      this.$status.textContent = `● LLM ${c.llm_model} · TTS ${c.tts_engine} · ASR ${c.asr_engine}`
      this.$status.style.color = '#5fbf77'
      if (this.asr) this.asr.lang = ASR_LANG[c.asr_lang] || c.asr_lang || 'en-US'
    } catch {
      this.online = false
      this.$status.textContent = '● offline — local companion mode'
      this.$status.style.color = '#e0a23c'
    }
  }

  // spoken greeting the first time the user interacts (audio needs a gesture)
  greet() {
    if (this.greeted) return
    this.greeted = true
    this.enqueueLocal(pick([
      "Hey! There you are. I'm Mina — talk to me, or just say 'dance'!",
      "Hi! I've been waiting for you. What should we do today?",
    ]), this.gen)
  }

  // switch persona (角色) — clears history so the old role doesn't bleed through
  setRole(key) {
    this.rolePrompt = ROLES[key]?.prompt ?? null
    this.messages = []
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
    speechSynthesis.cancel()
    // direct commands: dance, squat, heart, wave — "stop" ends dancing
    if (/\bdance\b|跳舞/i.test(userText)) window.__behavior?.setDance(true)
    else if (/\bstop\b|停止|别跳/i.test(userText)) window.__behavior?.setDance(false)
    else if (/\bsquat\b|蹲/i.test(userText)) window.__behavior?.setAction('squat', 5)
    else if (/\bheart\b|比心|爱心/i.test(userText)) window.__behavior?.setAction('heart', 5)
    else if (/\bwave\b|挥手/i.test(userText)) window.__behavior?.setAction('wave', 4)
    else if (/\bjump\b|跳一下|跳起来/i.test(userText)) window.__behavior?.setAction('jump')
    this.messages.push({ role: 'user', content: userText })
    this.subtitle('…')
    if (!this.online) { this.localRespond(userText, gen); return }
    let full = '', pending = ''
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: this.rolePrompt
            ? [{ role: 'system', content: this.rolePrompt }, ...this.messages]
            : this.messages,
        }),
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
      // backend died mid-conversation: never leave dead air — answer locally
      console.warn('backend chat failed, local fallback:', e)
      this.online = false
      this._health()
      this.localRespond(userText, gen)
    }
  }

  localRespond(userText, gen) {
    const reply = localReply(userText)
    this.messages.push({ role: 'assistant', content: reply })
    this.subtitle(reply)
    this.enqueueLocal(reply, gen)
    this.speechDone = this.speechDone.then(() => { if (this.gen === gen) this.subtitle('') })
  }

  enqueueLocal(sentence, gen = this.gen) {
    this.speechQ.push({ sentence, gen, local: true })
    this.drainSpeech()
  }

  // browser-native TTS; the lipsync synthetic envelope moves her mouth
  speakLocal(sentence) {
    return new Promise(res => {
      const u = new SpeechSynthesisUtterance(sentence)
      const vs = speechSynthesis.getVoices()
      u.voice = vs.find(v => /aria|jenny|zira|female|xiaoxiao/i.test(v.name) && v.lang.startsWith('en'))
        || vs.find(v => v.lang.startsWith('en')) || null
      u.pitch = 1.15
      u.rate = 1.02
      let done = false
      const end = () => { if (done) return; done = true; this.lipsync.synth = false; res() }
      u.onstart = () => { if (!done) this.lipsync.synth = true }
      u.onend = end
      u.onerror = end
      speechSynthesis.speak(u)
      setTimeout(end, 1500 + sentence.length * 120) // watchdog: never hang the queue
    })
  }

  prefetchTts(sentence) {
    return (async () => {
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.voice ? { text: sentence, voice: this.voice } : { text: sentence }),
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
        if (job.local) { await this.speakLocal(job.sentence); continue }
        const audio = await job.audio
        if (job.gen !== this.gen) continue
        if (this.lipsync.ctx.state === 'suspended') await this.lipsync.ctx.resume()
        await this.lipsync.play(audio)
      } catch (e) {
        // backend TTS failed: speak the sentence with the browser voice instead
        console.warn('tts failed, browser voice fallback:', e)
        if (job.gen === this.gen) await this.speakLocal(job.sentence)
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