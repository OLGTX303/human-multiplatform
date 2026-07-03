import * as THREE from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm'
import { loadMina, tuneMaterials } from './mina.js'
import { LipSync } from './lipsync.js'
import { Pipeline } from './pipeline.js'
import { Behavior } from './behavior.js'

// ---------------------------------------------------------------- scene
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.setSize(innerWidth, innerHeight)
renderer.outputColorSpace = THREE.SRGBColorSpace
// cinematic output: ACES filmic roll-off, soft shadows, moody exposure
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 0.92
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
document.getElementById('app').appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x08080e)
scene.fog = new THREE.Fog(0x08080e, 6, 14)
const camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.1, 50)
// studio IBL — enough contrast for believable specular on skin + latex
const pmrem = new THREE.PMREMGenerator(renderer)
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.065).texture
pmrem.dispose()
scene.add(new THREE.HemisphereLight(0xffe8d0, 0x1a2038, 0.22))
scene.add(new THREE.AmbientLight(0x2a3048, 0.08))
// warm key — camera-left, slightly above eye line (classic interview look)
const key = new THREE.DirectionalLight(0xffe2c8, 1.35)
key.position.set(2.2, 2.4, 1.6)
key.castShadow = true
key.shadow.mapSize.set(2048, 2048)
key.shadow.camera.near = 0.5
key.shadow.camera.far = 8
key.shadow.camera.left = key.shadow.camera.bottom = -1.5
key.shadow.camera.right = key.shadow.camera.top = 1.5
key.shadow.bias = -0.0015
key.shadow.radius = 2
scene.add(key)
// cool fill — opposite side, lifts shadow detail without killing mood
const fill = new THREE.DirectionalLight(0x8aa8d8, 0.32)
fill.position.set(-2.4, 1.2, 2.2)
scene.add(fill)
// rim/back — separates silhouette from the dark stage
const rim = new THREE.DirectionalLight(0xa8c8ff, 0.55)
rim.position.set(-1.2, 2.2, -2.8)
scene.add(rim)

const ground = new THREE.Mesh(
  new THREE.CircleGeometry(1.4, 48),
  new THREE.MeshPhysicalMaterial({
    color: 0x09090f, roughness: 0.82, metalness: 0.12,
    clearcoat: 0.35, clearcoatRoughness: 0.6, envMapIntensity: 0.4,
  }),
)
ground.rotation.x = -Math.PI / 2
ground.receiveShadow = true
scene.add(ground)

// ---------------------------------------------------------------- avatar
// Unified adapter: { scene, update(dt), setMouth(v), setBlink(v), getBone(k), lookHeight }
let avatar = null
let lookHeight = 1.35
let frameHeight = 0.88
let camDist = 3.4

function fitCamera() {
  const bh = avatar?.bodyHeight ?? 1.62
  frameHeight = avatar?.frameHeight ?? bh * 0.54
  const vFov = camera.fov * Math.PI / 180
  camDist = (bh * 1.18) / (2 * Math.tan(vFov / 2))
}

function setAvatar(a) {
  if (avatar) scene.remove(avatar.scene)
  avatar = a
  window.__avatar = a
  behavior.setAvatar(a)
  lookHeight = a.lookHeight ?? 1.35
  fitCamera()
  scene.add(a.scene)
  tuneMaterials(a.scene, renderer)
  document.getElementById('hint').classList.add('hidden')
}

async function loadVRM(url) {
  const loader = new GLTFLoader()
  loader.register(p => new VRMLoaderPlugin(p))
  const gltf = await loader.loadAsync(url)
  const vrm = gltf.userData.vrm
  VRMUtils.combineSkeletons(gltf.scene)
  VRMUtils.rotateVRM0(vrm)
  vrm.humanoid?.getNormalizedBoneNode('leftUpperArm')?.rotation.set(0, 0, -1.15)
  vrm.humanoid?.getNormalizedBoneNode('rightUpperArm')?.rotation.set(0, 0, 1.15)
  const em = vrm.expressionManager
  const set = (name, v) => { try { em?.setValue(name, v) } catch {} }
  setAvatar({
    scene: vrm.scene,
    update: dt => vrm.update(dt),
    channels: {
      jaw: v => set('aa', v),
      funnel: v => set('ou', v),
      stretch: v => set('ih', v),
      smile: v => set('happy', v),
      browUp: () => {},
      blink: v => set('blink', v),
      lookX: () => {}, lookY: () => {},
    },
    getBone: k => vrm.humanoid?.getNormalizedBoneNode(k) || null,
    lookHeight: 1.35,
  })
}

// default character: KPOP_Mina (FBX). Fallback: any avatar.vrm. Drag-drop .vrm/.fbx to swap.
loadMina().then(setAvatar).catch(e => {
  console.warn('mina load failed, trying avatar.vrm', e)
  loadVRM('/models/avatar.vrm').catch(() =>
    document.getElementById('hint').classList.remove('hidden'))
})

addEventListener('dragover', e => e.preventDefault())
addEventListener('drop', e => {
  e.preventDefault()
  const f = e.dataTransfer.files[0]
  if (f && f.name.endsWith('.vrm')) loadVRM(URL.createObjectURL(f))
})

// ---------------------------------------------------------------- display modes
// Pyramid mode = Pepper's Ghost: 4 views (front/back/left/right) in a plus
// layout on black; a transparent acrylic pyramid on the screen reflects each
// view on one face → floating character.
let mode = 'standard'
document.getElementById('mode').onchange = e => {
  mode = e.target.value
  document.body.classList.toggle('mirror', mode === 'mirror')
}

// camera view presets (视角切换) — cycled by the 📷 button, standard mode only
const VIEWS = [
  { zoom: 1,    aimUp: 0,    angle: 0 },  // full body
  { zoom: 0.42, aimUp: 0.42, angle: 0 },  // portrait: face + shoulders
  { zoom: 0.75, aimUp: 0.18, angle: 32 }, // three-quarter
  { zoom: 1.35, aimUp: 0,    angle: 0 },  // wide stage
]
let viewIndex = 0
const view = { zoom: 1, aimUp: 0, angle: 0 } // eased toward VIEWS[viewIndex]
function cycleView() { viewIndex = (viewIndex + 1) % VIEWS.length }

function placeCamera(angleDeg, up, v) {
  const zoom = v?.zoom ?? 1, aimUp = v?.aimUp ?? 0, extra = v?.angle ?? 0
  const a = ((angleDeg + extra) * Math.PI) / 180
  const aimY = frameHeight + aimUp
  const d = camDist * zoom
  camera.position.set(Math.sin(a) * d, aimY + 0.06, Math.cos(a) * d)
  camera.up.copy(up)
  camera.lookAt(0, aimY, 0)
}

const UP = new THREE.Vector3(0, 1, 0)
function render() {
  const w = renderer.domElement.width / devicePixelRatio
  const h = renderer.domElement.height / devicePixelRatio

  if (mode !== 'pyramid') {
    renderer.setScissorTest(false)
    renderer.setViewport(0, 0, w, h)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    // glide toward the selected view preset (≈ Unity CameraManager's slerp)
    const tgt = VIEWS[viewIndex]
    view.zoom += (tgt.zoom - view.zoom) * 0.08
    view.aimUp += (tgt.aimUp - view.aimUp) * 0.08
    view.angle += (tgt.angle - view.angle) * 0.08
    placeCamera(0, UP, view)
    renderer.setClearColor(0x000000, 1)
    renderer.render(scene, camera)
    return
  }

  // plus layout: 4 square views around screen center, each rolled so the
  // pyramid face shows the character upright from that side
  const s = Math.min(w, h) / 3
  const cx = w / 2, cy = h / 2
  const views = [
    { x: cx - s / 2, y: 0,          angle: 0,   up: new THREE.Vector3(0, 1, 0) },  // bottom: front
    { x: cx - s / 2, y: h - s,      angle: 180, up: new THREE.Vector3(0, -1, 0) }, // top: back
    { x: 0,          y: cy - s / 2, angle: 90,  up: new THREE.Vector3(-1, 0, 0) }, // left
    { x: w - s,      y: cy - s / 2, angle: 270, up: new THREE.Vector3(1, 0, 0) },  // right
  ]
  renderer.setClearColor(0x000000, 1)
  renderer.setScissorTest(true)
  renderer.setScissor(0, 0, w, h)
  renderer.setViewport(0, 0, w, h)
  renderer.clear()
  camera.aspect = 1
  camera.updateProjectionMatrix()
  for (const v of views) {
    renderer.setViewport(v.x, v.y, s, s)
    renderer.setScissor(v.x, v.y, s, s)
    placeCamera(v.angle, v.up)
    renderer.render(scene, camera)
  }
  renderer.setScissorTest(false)
}

// ---------------------------------------------------------------- pipeline
const lipsync = new LipSync()
const behavior = new Behavior(lipsync)
window.__behavior = behavior
const pipeline = new Pipeline(lipsync) // wires up chat UI, TTS playback, mic → ASR

// ---------------------------------------------------------------- presence
// she watches your cursor like you're in the room with her
addEventListener('pointermove', e => {
  behavior.lookToward((e.clientX / innerWidth) * 2 - 1, 1 - (e.clientY / innerHeight) * 2)
})
// tapping her makes her happy; first interaction also unlocks audio → greeting
document.getElementById('app').addEventListener('pointerdown', () => {
  behavior.setEmotion('happy', 0.9, 2)
  behavior.tiltPulse = 1
})
const greetOnce = () => pipeline.greet()
addEventListener('pointerdown', greetOnce, { once: true })
addEventListener('keydown', greetOnce, { once: true })

// ---------------------------------------------------------------- controls
document.getElementById('emotion').onchange = e => {
  const v = e.target.value
  if (v === 'auto') behavior.setEmotion('neutral', 1, 0.01) // unlock: cues take over
  else behavior.setEmotion(v)
}
const danceBtn = document.getElementById('dance')
danceBtn.onclick = () => {
  behavior.setDance(!behavior.dancing)
  danceBtn.style.background = behavior.dancing ? '#7a3a8a' : ''
}
// action (动作), role (角色), voice (语种), camera view (视角切换)
document.getElementById('action').onchange = e => {
  if (e.target.value) behavior.setAction(e.target.value, 5)
  e.target.value = '' // acts like a button group, snaps back to the label
}
document.getElementById('role').onchange = e => {
  pipeline.setRole(e.target.value)
  behavior.setEmotion('happy', 0.8, 2) // acknowledge the switch
}
document.getElementById('voice').onchange = e => { pipeline.voice = e.target.value || null }
document.getElementById('view').onclick = cycleView
// public API — full manual control from the console or embedding page:
//   holo.emotion('laugh')            sustained emotion (or (name, 0..1, seconds) to pulse)
//   holo.dance(true|false)
//   holo.pose('leftUpperArm', {x,y,z})   absolute joint angles in radians
//   holo.bones()                     list controllable joints
window.holo = {
  emotion: (n, i = 1, secs = 0) => behavior.setEmotion(n, i, secs),
  dance: on => { behavior.setDance(on ?? !behavior.dancing) },
  // complex poses: holo.action('heart' | 'squat' | 'wave', seconds)
  action: (name, secs = 4) => behavior.setAction(name, secs),
  // live hair tuning, e.g. holo.hair({ stiffness: 0.3, gravityMultiplier: 1 })
  // wind is a Vector3: holo.hair().wind.set(2, 0, 0) for a gust
  hair: (p) => { if (p) Object.assign(avatar?.hairParams ?? {}, p); return avatar?.hairParams },
  pose: (bone, { x, y, z } = {}) => {
    const b = avatar?.getBone(bone)
    if (!b) return `unknown bone: ${bone}`
    if (!b.userData.rest) b.userData.rest = b.rotation.clone()
    const r = b.userData.rest
    if (x !== undefined) r.x = x
    if (y !== undefined) r.y = y
    if (z !== undefined) r.z = z
    b.rotation.copy(r)
  },
  bones: () => ['head', 'neck', 'chest', 'spine', 'hips',
    'leftClavicle', 'rightClavicle', 'leftUpperArm', 'rightUpperArm',
    'leftLowerArm', 'rightLowerArm', 'leftHand', 'rightHand',
    'leftThigh', 'rightThigh', 'leftCalf', 'rightCalf', 'leftFoot', 'rightFoot']
    .filter(k => avatar?.getBone(k)),
}

const clock = new THREE.Clock()
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1)
  lipsync.tick()
  if (avatar) { behavior.update(dt, clock.elapsedTime); avatar.update(dt) }
  render()
})

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight)
  fitCamera()
})
