// KPOP_Mina from LKZMuZiLi/human — FBX + PNG textures, loaded without Unity.
import * as THREE from 'three'
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js'

const DIR = '/models/mina/'
const tex = {}
function T(file, srgb = true) {
  if (!tex[file]) {
    tex[file] = new THREE.TextureLoader().load(DIR + file)
    if (srgb) tex[file].colorSpace = THREE.SRGBColorSpace
    tex[file].flipY = true
  }
  return tex[file]
}

// tears: opacity animated by the behavior engine when the emotion is "cry"
const tearsMat = new THREE.MeshPhysicalMaterial({
  color: 0xcfe4ff, transparent: true, opacity: 0, roughness: 0.05,
  metalness: 0, depthWrite: false })

// material-name keyword -> texture setup (mirrors the Unity .mat assignments)
function materialFor(name, old) {
  const n = name.toUpperCase()
  const mk = (opts) => new THREE.MeshStandardMaterial({
    name, roughness: 0.55, metalness: 0, ...opts })
  // hair texture RGB is white — alpha holds the strand mask, color comes from tint
  if (n.includes('HAIR')) return mk({ map: T('T_HAIR_WAVY_alpha_channel.png'),
    color: 0x3a302d, transparent: true, opacity: 0.88, alphaTest: 0.22,
    depthWrite: false, side: THREE.DoubleSide, roughness: 0.92 })
  if (n.includes('LASH')) return mk({ map: T('T_MINA_LASHES_basecolor.png'),
    transparent: true, alphaTest: 0.3, side: THREE.DoubleSide })
  if (n.includes('EYE')) return mk({ map: T('T_MINA_EYES_BASECOLOR_RED.png'),
    emissiveMap: T('T_MINA_EYES_emissive.png'), emissive: 0xffffff,
    emissiveIntensity: 0.25, roughness: 0.15 })
  if (n.includes('TEETH') || n.includes('TOOTH'))
    return mk({ map: T('T_MINA_Teeth_BASECOLOR.png'), roughness: 0.3 })
  if (n.includes('CASUAL')) return mk({ map: T('T_MINA_CASUAL_BaseColor_White.png'), roughness: 0.8 })
  if (n.includes('HEAD') || n.includes('FACE'))
    return mk({ map: T('T_MINA_HEAD_BaseColor.png'), roughness: 0.45 })
  if (n.includes('BODY')) return mk({ map: T('T_MINA_BODY_BaseColor_Censored.png'), roughness: 0.45 })
  if (n.includes('TEAR')) return tearsMat // invisible until she cries
  if (n.includes('CENSOR')) return null // hidden
  return old // unknown: keep whatever FBX provided
}

export async function loadMina() {
  const fbx = await new FBXLoader().loadAsync(DIR + 'SK_MINA_CASUAL_01_with_bones_in_skirt.fbx')

  const morphMeshes = []
  const seen = new Set()
  fbx.traverse(o => {
    if (!o.isMesh) return
    // the FBX contains stacked LOD copies with identical names — keep only LOD0
    if (seen.has(o.name)) { o.visible = false; return }
    seen.add(o.name)
    o.frustumCulled = false
    const mats = Array.isArray(o.material) ? o.material : [o.material]
    const mapped = mats.map(m => {
      const nm = materialFor(m?.name || o.name, m)
      return nm === null ? new THREE.MeshBasicMaterial({ visible: false }) : nm
    })
    o.material = Array.isArray(o.material) ? mapped : mapped[0]
    if (o.morphTargetDictionary) morphMeshes.push(o)
    console.log('[mina] mesh', o.name,
      'mats:', mats.map(m => m?.name).join(','),
      'morphs:', o.morphTargetDictionary ? Object.keys(o.morphTargetDictionary).join(',') : '-')
  })

  // find bones by name keyword
  const bones = {}
  const hairBones = []
  fbx.traverse(o => {
    if (!o.isBone) return
    const n = o.name.toLowerCase()
    if (!bones.head && /head/.test(n)) bones.head = o
    if (!bones.chest && /(chest|spine2|spine_02)/.test(n)) bones.chest = o
    if (!bones.spine && /(spine_?01|^spine$|hips|pelvis)/.test(n)) bones.spine = o
    if (!bones.leftUpperArm && /^upperarm_l$/.test(n)) bones.leftUpperArm = o
    if (!bones.rightUpperArm && /^upperarm_r$/.test(n)) bones.rightUpperArm = o
    if (!bones.leftLowerArm && /^lowerarm_l$/.test(n)) bones.leftLowerArm = o
    if (!bones.rightLowerArm && /^lowerarm_r$/.test(n)) bones.rightLowerArm = o
    if (!bones.neck && /^neck/.test(n)) bones.neck = o
    if (!bones.leftHand && /^hand_l$/.test(n)) bones.leftHand = o
    if (!bones.rightHand && /^hand_r$/.test(n)) bones.rightHand = o
    if (!bones.leftThigh && /^thigh_l$/.test(n)) bones.leftThigh = o
    if (!bones.rightThigh && /^thigh_r$/.test(n)) bones.rightThigh = o
    if (/^hair_(front|back)_\d+_(l|r|mid)$/.test(n)) hairBones.push(o)
  })
  // normalize size from the skeleton (skinned-mesh bboxes ignore bone scale):
  // head bone sits at ~92% of body height
  fbx.updateMatrixWorld(true)
  const headY = bones.head
    ? bones.head.getWorldPosition(new THREE.Vector3()).y
    : new THREE.Box3().setFromObject(fbx).max.y
  const s = (1.6 * 0.92) / headY
  fbx.scale.setScalar(s)
  console.log('[mina] headY raw', headY, 'scale', s)

  // Rest pose: dropped arms with enough side clearance to avoid clipping the
  // torso or skirt, plus small asymmetry so she does not read as rigid.
  // arms: clear > at elbow; upper hangs out — never a locked straight rod
  if (bones.leftUpperArm) {
    bones.leftUpperArm.rotation.y += 0.68
    bones.leftUpperArm.rotation.z -= 0.18
  }
  if (bones.rightUpperArm) {
    bones.rightUpperArm.rotation.y += 0.68
    bones.rightUpperArm.rotation.z += 0.18
  }
  if (bones.leftLowerArm) {
    bones.leftLowerArm.rotation.x += 0.58
    bones.leftLowerArm.rotation.z += 0.16
  }
  if (bones.rightLowerArm) {
    bones.rightLowerArm.rotation.x += 0.58
    bones.rightLowerArm.rotation.z -= 0.16
  }
  if (bones.leftHand) {
    bones.leftHand.rotation.x += 0.03
    bones.leftHand.rotation.z += 0.04
  }
  if (bones.rightHand) {
    bones.rightHand.rotation.x += 0.03
    bones.rightHand.rotation.z -= 0.04
  }

  // plant feet on y=0 — mesh + bone lowest point (bones alone can miss shoe/skirt hem)
  fbx.updateMatrixWorld(true)
  const wp = new THREE.Vector3()
  let footY = Infinity
  fbx.traverse(o => {
    if (o.isBone && /foot|toe|ankle|ball|heel/i.test(o.name)) {
      const y = o.getWorldPosition(wp).y
      if (y < footY) footY = y
    }
    if (o.isMesh && o.visible && o.geometry) {
      o.geometry.computeBoundingBox()
      if (o.geometry.boundingBox) {
        const b = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld)
        if (b.min.y < footY) footY = b.min.y
      }
    }
  })
  if (!Number.isFinite(footY)) {
    footY = new THREE.Box3().setFromObject(fbx).min.y
  }
  const groundY = -footY
  fbx.position.y = groundY
  fbx.updateMatrixWorld(true)

  const bodyBox = new THREE.Box3().setFromObject(fbx)
  const bodyHeight = bodyBox.max.y - bodyBox.min.y
  const frameHeight = bodyBox.min.y + bodyHeight * 0.54

  for (const b of Object.values(bones)) {
    if (b) b.userData.rest = b.rotation.clone()
  }

  const hairState = hairBones
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((bone, i) => {
      const n = bone.name.toLowerCase()
      const depth = Number(n.match(/_(\d+)_/)?.[1] || 1)
      const side = n.endsWith('_l') ? 1 : n.endsWith('_r') ? -1 : 0
      const front = n.includes('_front_') ? 1 : -1
      bone.userData.hairRest = bone.rotation.clone()
      return {
        bone, depth, side, front, phase: i * 0.73,
        x: 0, z: 0, vx: 0, vz: 0,
      }
    })
  const prevHeadRot = bones.head ? bones.head.rotation.clone() : null
  let prevSceneY = fbx.rotation.y

  console.log('[mina] bones found:', Object.keys(bones).join(','),
    '| hair bones:', hairBones.map(b => b.name).join(','),
    '| all bones:', (() => { const b = []; fbx.traverse(o => o.isBone && b.push(o.name)); return b.slice(0, 60).join(',') })())

  // morph lookup across meshes by regex
  function morphSetter(re) {
    const targets = []
    for (const m of morphMeshes)
      for (const [name, idx] of Object.entries(m.morphTargetDictionary))
        if (re.test(name)) targets.push({ m, idx })
    return v => targets.forEach(t => { t.m.morphTargetInfluences[t.idx] = v })
  }
  // named channels over the ARKit-52 blendshape set
  const jaw = morphSetter(/jawOpen/i)
  const funnel = morphSetter(/mouthFunnel|mouthPucker/i)
  const stretch = morphSetter(/mouthStretch(Left|Right)/i)
  const smileM = morphSetter(/mouthSmile(Left|Right)/i)
  const cheek = morphSetter(/cheekSquint(Left|Right)/i)
  const lipPress = morphSetter(/mouthPress(Left|Right)|mouthClose/i)
  const lipUpper = morphSetter(/mouthUpperUp(Left|Right)/i)
  const lipLower = morphSetter(/mouthLowerDown(Left|Right)/i)
  const lipSideL = morphSetter(/mouthLeft/i)
  const lipSideR = morphSetter(/mouthRight/i)
  const lipRollU = morphSetter(/mouthRollUpper/i)
  const lipRollL = morphSetter(/mouthRollLower/i)
  const smileL = morphSetter(/mouthSmileLeft/i)
  const smileR = morphSetter(/mouthSmileRight/i)
  const dimple = morphSetter(/mouthDimple(Left|Right)/i)
  const nose = morphSetter(/noseSneer(Left|Right)/i)
  const browUp = morphSetter(/browOuterUp/i)
  const browSad = morphSetter(/browInnerUp/i)   // inner brow: raise = worried/sad
  const browDown = morphSetter(/browDown(Left|Right)/i)
  const frown = morphSetter(/mouthFrown(Left|Right)/i)
  const squint = morphSetter(/eyeSquint(Left|Right)/i)
  const eyeWide = morphSetter(/eyeWide(Left|Right)/i)
  const blink = morphSetter(/eyeBlink/i)
  const lookL = morphSetter(/eyeLookOutLeft|eyeLookInRight/i)
  const lookR = morphSetter(/eyeLookOutRight|eyeLookInLeft/i)
  const lookU = morphSetter(/eyeLookUp/i)
  const lookD = morphSetter(/eyeLookDown/i)

  function updateHair(dt, t) {
    if (!hairState.length || !bones.head) return
    const safeDt = Math.max(1 / 120, Math.min(dt, 1 / 20))
    const head = bones.head.rotation
    const headDx = prevHeadRot ? head.x - prevHeadRot.x : 0
    const headDz = prevHeadRot ? head.z - prevHeadRot.z : 0
    const sceneDy = fbx.rotation.y - prevSceneY
    if (prevHeadRot) prevHeadRot.copy(head)
    prevSceneY = fbx.rotation.y

    for (const h of hairState) {
      const rest = h.bone.userData.hairRest
      const tip = Math.min(1, h.depth / 4)
      const spring = 28 - tip * 8
      const damping = 8 + tip * 2
      const idle = Math.sin(t * 1.15 + h.phase) * 0.003 * tip
      const targetX = (-headDx * 3.4 + idle * h.front) * tip
      const targetZ = (-headDz * 2.8 - sceneDy * 3.2 + idle * h.side) * tip
      h.vx += (targetX - h.x) * spring * safeDt
      h.vz += (targetZ - h.z) * spring * safeDt
      h.vx *= Math.exp(-damping * safeDt)
      h.vz *= Math.exp(-damping * safeDt)
      h.x += h.vx
      h.z += h.vz
      h.bone.rotation.x = rest.x + Math.max(-0.06, Math.min(0.06, h.x))
      h.bone.rotation.z = rest.z + Math.max(-0.055, Math.min(0.055, h.z))
    }
  }

  return {
    scene: fbx,
    isMina: true,
    channels: {
      jaw, funnel, stretch, blink, browUp, browSad, browDown, frown, squint, eyeWide,
      lipPress, lipUpper, lipLower, lipSideL, lipSideR, lipRollU, lipRollL,
      smileL, smileR, dimple, nose, cheek,
      smile: v => { smileM(v); cheek(v * 0.4) },
      tears: v => { tearsMat.opacity = v * 0.85 },
      lookX: v => { lookL(Math.max(0, v)); lookR(Math.max(0, -v)) },
      lookY: v => { lookU(Math.max(0, v)); lookD(Math.max(0, -v)) },
    },
    getBone: k => bones[k] || null,
    groundY,
    bodyHeight,
    frameHeight,
    lookHeight: 1.35,
    update: (dt) => updateHair(dt, performance.now() * 0.001),
  }
}
