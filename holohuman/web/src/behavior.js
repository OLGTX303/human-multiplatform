// Procedural human behavior: visemes, emotion, gaze, blinking, breathing,
// weight shifts and talking gestures. Drives the avatar's named channels
// (ARKit blendshapes on Mina, VRM expressions on VRM models) every frame.

const clamp01 = v => Math.max(0, Math.min(1, v))
const outward = v => Math.max(0, v)
// layered sines ≈ organic noise (cheap perlin substitute)
const wobble = (t, f) => (Math.sin(t * f) + Math.sin(t * f * 2.7 + 1.3) * 0.5 + Math.sin(t * f * 0.31 + 4.1) * 0.8) / 2.3
// one driver → correlated x/y/z so joints rotate as a bundle, not independent axes
const bundle = (driver, px = 0, py = 0, pz = 0) => ({ x: driver * px, y: driver * py, z: driver * pz })
const addB = (...parts) => parts.reduce((a, b) => ({
  x: a.x + b.x, y: a.y + b.y, z: a.z + b.z,
}), { x: 0, y: 0, z: 0 })
const restOf = bone => {
  if (!bone.userData.rest) bone.userData.rest = bone.rotation.clone()
  return bone.userData.rest
}
const setBone = (bone, rot) => { if (bone) bone.rotation.set(rot.x, rot.y, rot.z) }
// facial-channel targets per emotion; headX tilts the head (+down / -up)
export const EMOTIONS = {
  neutral:   {},
  happy:     { smile: 0.85, browUp: 0.25 },
  laugh:     { smile: 1, jaw: 0.5, squint: 0.6, browUp: 0.35, headX: -0.06 },
  sad:       { frown: 0.7, browSad: 0.95, headX: 0.1 },
  cry:       { frown: 0.9, browSad: 1, squint: 0.55, tears: 1, jaw: 0.12, headX: 0.14 },
  angry:     { browDown: 1, squint: 0.5, frown: 0.65, headX: -0.04 },
  surprised: { browUp: 1, eyeWide: 0.9, jaw: 0.3 },
}
const EMO_KEYS = ['smile', 'jaw', 'squint', 'browUp', 'browSad', 'browDown', 'frown', 'eyeWide', 'tears', 'headX']

// complex body actions: bone offsets from rest, blended in/out over ~0.3s.
// Angles found empirically on this rig (z− lifts arms forward, thigh z+ =
// forward pitch, calf z− = knee bend, foot z = ankle pitch).
export const ACTIONS = {
  heart: { // open heart above the head: elbows flared out, hands uncrossed
    emotion: 'happy',
    fingerCurl: 0.45,
    bones: {
      leftUpperArm: { y: 0.3, z: -2.0 }, rightUpperArm: { y: 0.3, z: -2.0 },
      leftLowerArm: { y: 0.75, z: -1.15 }, rightLowerArm: { y: 0.75, z: -1.15 },
      leftHand: { z: -0.55 }, rightHand: { z: -0.55 }, // wrists curve → heart arcs
      head: { x: 0.08 }, // slight chin tuck
    },
  },
  squat: { // deep squat, arms forward for balance, feet stay grounded
    groundFeet: true,
    bones: {
      leftThigh: { z: 1.15 }, rightThigh: { z: 1.15 },
      leftCalf: { z: -2.0 }, rightCalf: { z: -2.0 },
      leftFoot: { z: 0.85 }, rightFoot: { z: 0.85 },
      spine: { x: 0.15 }, chest: { x: 0.12 },
      leftUpperArm: { z: -0.9 }, rightUpperArm: { z: -0.9 },
      leftLowerArm: { z: -0.45 }, rightLowerArm: { z: -0.45 },
    },
  },
  wave: { // friendly overhead wave with the right hand
    emotion: 'happy',
    bones: {
      rightUpperArm: { y: -0.5, z: -1.9 },
      rightLowerArm: { z: -0.9 },
      head: { z: 0.1 },
    },
    wiggle: { bone: 'rightLowerArm', axis: 'y', amp: 0.35, freq: 4.2 },
  },
}

export class Behavior {
  constructor(lipsync) {
    this.lip = lipsync
    this.avatar = null
    // smoothed viseme state
    this.jaw = 0; this.funnel = 0; this.stretch = 0
    // blink
    this.blinkT = 2; this.blinkV = 0; this.doubleBlink = false
    // gaze
    this.gx = 0; this.gy = 0; this.tx = 0; this.ty = 0; this.gazeT = 1.5
    // talking detection + smoothed speech envelopes (never drive bones from raw level)
    this.talkT = 0; this.nod = 0; this.prevTalk = 0
    this.talkEnv = 0; this.talkLow = 0; this.talkHigh = 0; this.jawFast = 0
    this.facePress = 0; this.faceUpper = 0; this.faceLower = 0
    this.faceCheek = 0; this.faceDimple = 0; this.talkSquint = 0
    this.faceSideL = 0; this.faceSideR = 0; this.faceRollU = 0; this.faceRollL = 0
    this.faceSmileL = 0; this.faceSmileR = 0
    this.faceShrugU = 0; this.faceShrugL = 0; this.faceJawFwd = 0; this.facePuff = 0
    // talking arm gestures: per-arm goal + eased current pose
    this.gestT = 0
    this.gest = [{ lift: 0, bend: 0, out: 0 }, { lift: 0, bend: 0, out: 0 }]
    this.gestGoal = [{ lift: 0, bend: 0, out: 0 }, { lift: 0, bend: 0, out: 0 }]
    // emotion envelopes (decay toward baseline each frame)
    this.smile = 0.12; this.browUp = 0; this.smileTarget = 0.12; this.browTarget = 0
    this.tiltPulse = 0
    this.energy = 0.5 // conversational arousal: scales gesture size/tempo
    // posture drift: the body slowly settles into a new stance every few seconds
    this.postureT = 3
    this.pose = { lean: 0, twist: 0, drop: 0 }       // current
    this.poseT = { lean: 0.02, twist: 0.03, drop: 0 } // target
    // emotion state: explicit (from UI/API) or pulsed (from sentence cues)
    this.emoName = 'neutral'; this.emoIntensity = 1; this.emoPulseT = 0; this.emoLocked = false
    this.emo = Object.fromEntries(EMO_KEYS.map(k => [k, 0]))
    // dance
    this.dancing = false; this.danceRestore = false; this.danceBlend = 0
    this.dancePhase = Math.random() * Math.PI * 2
    // complex actions (squat, heart, wave …) + procedural jump
    this.actionName = null; this.actionT = 0; this.actionBlend = 0; this._lastAct = null
    this.jumpT = -1
  }

  setAvatar(a) {
    this.avatar = a
    a?.scene?.traverse(o => { if (o.isBone) delete o.userData.smooth })
  }

  // explicit emotion (UI/API). locked=true keeps it until changed; otherwise
  // pulseSeconds lets it fade back to neutral.
  setEmotion(name, intensity = 1, pulseSeconds = 0) {
    this.emoName = EMOTIONS[name] ? name : 'neutral'
    this.emoIntensity = intensity
    this.emoLocked = pulseSeconds <= 0
    this.emoPulseT = pulseSeconds
  }

  // companion gaze: follow the user's pointer (x,y in [-1,1], y up)
  lookToward(x, y) {
    this.tx = Math.max(-1, Math.min(1, x)) * 0.8
    this.ty = Math.max(-1, Math.min(1, y)) * 0.45
    this.gazeT = Math.max(this.gazeT, 0.8) // hold on the cursor before saccading away
  }

  setDance(on) {
    if (this.dancing && !on) this.danceRestore = true
    this.dancing = on
    if (on) this.dancePhase = performance.now() * 0.001 * 2 * Math.PI * (112 / 60)
  }

  // complex action by name ('squat' | 'heart' | 'wave' | 'jump'), held for `seconds`
  setAction(name, seconds = 4) {
    if (name === 'jump') { if (this.jumpT < 0) this.jumpT = 0; return true }
    if (!ACTIONS[name]) return false
    this.actionName = name
    this.actionT = seconds
    return true
  }

  // called by the pipeline for every sentence sent to TTS — auto emotion AND
  // body action, so she performs the line instead of standing like a model
  cueSentence(s) {
    if (!this.emoLocked || this.emoName === 'neutral') {
      if (/haha|lol|😂|🤣|hilarious|so funny|joke/i.test(s)) this.setEmotion('laugh', 0.9, 3)
      else if (/😢|😭|i'?m sorry|so sad|sadly|unfortunately|terrible|miss(ed)? you|lonely/i.test(s)) this.setEmotion('sad', 0.8, 3.5)
      else if (/😠|outrageous|unacceptable|angry|annoying|ugh\b/i.test(s)) this.setEmotion('angry', 0.7, 3)
      else if (/wow|amazing|incredible|unbelievable|😮|really\?|no way|can'?t believe/i.test(s)) this.setEmotion('surprised', 0.8, 2.5)
      else if (/😄|😀|🎉|love|great|awesome|glad|happy|excited|yay|nice to/i.test(s)) this.setEmotion('happy', 0.7, 3)
    }
    // arousal: exclamations and emotive words energize the whole body
    const excited = /[!🎉😄😂🤣]|wow|amazing|love|great|awesome|yay|no way/i.test(s)
    this.energy = excited ? 1 : Math.max(this.energy, 0.65)
    if (/[!😀😄🎉]|great|awesome|glad|nice|love/i.test(s)) { this.smileTarget = 0.65 }
    if (/\?\s*$/.test(s.trim())) {
      this.browTarget = 0.7
      this.tiltPulse = 1
      // asking: offer a hand — force an open gesture on one arm right now
      const g = this.gestGoal[Math.random() < 0.5 ? 0 : 1]
      g.bend = 0.7; g.lift = 0.28; g.out = 0.22
      this.gestT = 1.6
    } else {
      this.browTarget = 0.35 // mild brow raise at each new sentence
      this.gestT = Math.min(this.gestT, 0.12 + Math.random() * 0.25) // gesture lands on the beat
    }
    // emphatic lines: lean toward the user instead of drifting
    if (excited) { this.poseT.lean = (Math.random() * 2 - 1) * 0.03; this.poseT.drop = 0; this.postureT = 4 }
  }

  update(dt, t) {
    const a = this.avatar
    if (!a) return
    const ch = a.channels
    const C = n => ch[n] || (() => {})   // avatars may lack some channels (VRM)
    const level = this.lip.level
    const lipLevel = this.lip.lipLevel
    const bands = this.lip.bands()

    // ---------- emotion blend (pulses fade back to neutral)
    if (!this.emoLocked && this.emoPulseT > 0) {
      this.emoPulseT -= dt
      if (this.emoPulseT <= 0) this.emoName = 'neutral'
    }
    const preset = EMOTIONS[this.emoName] || {}
    const ek = 1 - Math.exp(-dt * 4)
    for (const kk of EMO_KEYS)
      this.emo[kk] += ((preset[kk] || 0) * this.emoIntensity - this.emo[kk]) * ek
    C('frown')(this.emo.frown)
    C('browDown')(this.emo.browDown)
    C('eyeWide')(this.emo.eyeWide)
    C('tears')(this.emo.tears)

    // ---------- talking state — locked to TTS audio playback
    if (this.lip.playing || lipLevel > 0.035) this.talkT = 0.45
    else this.talkT -= dt
    const talking = this.talkT > 0

    // body envelope (smoothed); mouth reads lipLevel directly from the analyser
    const envK = 1 - Math.exp(-dt * 7)
    this.talkEnv += (level - this.talkEnv) * envK
    this.talkLow += (bands.low * lipLevel - this.talkLow) * envK
    this.talkHigh += (bands.high * lipLevel - this.talkHigh) * envK
    const talk = talking ? this.talkEnv : 0

    // ---------- visemes: audio-driven jaw + spectrum-shaped lips
    const lipK = 1 - Math.exp(-dt * 20)
    const jawTarget = clamp01(lipLevel * 1.55)
    this.jaw += (jawTarget - this.jaw) * lipK
    this.jawFast = this.jaw
    this.funnel += (clamp01(this.talkLow * 2.6 + lipLevel * 0.25) - this.funnel) * lipK
    this.stretch += (clamp01(this.talkHigh * 2.8 + lipLevel * 0.15) - this.stretch) * lipK
    ch.jaw(Math.max(this.jaw * 0.95, this.emo.jaw))
    ch.funnel(this.funnel * 0.85)
    ch.stretch(this.stretch * 0.75)

    // ---------- talk face — asymmetric corners, lip roll, independent left/right
    const faceK = 1 - Math.exp(-dt * 11)
    const lipAsym = wobble(t, 0.72) * 0.06
    const pressT = talking ? clamp01(this.talkHigh * 2 + lipLevel * 0.35) * 0.26 : 0
    const upperT = talking ? clamp01(this.jaw * 0.65 + this.talkLow * 0.45 + lipLevel * 0.15) * 0.38 : 0
    const lowerT = talking ? clamp01(this.jaw * 0.55 + this.funnel * 0.4 + lipLevel * 0.2) * 0.42 : 0
    const cheekT = talking ? clamp01(this.jaw * 0.4 + this.smile * 0.25) * 0.22 : 0
    const dimpleT = talking ? clamp01(this.smile * 0.4 + talk * 0.1) * 0.24 : 0
    const squintT = talking ? talk * 0.1 : 0
    const sideLT = talking ? clamp01(this.talkLow * 1.6 + lipAsym) * 0.14 : 0
    const sideRT = talking ? clamp01(this.talkHigh * 1.6 - lipAsym) * 0.14 : 0
    const rollUT = talking ? clamp01(this.funnel * 0.55 + this.jaw * 0.2) * 0.18 : 0
    const rollLT = talking ? clamp01(this.jaw * 0.5 + this.stretch * 0.25) * 0.2 : 0
    const smileLT = talking ? clamp01(this.smile * 0.5 + this.talkLow * 0.35) * 0.22 : 0
    const smileRT = talking ? clamp01(this.smile * 0.5 + this.talkHigh * 0.35) * 0.22 : 0
    // lip fine detail: shrug on rounded/low vowels, jaw thrust on open lows,
    // cheek puff on plosive bursts (fast jaw rise)
    const shrugUT = talking ? clamp01(this.funnel * 0.8 - this.jaw * 0.25) * 0.45 : 0
    const shrugLT = talking ? clamp01(this.funnel * 0.5 + this.talkLow * 0.7) * 0.35 : 0
    const jawFwdT = talking ? clamp01(this.talkLow * 1.3 + this.jaw * 0.2) * 0.28 : 0
    const puffT = talking ? clamp01(this.talkLow * 1.1 - this.stretch * 0.6) * 0.18 : 0
    this.facePress += (pressT - this.facePress) * faceK
    this.faceUpper += (upperT - this.faceUpper) * faceK
    this.faceLower += (lowerT - this.faceLower) * faceK
    this.faceCheek += (cheekT - this.faceCheek) * faceK
    this.faceDimple += (dimpleT - this.faceDimple) * faceK
    this.talkSquint += (squintT - this.talkSquint) * faceK
    this.faceSideL += (sideLT - this.faceSideL) * faceK
    this.faceSideR += (sideRT - this.faceSideR) * faceK
    this.faceRollU += (rollUT - this.faceRollU) * faceK
    this.faceRollL += (rollLT - this.faceRollL) * faceK
    this.faceSmileL += (smileLT - this.faceSmileL) * faceK
    this.faceSmileR += (smileRT - this.faceSmileR) * faceK
    this.faceShrugU += (shrugUT - this.faceShrugU) * faceK
    this.faceShrugL += (shrugLT - this.faceShrugL) * faceK
    this.faceJawFwd += (jawFwdT - this.faceJawFwd) * faceK
    this.facePuff += (puffT - this.facePuff) * faceK
    C('shrugU')(this.faceShrugU)
    C('shrugL')(this.faceShrugL)
    C('jawFwd')(this.faceJawFwd)
    C('cheekPuff')(this.facePuff)
    C('lipPress')(this.facePress)
    C('lipUpper')(this.faceUpper)
    C('lipLower')(this.faceLower)
    C('lipSideL')(this.faceSideL)
    C('lipSideR')(this.faceSideR)
    C('lipRollU')(this.faceRollU)
    C('lipRollL')(this.faceRollL)
    C('dimple')(this.faceDimple)
    C('cheek')(this.faceCheek)
    C('squint')(clamp01(Math.max(this.emo.squint, this.talkSquint)))

    // ---------- emotion (decay to friendly baseline)
    this.smileTarget += (0.12 - this.smileTarget) * dt * 0.5
    this.browTarget += (0 - this.browTarget) * dt * 0.9
    this.smile += (this.smileTarget - this.smile) * dt * 4
    this.browUp += (this.browTarget - this.browUp) * dt * 5
    // sad-family emotions suppress the friendly baseline smile
    const sadness = Math.max(this.emo.frown, this.emo.browSad, this.emo.browDown)
    const smBase = clamp01(Math.max(this.smile * (1 - sadness), this.emo.smile))
    if (ch.smileL) {
      C('smileL')(clamp01(smBase + (talking ? this.faceSmileL : 0)))
      C('smileR')(clamp01(smBase + (talking ? this.faceSmileR : 0)))
    } else ch.smile(smBase)
    // brows also lift a touch with loud speech (natural emphasis)
    const browVal = clamp01(Math.max(this.browUp * (1 - sadness) + talk * 0.12, this.emo.browUp))
    ch.browUp(browVal)
    // inner brow follows normal raises, but sadness owns it
    C('browSad')(clamp01(Math.max(this.emo.browSad, browVal * 0.8)))
    this.tiltPulse = Math.max(0, this.tiltPulse - dt * 0.6)

    // ---------- blinking (double blinks ~20% of the time)
    this.blinkT -= dt
    if (this.blinkT <= 0) {
      this.blinkT = (talking ? 1.5 : 2.5) + Math.random() * 3
      this.blinkV = 0.14
      this.doubleBlink = Math.random() < 0.2
    }
    if (this.blinkV > 0) {
      this.blinkV -= dt
      if (this.doubleBlink && this.blinkV <= 0) { this.doubleBlink = false; this.blinkV = 0.14; }
    }
    const bv = this.blinkV > 0 ? 1 - Math.abs(this.blinkV - 0.07) / 0.07 : 0
    ch.blink(clamp01(bv))

    // ---------- gaze: saccades when idle, mostly eye contact when talking
    this.gazeT -= dt
    if (this.gazeT <= 0) {
      this.gazeT = 0.7 + Math.random() * (talking ? 2.5 : 1.8)
      if (talking && Math.random() < 0.7) { this.tx = 0; this.ty = 0 }       // back to camera
      else {
        const amp = talking ? 0.35 : 0.7   // glance less far away mid-sentence
        this.tx = (Math.random() * 2 - 1) * amp
        this.ty = (Math.random() * 2 - 1) * amp * 0.5
      }
    }
    const gk = 1 - Math.exp(-dt * 14)             // saccades are fast
    this.gx += (this.tx - this.gx) * gk
    this.gy += (this.ty - this.gy) * gk
    ch.lookX(this.gx)
    ch.lookY(this.gy)

    // ---------- head: slow nod on smoothed emphasis, gentle talk sway (no spike gestures)
    const dTalk = (this.talkEnv - this.prevTalk) / Math.max(dt, 1e-4)
    this.prevTalk = this.talkEnv
    this.nod += ((dTalk > 1.8 ? 0.35 : 0) - this.nod) * (1 - Math.exp(-dt * 3.5))
    const talkSway = talking ? wobble(t, 0.28) * talk * 0.22 : 0
    const head = a.getBone('head')
    if (head) {
      const r = restOf(head)
      const gazeDrive = this.gx * 0.5 + this.gy * 0.35
      const headMot = addB(
        bundle(gazeDrive, 0.12, 0.85, 0.08),
        bundle(talkSway, 0.35, 0.25, 0.15),
        bundle(this.nod, 0.5, 0.15, 0.05),
        bundle(wobble(t, 0.2), 0.035, 0.06, 0.08),
        bundle(this.tiltPulse, 0.05, 0.02, 0.55),
        { x: this.emo.headX, y: 0, z: 0 },
      )
      setBone(head, addB(r, headMot))
    }

    // ---------- fingers: never frozen — staggered micro-curl waves; gestures
    // curl them further (uses last frame's gesture state; runs during dance too)
    if (a.fingers) {
      for (let s = 0; s < 2; s++) {
        const list = s === 0 ? a.fingers.left : a.fingers.right
        const g = this.gest?.[s]
        for (let j = 0; j < list.length; j++) {
          const b = list[j]
          const r = restOf(b)
          const isThumb = b.name.startsWith('thumb')
          const wave = wobble(t + j * 0.9 + s * 2.1, 0.45) * (isThumb ? 0.02 : 0.05)
          const talkCurl = (g?.bend || 0) * (isThumb ? 0.06 : 0.2) * (0.6 + wobble(t + j, 0.8) * 0.4)
          b.rotation.z = r.z + wave + talkCurl
        }
      }
    }

    // ---------- dance overrides body + arms; blend in/out so it never snaps stiff
    const danceK = 1 - Math.exp(-dt * (this.dancing ? 10 : 14))
    this.danceBlend += ((this.dancing ? 1 : 0) - this.danceBlend) * danceK
    if (this.danceBlend > 0.02) {
      this.updateDance(dt, t, this.danceBlend)
      if (this.danceBlend > 0.92) return
      return
    }
    const groundY = a.groundY ?? 0
    if (this.danceRestore) {
      this.danceRestore = false
      a.scene.position.y = groundY
      a.scene.rotation.y = 0
      for (const k of ['head', 'neck', 'chest', 'spine', 'hips',
        'leftClavicle', 'rightClavicle', 'leftUpperArm', 'rightUpperArm',
        'leftLowerArm', 'rightLowerArm', 'leftHand', 'rightHand',
        'leftThigh', 'rightThigh', 'leftCalf', 'rightCalf', 'leftFoot', 'rightFoot']) {
        const b = a.getBone(k)
        if (b?.userData.rest) b.rotation.copy(b.userData.rest)
        delete b?.userData.smooth
      }
    }

    // ---------- posture drift: pick a new stance every 5–14s, settle into it
    this.postureT -= dt
    if (this.postureT <= 0) {
      this.postureT = 5 + Math.random() * 9
      this.poseT.lean = (Math.random() * 2 - 1) * 0.085   // side lean (weight shift)
      this.poseT.twist = (Math.random() * 2 - 1) * 0.10   // torso turn
      this.poseT.drop = Math.random() * 0.035             // slight slouch
    }
    const pk = 1 - Math.exp(-dt * 1.2)                    // settle over ~1s
    for (const kk of ['lean', 'twist', 'drop'])
      this.pose[kk] += (this.poseT[kk] - this.pose[kk]) * pk

    // ---------- body: breathing (~15/min) + weight shifts. Root and hips stay
    // fixed on the vertical axis — all life comes from the joints, so she
    // stands like a person, not a swinging marionette.
    const breath = Math.sin(t * 1.6)
    const breath2 = Math.sin(t * 1.6 + 0.4)
    // ---------- jump: anticipation crouch → ballistic flight → landing absorb
    let jumpAir = 0
    this._jumpKnee = 0
    if (this.jumpT >= 0) {
      this.jumpT += dt
      const T = this.jumpT
      if (T < 0.18) {                       // load the legs
        this._jumpKnee = (T / 0.18) * 0.55
      } else if (T < 0.68) {                // airborne: v=2 m/s, g=8 → apex 25cm
        const ft = T - 0.18
        jumpAir = Math.max(0, 2 * ft - 4 * ft * ft)
        this._jumpKnee = 0.3                // legs tuck in the air
      } else if (T < 1.0) {                 // absorb the landing
        this._jumpKnee = (1 - (T - 0.68) / 0.32) * 0.5
      } else this.jumpT = -1
    }
    a.scene.position.y = groundY + jumpAir
    a.scene.rotation.y = 0
    const leanDrive = this.pose.lean + wobble(t, 0.08) * 0.008
    const twistDrive = this.pose.twist + (talking ? talkSway * 0.3 : 0)
    const spine = a.getBone('spine')
    if (spine) {
      const r = restOf(spine)
      setBone(spine, {
        x: r.x + breath * 0.010,
        y: r.y + twistDrive * 0.45,
        z: r.z + leanDrive * 0.5,
      })
    }
    const chest = a.getBone('chest')
    if (chest) {
      const r = restOf(chest)
      setBone(chest, {
        x: r.x + breath * 0.028 + this.pose.drop + (talking ? talk * 0.015 : 0),
        y: r.y + twistDrive * 0.4 + talkSway * 0.06,
        z: r.z + leanDrive * 0.45,
      })
    }
    const neck = a.getBone('neck')
    if (neck) {
      const r = restOf(neck)
      setBone(neck, {
        x: r.x + breath2 * 0.012 + talkSway * 0.05 + wobble(t, 0.18) * 0.008,
        y: r.y + twistDrive * 0.2,
        // neck counters the torso lean so the head stays level
        z: r.z - leanDrive * 0.55,
      })
    }
    // shoulders: tiny breathing shrug, opposite phase per side
    for (const [ck, sideC] of [['leftClavicle', 1], ['rightClavicle', -1]]) {
      const c = a.getBone(ck)
      if (!c) continue
      const r = restOf(c)
      setBone(c, { x: r.x, y: r.y, z: r.z + breath * 0.010 * sideC })
    }
    // pelvis: real weight shift — hips translate over the loaded leg (local x =
    // world lateral, local z = world vertical) and dip as the knees soften;
    // the thighs counter-swing so the feet stay planted (mini-IK).
    const hips = a.getBone('hips')
    const sc = a.scene.scale?.x || 1
    let hipShift = 0
    if (hips) {
      if (!hips.userData.restPos) hips.userData.restPos = hips.position.clone()
      const rp = hips.userData.restPos
      hipShift = -this.pose.lean * 0.33 + wobble(t, 0.2) * 0.008
      hips.position.x = rp.x + hipShift / sc
      hips.position.z = rp.z - (((this._kneeAvg ?? 0.07) - 0.07) * 0.18) / sc
    }
    // legs: soft knees, never wooden. Measured axes: thigh z = fwd/back pitch,
    // thigh y = lateral swing, calf z− = knee bend, foot z = ankle pitch.
    // The loaded leg stands straighter, the free knee relaxes; the chain bends
    // θ/2, −θ, +θ/2 so feet stay planted.
    let kneeSum = 0
    for (const [tk, ck, fk, ph, sideL] of [
      ['leftThigh', 'leftCalf', 'leftFoot', 0.3, 1],
      ['rightThigh', 'rightCalf', 'rightFoot', 1.1, -1]]) {
      // lean right → left leg unloads and its knee softens (and vice versa)
      const unload = clamp01(0.5 - sideL * this.pose.lean * 6)
      const knee = 0.05 + unload * 0.09
        + wobble(t + ph * 3, 0.55) * 0.05 + breath * 0.012 + (this._jumpKnee || 0)
      kneeSum += knee
      const thigh = a.getBone(tk)
      if (thigh) {
        const r = restOf(thigh)
        setBone(thigh, {
          x: r.x,
          // counter the pelvis shift (y+ swings the foot center-ward) so the
          // feet hold their ground while the hips travel
          y: r.y + leanDrive * 0.05 * sideL + hipShift * 1.2,
          z: r.z + knee * 0.5,
        })
      }
      const calf = a.getBone(ck)
      if (calf) {
        const r = restOf(calf)
        setBone(calf, { x: r.x, y: r.y, z: r.z - knee })
      }
      const foot = a.getBone(fk)
      if (foot) {
        const r = restOf(foot)
        setBone(foot, { x: r.x, y: r.y, z: r.z + knee * 0.5 })
      }
    }
    this._kneeAvg = kneeSum / 2
    // ---------- arms. Axes measured on this rig (both sides mirrored):
    // z− lifts the upper arm forward / bends the elbow forward, y− flares out.
    // While talking: conversational gestures — a new arm pose every ~2s, elbows
    // bend up, emphasis syllables pulse extra bend. Idle: barely-alive drift.
    this.energy += (0.5 - this.energy) * (1 - Math.exp(-dt * 0.35)) // cool down
    this.gestT -= dt
    if (this.gestT <= 0) {
      // energized speech → faster, bigger gestures; calm speech → sparser
      this.gestT = (1.4 + Math.random() * 1.8) / (0.6 + this.energy * 0.8)
      const amp = 0.55 + this.energy * 0.9
      for (const g of this.gestGoal) {
        if (talking && Math.random() < 0.75) {
          g.bend = (0.45 + Math.random() * 0.6) * amp   // forearm comes up
          g.lift = (0.10 + Math.random() * 0.22) * amp  // shoulder forward
          g.out = 0.05 + Math.random() * 0.18           // flare out — never into the torso
        } else { g.bend = 0; g.lift = 0; g.out = 0 }
      }
    }
    if (!talking) for (const g of this.gestGoal) { g.bend = 0; g.lift = 0; g.out = 0 }
    const gestK = 1 - Math.exp(-dt * 3.2)
    for (let i = 0; i < 2; i++)
      for (const k of ['bend', 'lift', 'out'])
        this.gest[i][k] += (this.gestGoal[i][k] - this.gest[i][k]) * gestK
    const beatPulse = this.nod * 0.35   // loud-syllable emphasis → extra elbow bend

    const armLife = [
      { upper: 'leftUpperArm', lower: 'leftLowerArm', hand: 'leftHand', ph: 0, side: 1 },
      { upper: 'rightUpperArm', lower: 'rightLowerArm', hand: 'rightHand', ph: 1.7, side: -1 },
    ]
    const shoulderK = 1 - Math.exp(-dt * 8)
    const elbowK = 1 - Math.exp(-dt * 5.5)
    const wristK = 1 - Math.exp(-dt * 10)
    for (let i = 0; i < armLife.length; i++) {
      const arm = armLife[i]
      const g = this.gest[i]
      const gesturing = g.bend > 0.03
      const idleSway = wobble(t + arm.ph, 0.13) * 0.024 + breath * 0.006
      const idleBend = 0.05 + wobble(t + arm.ph + 0.75, 0.16) * 0.03
      const talkWave = gesturing ? wobble(t + arm.ph, 0.5) * 0.05 : 0

      const upper = a.getBone(arm.upper)
      if (upper) {
        const r = restOf(upper)
        if (!upper.userData.smooth) upper.userData.smooth = { x: r.x, y: r.y, z: r.z }
        const s = upper.userData.smooth
        s.x = r.x
        s.y += ((r.y + idleSway - g.out) - s.y) * shoulderK
        s.z += ((r.z - g.lift - beatPulse * 0.15) - s.z) * shoulderK
        setBone(upper, s)
      }
      const lower = a.getBone(arm.lower)
      if (lower) {
        const r = restOf(lower)
        if (!lower.userData.smooth) lower.userData.smooth = { x: r.x, y: r.y, z: r.z }
        const s = lower.userData.smooth
        s.x = r.x
        s.y += ((r.y - idleSway * 0.35) - s.y) * elbowK
        s.z += ((r.z - (idleBend + g.bend + beatPulse + talkWave)) - s.z) * elbowK
        setBone(lower, s)
      }
      const hand = a.getBone(arm.hand)
      if (hand) {
        const r = restOf(hand)
        const wristOut = wobble(t + arm.ph + 1.45, 0.21) * 0.007
          + (gesturing ? wobble(t + arm.ph + 0.4, 0.6) * 0.06 : 0)
        if (!hand.userData.smooth) hand.userData.smooth = { x: r.x, y: r.y, z: r.z }
        const s = hand.userData.smooth
        s.x = r.x
        s.y += ((r.y - idleSway * 0.18) - s.y) * wristK
        s.z += ((r.z + wristOut * arm.side) - s.z) * wristK
        setBone(hand, s)
      }
    }

    // ---------- complex actions (squat, heart, wave): blended pose override
    this.actionT -= dt
    if (this.actionT <= 0) this.actionName = null
    const act = ACTIONS[this.actionName]
    if (act) this._lastAct = act
    this.actionBlend += ((act ? 1 : 0) - this.actionBlend) * (1 - Math.exp(-dt * 6))
    if (this.actionBlend > 0.02 && this._lastAct) {
      const A = this._lastAct
      const w = this.actionBlend
      for (const [k, off] of Object.entries(A.bones)) {
        const bb = a.getBone(k)
        if (!bb) continue
        const r = restOf(bb)
        bb.rotation.x += (r.x + (off.x || 0) - bb.rotation.x) * w
        bb.rotation.y += (r.y + (off.y || 0) - bb.rotation.y) * w
        bb.rotation.z += (r.z + (off.z || 0) - bb.rotation.z) * w
      }
      if (A.wiggle) { // e.g. the wave: oscillate one joint while held
        const wb = a.getBone(A.wiggle.bone)
        if (wb) wb.rotation[A.wiggle.axis] += Math.sin(t * A.wiggle.freq * Math.PI * 2) * A.wiggle.amp * w
      }
      if (A.fingerCurl && a.fingers)
        for (const list of [a.fingers.left, a.fingers.right])
          for (const fb of list)
            fb.rotation.z += A.fingerCurl * 0.35 * w * (fb.name.startsWith('thumb') ? 0.3 : 1)
      // adaptive grounding: sink the pelvis until the feet touch the floor,
      // whatever the leg pose is. Accumulated in _ground because the body code
      // rewrites hips.position every frame.
      if (A.groundFeet) {
        const foot = a.getBone('leftFoot'), hipsA = a.getBone('hips')
        if (foot && hipsA) {
          hipsA.position.z -= (this._ground || 0) / (a.scene.scale?.x || 1)
          foot.updateWorldMatrix(true, false)
          const err = foot.matrixWorld.elements[13] - 0.1 // rest ankle height
          this._ground = (this._ground || 0) + err * 0.5
          hipsA.position.z -= (err * 0.5) / (a.scene.scale?.x || 1)
        }
      } else {
        this._ground = (this._ground || 0) * (1 - w)
      }
      if (act && A.emotion) this.setEmotion(A.emotion, 0.8, 0.4)
    }
    if (this.actionBlend <= 0.02) this._ground = 0
  }

  // 112 BPM K-pop groove: staggered limbs, hip-led weight, hands alive — not stiff sine puppet
  updateDance(dt, t, blend) {
    const a = this.avatar
    const B = t * 2 * Math.PI * (112 / 60)
    const beat = Math.sin(B)
    const half = Math.sin(B / 2)
    const hit = Math.pow(Math.max(0, beat), 0.55)          // sharper downbeats
    const bounce = 1 - Math.abs(half)
    const sway = Math.sin(B / 2 + 0.9) * 0.5 + Math.sin(B / 4 + 2.1) * 0.5

    this.smileTarget = 0.7 + hit * 0.15
    const groundY = a.groundY ?? 0
    // beat bounce: a small hop up on the downbeat (never dips feet under floor)
    a.scene.position.y = groundY + bounce * 0.03 * blend
    a.scene.rotation.y = (sway * 0.045 + wobble(t, 0.35) * 0.012) * blend

    const danceBone = (k, driver, px = 0, py = 0, pz = 0) => {
      const b = a.getBone(k)
      if (!b) return
      setBone(b, addB(restOf(b), bundle(driver * blend, px, py, pz)))
    }
    // hips lead the groove: side-to-side weight + twist — the butt moves, and
    // the torso counters above it so it reads as dance, not a pinned pelvis
    // hip wiggle: the pelvis translates side-to-side on the half-beat and
    // cocks into it — the thigh counter below keeps the feet on their spot
    const wig = Math.sin(B / 2 + 0.4)
    const hipsB = a.getBone('hips')
    const sc = a.scene.scale?.x || 1
    let hipWig = 0
    if (hipsB) {
      if (!hipsB.userData.restPos) hipsB.userData.restPos = hipsB.position.clone()
      const rp = hipsB.userData.restPos
      hipWig = wig * 0.05 * blend
      hipsB.position.x = rp.x + hipWig / sc
      hipsB.position.z = rp.z // vertical comes from the scene hop
    }
    danceBone('hips', wig, 0.025, 0.09, 0.03)
    // trimmed amplitudes: groove without pushing hands/torso into each other
    const dTorso = hit * 0.6 + sway * 0.4
    danceBone('spine', dTorso - bounce * 0.2, 0.3, 0.35)
    danceBone('chest', dTorso - half * 0.3, 0.28, -0.28)
    danceBone('neck', dTorso * 0.6 + half * 0.4, 0.3, 0.25)
    danceBone('head', dTorso * 0.7 + wobble(t, 0.4) * 0.1, 0.35, 0.3)

    // legs: step in place — thighs alternate a forward lift on the beat
    // (thigh z+ = forward), the lifted leg's knee bends deep and the ankle
    // follows through; the standing leg counter-swings (thigh y) to cancel
    // the pelvis wiggle so the planted foot keeps its spot
    const stepL = Math.max(0, Math.sin(B))
    const stepR = Math.max(0, Math.sin(B + Math.PI))
    // net foot push from the pelvis (translation +0.05, lean −0.079) is
    // −0.029·wig; thigh y at −0.84 m/rad cancels it with −0.034·wig
    const wigCounter = wig * -0.034
    danceBone('leftThigh', 1, 0, wigCounter + stepR * 0.02, stepL * 0.16 + bounce * 0.04)
    danceBone('rightThigh', 1, 0, wigCounter - stepL * 0.02, stepR * 0.16 + bounce * 0.035)
    const kneeL = 0.08 + bounce * 0.15 + stepL * 0.35
    const kneeR = 0.08 + bounce * 0.15 + stepR * 0.35
    danceBone('leftCalf', kneeL, 0, 0, -1)
    danceBone('rightCalf', kneeR, 0, 0, -1)
    danceBone('leftFoot', kneeL, 0, 0, 0.45)
    danceBone('rightFoot', kneeR, 0, 0, 0.45)

    const lArm = beat * 0.5 + hit * 0.35 + Math.sin(B + 0.4) * 0.2
    const rArm = -beat * 0.5 - hit * 0.3 + Math.sin(B + Math.PI + 0.2) * 0.2
    // measured rig axes: upper/lower z− = forward lift/bend, y− = outward.
    // Outward bias + forward lift keep hands in front of the body, never
    // crossing into the torso or skirt.
    const danceLimb = (upperK, lowerK, handK, drive) => {
      const wrist = Math.sin(B + drive * 0.5) * 0.06
      danceBone(upperK, 1,
        0,
        drive * 0.2 - 0.16,                       // swing, biased outward (y−)
        -(0.15 + Math.max(0, drive) * 0.3))       // elbows lift forward (z−)
      danceBone(lowerK, 1,
        0,
        -drive * 0.12,
        -(0.5 + Math.max(0, drive) * 0.4))        // real elbow bend (z−)
      danceBone(handK, 1, 0, wrist, wrist * 0.5)
    }
    danceLimb('leftUpperArm', 'leftLowerArm', 'leftHand', lArm)
    danceLimb('rightUpperArm', 'rightLowerArm', 'rightHand', rArm)
  }
}
