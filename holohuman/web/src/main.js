import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm'
import { loadMina } from './mina.js'
import { LipSync } from './lipsync.js'
import { Pipeline } from './pipeline.js'
import { Behavior } from './behavior.js'

// ---------------------------------------------------------------- scene
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.setSize(innerWidth, innerHeight)
renderer.outputColorSpace = THREE.SRGBColorSpace
document.getElementById('app').appendChild(renderer.domElement)

const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.1, 50)
scene.add(new THREE.AmbientLight(0xffffff, 0.9))
const key = new THREE.DirectionalLight(0xffffff, 1.6)
key.position.set(1, 2, 2)
scene.add(key)
const rim = new THREE.DirectionalLight(0x88aaff, 0.8)
rim.position.set(-1, 1.5, -2)
scene.add(rim)

const ground = new THREE.Mesh(
  new THREE.CircleGeometry(1.4, 48),
  new THREE.MeshStandardMaterial({ color: 0x14141c, roughness: 0.95, metalness: 0 }),
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

function placeCamera(angleDeg, up) {
  const a = (angleDeg * Math.PI) / 180
  const aimY = frameHeight
  camera.position.set(Math.sin(a) * camDist, aimY + 0.06, Math.cos(a) * camDist)
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
    placeCamera(0, UP)
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
new Pipeline(lipsync) // wires up chat UI, TTS playback, mic → ASR

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
// public API — full manual control from the console or embedding page:
//   holo.emotion('laugh')            sustained emotion (or (name, 0..1, seconds) to pulse)
//   holo.dance(true|false)
//   holo.pose('leftUpperArm', {x,y,z})   absolute joint angles in radians
//   holo.bones()                     list controllable joints
window.holo = {
  emotion: (n, i = 1, secs = 0) => behavior.setEmotion(n, i, secs),
  dance: on => { behavior.setDance(on ?? !behavior.dancing) },
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
  bones: () => ['head', 'neck', 'chest', 'spine', 'leftUpperArm', 'rightUpperArm',
    'leftLowerArm', 'rightLowerArm', 'leftHand', 'rightHand', 'leftThigh', 'rightThigh']
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
