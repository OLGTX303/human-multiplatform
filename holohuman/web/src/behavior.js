// Procedural human behavior: visemes, emotion, gaze, blinking, breathing,
// weight shifts and talking gestures. Drives the avatar's named channels
// (ARKit blendshapes on Mina, VRM expressions on VRM models) every frame.

const clamp01 = v => Math.max(0, Math.min(1, v))
const outward = v => Math.max(0, v)
// layered sines ≈ organic noise (cheap perlin substitute)
const wobble = (t, f) => (Math.sin(t * f) + Math.sin(t * f * 2.7 + 1.3) * 0.5 + Math.sin(t * f * 0.31 + 4.1) * 0.8) / 2.3
// one driver → correlated x/y/z so joints rotate as a bundle, not independent axes
const bundle = (driver, px, py, pz) => ({ x: driver * px, y: driver * py, z: driver * pz })
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
    // emotion envelopes (decay toward baseline each frame)
    this.smile = 0.12; this.browUp = 0; this.smileTarget = 0.12; this.browTarget = 0
    this.tiltPulse = 0
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

  setDance(on) {
    if (this.dancing && !on) this.danceRestore = true
    this.dancing = on
    if (on) this.dancePhase = performance.now() * 0.001 * 2 * Math.PI * (112 / 60)
  }

  // called by the pipeline for every sentence sent to TTS — cheap "emotion"
  cueSentence(s) {
    if (!this.emoLocked || this.emoName === 'neutral') {
      if (/haha|lol|😂|🤣|hilarious|so funny/i.test(s)) this.setEmotion('laugh', 0.9, 3)
      else if (/😢|😭|i'?m sorry to|so sad|unfortunately|terrible news/i.test(s)) this.setEmotion('sad', 0.8, 3.5)
      else if (/😠|outrageous|unacceptable|angry/i.test(s)) this.setEmotion('angry', 0.7, 3)
      else if (/wow|amazing|incredible|😮|really\?/i.test(s)) this.setEmotion('surprised', 0.8, 2.5)
    }
    if (/[!😀😄🎉]|great|awesome|glad|nice|love/i.test(s)) { this.smileTarget = 0.65 }
    else if (/\?$/.test(s.trim())) { this.browTarget = 0.7; this.tiltPulse = 1 }
    else { this.browTarget = 0.35 } // mild brow raise at each new sentence
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
    ch.funnel(this.funnel * 0.72)
    ch.stretch(this.stretch * 0.62)

    // ---------- talk face — asymmetric corners, lip roll, independent left/right
    const faceK = 1 - Math.exp(-dt * 11)
    const lipAsym = wobble(t, 0.72) * 0.06
    const pressT = talking ? clamp01(this.talkHigh * 2 + lipLevel * 0.35) * 0.22 : 0
    const upperT = talking ? clamp01(this.jaw * 0.65 + this.talkLow * 0.45 + lipLevel * 0.15) * 0.28 : 0
    const lowerT = talking ? clamp01(this.jaw * 0.55 + this.funnel * 0.4 + lipLevel * 0.2) * 0.3 : 0
    const cheekT = talking ? clamp01(this.jaw * 0.4 + this.smile * 0.25) * 0.22 : 0
    const dimpleT = talking ? clamp01(this.smile * 0.4 + talk * 0.1) * 0.24 : 0
    const squintT = talking ? talk * 0.1 : 0
    const sideLT = talking ? clamp01(this.talkLow * 1.6 + lipAsym) * 0.14 : 0
    const sideRT = talking ? clamp01(this.talkHigh * 1.6 - lipAsym) * 0.14 : 0
    const rollUT = talking ? clamp01(this.funnel * 0.55 + this.jaw * 0.2) * 0.18 : 0
    const rollLT = talking ? clamp01(this.jaw * 0.5 + this.stretch * 0.25) * 0.2 : 0
    const smileLT = talking ? clamp01(this.smile * 0.5 + this.talkLow * 0.35) * 0.22 : 0
    const smileRT = talking ? clamp01(this.smile * 0.5 + this.talkHigh * 0.35) * 0.22 : 0
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
        bundle(wobble(t, 0.2), 0.02, 0.04, 0.06),
        bundle(this.tiltPulse, 0.05, 0.02, 0.55),
        { x: this.emo.headX, y: 0, z: 0 },
      )
      setBone(head, addB(r, headMot))
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
      for (const k of ['head', 'neck', 'chest', 'spine', 'leftUpperArm', 'rightUpperArm',
        'leftLowerArm', 'rightLowerArm', 'leftHand', 'rightHand', 'leftThigh', 'rightThigh']) {
        const b = a.getBone(k)
        if (b?.userData.rest) b.rotation.copy(b.userData.rest)
        delete b?.userData.smooth
      }
    }

    // ---------- posture drift: pick a new stance every 5–14s, settle into it
    this.postureT -= dt
    if (this.postureT <= 0) {
      this.postureT = 5 + Math.random() * 9
      this.poseT.lean = (Math.random() * 2 - 1) * 0.055   // side lean (weight shift)
      this.poseT.twist = (Math.random() * 2 - 1) * 0.07   // torso turn
      this.poseT.drop = Math.random() * 0.02              // slight slouch
    }
    const pk = 1 - Math.exp(-dt * 1.2)                    // settle over ~1s
    for (const kk of ['lean', 'twist', 'drop'])
      this.pose[kk] += (this.poseT[kk] - this.pose[kk]) * pk

    // ---------- body: breathing (~15/min), weight shifts, talk gestures
    const breath = Math.sin(t * 1.6)
    const breath2 = Math.sin(t * 1.6 + 0.4)
    const bodySway = wobble(t, 0.08)
    const hipSettle = wobble(t + 0.7, 0.12)
    a.scene.position.y = groundY
    a.scene.rotation.y = bodySway * 0.012 + wobble(t, 0.05) * 0.004
    // torso chain: one spine driver propagates hip → chest → neck as bundled bones
    const torsoDrive = breath * 0.55 + bodySway * 0.35 + (talking ? talk * 0.2 : 0)
    const leanDrive = this.pose.lean + bodySway * 0.25
    const twistDrive = this.pose.twist + (talking ? talkSway * 0.4 : 0)
    const spine = a.getBone('spine')
    if (spine) {
      const r = restOf(spine)
      setBone(spine, addB(r,
        bundle(torsoDrive, 0.25, -twistDrive * 3.2, -leanDrive * 3.5),
        bundle(hipSettle, 0.35, 0.4, -0.3),
      ))
    }
    const chest = a.getBone('chest')
    if (chest) {
      const r = restOf(chest)
      setBone(chest, addB(r,
        bundle(torsoDrive, 0.55, twistDrive * 2.8, leanDrive * 3.8),
        bundle(this.pose.drop, 0.8, 0.1, 0.15),
        bundle(talkSway, 0.3, 0.45, 0.2),
      ))
    }
    const neck = a.getBone('neck')
    if (neck) {
      const r = restOf(neck)
      setBone(neck, addB(r,
        bundle(torsoDrive * 0.55 + breath2 * 0.15, 0.35, 0.25, leanDrive * 1.2),
        bundle(talkSway, 0.4, 0.2, 0.15),
        bundle(wobble(t, 0.18), 0.03, 0.05, 0.04),
      ))
    }
    for (const [key, ph, side] of [['leftThigh', 0.3, 1], ['rightThigh', 1.1, -1]]) {
      const thigh = a.getBone(key)
      if (!thigh) continue
      const r = restOf(thigh)
      const legDrive = breath * 0.4 + wobble(t + ph, 0.12)
      setBone(thigh, addB(r, bundle(legDrive, 0.35, 0.08 * side, leanDrive * 0.55 * side)))
    }
    // arms: shoulder swings on Y only; elbow flexes on X with lag — articulated >, not ghost rod
    const armLife = [
      { upper: 'leftUpperArm', lower: 'leftLowerArm', hand: 'leftHand', ph: 0, side: 1 },
      { upper: 'rightUpperArm', lower: 'rightLowerArm', hand: 'rightHand', ph: 1.7, side: -1 },
    ]
    const shoulderK = 1 - Math.exp(-dt * 8)
    const elbowK = 1 - Math.exp(-dt * 5.5)
    const wristK = 1 - Math.exp(-dt * 10)
    for (const arm of armLife) {
      const talkAmt = talking ? Math.max(0.35, talk) : 0
      const shoulderY = wobble(t + arm.ph, 0.13) * 0.018 + breath * 0.005
        + (talking ? wobble(t + arm.ph, 0.36) * talkAmt * 0.011 : 0)
      const elbowX = 0.05 + wobble(t + arm.ph + 0.75, 0.16) * 0.014
        + Math.abs(shoulderY) * 2.2 + (talking ? talkAmt * 0.007 : 0)
      const wristOut = wobble(t + arm.ph + 1.45, 0.21) * 0.007

      const upper = a.getBone(arm.upper)
      if (upper) {
        const r = restOf(upper)
        if (!upper.userData.smooth) upper.userData.smooth = { x: r.x, y: r.y, z: r.z }
        const s = upper.userData.smooth
        s.x = r.x
        s.y += ((r.y + shoulderY) - s.y) * shoulderK
        s.z = r.z
        setBone(upper, s)
      }
      const lower = a.getBone(arm.lower)
      if (lower) {
        const r = restOf(lower)
        const goalX = Math.max(r.x, r.x + elbowX)
        const goalY = r.y - shoulderY * 0.38
        if (!lower.userData.smooth) lower.userData.smooth = { x: r.x, y: r.y, z: r.z }
        const s = lower.userData.smooth
        s.x += (goalX - s.x) * elbowK
        s.y += (goalY - s.y) * elbowK
        s.z = r.z
        setBone(lower, s)
      }
      const hand = a.getBone(arm.hand)
      if (hand) {
        const r = restOf(hand)
        if (!hand.userData.smooth) hand.userData.smooth = { x: r.x, y: r.y, z: r.z }
        const s = hand.userData.smooth
        s.x = r.x
        s.y += ((r.y - shoulderY * 0.18) - s.y) * wristK
        s.z += ((r.z + wristOut * arm.side) - s.z) * wristK
        setBone(hand, s)
      }
    }
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
    a.scene.position.y = groundY
    a.scene.rotation.y = (sway * 0.045 + wobble(t, 0.35) * 0.012) * blend

    const danceBone = (k, driver, px, py, pz) => {
      const b = a.getBone(k)
      if (!b) return
      setBone(b, addB(restOf(b), bundle(driver * blend, px, py, pz)))
    }
    const dTorso = hit * 0.6 + sway * 0.4
    danceBone('spine', dTorso - bounce * 0.2, 0.55, 0.45)
    danceBone('chest', dTorso - half * 0.3, 0.5, -0.35)
    danceBone('neck', dTorso * 0.6 + half * 0.4, 0.35, 0.3)
    danceBone('head', dTorso * 0.7 + wobble(t, 0.4) * 0.1, 0.4, 0.35)

    danceBone('leftThigh', bounce * 0.55 + hit * 0.35, 0.45, 0.35)
    danceBone('rightThigh', -(bounce * 0.5 + hit * 0.28), 0.4, -0.3)

    const lArm = beat * 0.5 + hit * 0.35 + Math.sin(B + 0.4) * 0.2
    const rArm = -beat * 0.5 - hit * 0.3 + Math.sin(B + Math.PI + 0.2) * 0.2
    const danceLimb = (upperK, lowerK, handK, drive, side) => {
      const elbowFlex = 0.14 + drive * 0.22 + Math.sin(B + side) * 0.08
      const wrist = Math.sin(B + side * 0.5) * 0.05
      danceBone(upperK, drive, 0, 0.36, 0)
      danceBone(lowerK, elbowFlex, 0.52, -drive * 0.2, 0)
      danceBone(handK, 0, 0, wrist * 0.5, 0.1 * side)
    }
    danceLimb('leftUpperArm', 'leftLowerArm', 'leftHand', lArm, 1)
    danceLimb('rightUpperArm', 'rightLowerArm', 'rightHand', rArm, -1)
  }
}
