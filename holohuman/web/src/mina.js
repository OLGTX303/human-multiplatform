// KPOP_Mina — FBX + PNG textures, loaded without Unity.
import * as THREE from 'three'
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js'

const DIR = '/models/mina/'
const CASUAL_TEX = 'T_MINA_CASUAL_BaseColor_Film4096.png'
const tex = {}
function T(file, srgb = true, flipY = true) {
  if (!tex[file]) {
    tex[file] = new THREE.TextureLoader().load(DIR + file)
    if (srgb) tex[file].colorSpace = THREE.SRGBColorSpace
    tex[file].flipY = flipY
    tex[file].anisotropy = 8
    tex[file].minFilter = THREE.LinearMipmapLinearFilter
    tex[file].generateMipmaps = true
  }
  return tex[file]
}

// FBX UVs are bottom-origin; Three.js textures are top-origin — flip V once.
function syncUv(geometry) {
  const uv = geometry?.attributes?.uv
  if (!uv) return
  for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i))
  uv.needsUpdate = true
}

// tears: opacity animated by the behavior engine when the emotion is "cry"
const tearsMat = new THREE.MeshPhysicalMaterial({
  color: 0xcfe4ff, transparent: true, opacity: 0, roughness: 0.05,
  metalness: 0, depthWrite: false })

// material-name keyword -> texture setup (mirrors the Unity .mat assignments).
// MeshPhysicalMaterial everywhere: each surface gets real-world response —
// wet cornea, oily skin sheen, matte fabric, glossy enamel.
function materialFor(name, old) {
  const n = name.toUpperCase()
  const mk = (opts) => new THREE.MeshPhysicalMaterial({
    name, roughness: 0.55, metalness: 0, ior: 1.45,
    specularIntensity: 1, specularColor: new THREE.Color(0xffffff),
    envMapIntensity: 0.55, ...opts })
  // hair texture RGB is white — alpha holds the strand mask, color comes from tint
  if (n.includes('HAIR')) return mk({ map: T('T_HAIR_WAVY_alpha_channel.png'),
    color: 0x3a302d, transparent: true, opacity: 0.88, alphaTest: 0.22,
    depthWrite: false, side: THREE.DoubleSide, roughness: 0.68,
    envMapIntensity: 0.35, specularIntensity: 0.4 })
  if (n.includes('LASH')) return mk({ map: T('T_MINA_LASHES_basecolor.png'),
    transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, roughness: 0.9 })
  if (n.includes('EYE')) return mk({ map: T('T_MINA_EYES_BASECOLOR_RED.png'),
    emissiveMap: T('T_MINA_EYES_emissive.png'), emissive: 0xffffff,
    emissiveIntensity: 0.18, roughness: 0.02, ior: 1.38,
    clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 1.6 })
  if (n.includes('TEETH') || n.includes('TOOTH'))
    return mk({ map: T('T_MINA_Teeth_BASECOLOR.png'), roughness: 0.18,
      clearcoat: 0.6, clearcoatRoughness: 0.2 }) // wet enamel
  if (n.includes('CASUAL')) return mk({ map: T(CASUAL_TEX, true, false),
    roughness: 0.28, metalness: 0.02, ior: 1.52,
    clearcoat: 1, clearcoatRoughness: 0.1,
    sheen: 0.22, sheenRoughness: 0.35, sheenColor: 0xffe0d4,
    envMapIntensity: 1.05, reflectivity: 0.55,
    side: THREE.DoubleSide })
  if (n.includes('HEAD') || n.includes('FACE'))
    return mk({ map: T('T_MINA_HEAD_BaseColor.png'), roughness: 0.38, ior: 1.4,
      sheen: 0.18, sheenRoughness: 0.55, sheenColor: 0xffd9c8,
      clearcoat: 0.22, clearcoatRoughness: 0.42, envMapIntensity: 0.72 })
  if (n.includes('BODY')) return mk({ map: T('T_MINA_BODY_BaseColor_Censored.png'),
    roughness: 0.4, ior: 1.4, sheen: 0.18, sheenRoughness: 0.55, sheenColor: 0xffd9c8,
    clearcoat: 0.18, clearcoatRoughness: 0.45, envMapIntensity: 0.68 })
  if (n.includes('TEAR')) return tearsMat // invisible until she cries
  if (n.includes('CENSOR')) return null // hidden
  return old // unknown: keep whatever FBX provided
}

export function tuneMaterials(scene, renderer) {
  const aniso = renderer?.capabilities?.getMaxAnisotropy?.() ?? 8
  scene.traverse(o => {
    if (!o.isMesh) return
    const mats = Array.isArray(o.material) ? o.material : [o.material]
    for (const m of mats) {
      if (!m?.isMeshPhysicalMaterial) continue
      m.needsUpdate = true
      if (m.map) m.map.anisotropy = aniso
    }
  })
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
    // she blocks light like a solid object; hair is alpha-masked so its raw
    // silhouette would shadow as a slab — receive only
    o.castShadow = !/HAIR|TEAR|CENSOR/i.test(o.name)
    o.receiveShadow = true
    const mats = Array.isArray(o.material) ? o.material : [o.material]
    const mapped = mats.map(m => {
      const nm = materialFor(m?.name || o.name, m)
      return nm === null ? new THREE.MeshBasicMaterial({ visible: false }) : nm
    })
    o.material = Array.isArray(o.material) ? mapped : mapped[0]
    if (/CASUAL/i.test(mats.map(m => m?.name).join(' ') + o.name)) syncUv(o.geometry)
    if (o.morphTargetDictionary) morphMeshes.push(o)
    console.log('[mina] mesh', o.name,
      'mats:', mats.map(m => m?.name).join(','),
      'morphs:', o.morphTargetDictionary ? Object.keys(o.morphTargetDictionary).join(',') : '-')
  })

  // find bones by name keyword
  const bones = {}
  const hairBones = []
  const skirtLinks = []
  const fingerBones = { left: [], right: [] }
  fbx.traverse(o => {
    if (!o.isBone) return
    const n = o.name.toLowerCase()
    if (/^(thumb|index|middle|ring|pinky)_0[1-3]_(l|r)$/.test(n))
      fingerBones[n.endsWith('_l') ? 'left' : 'right'].push(o)
    if (/^skirt_(front|side|back)_\d+_(l|r)$/.test(n) && o.position.lengthSq() > 1e-6)
      skirtLinks.push(o)
    if (!bones.head && /head/.test(n)) bones.head = o
    if (!bones.hips && /(^hips$|pelvis)/.test(n)) bones.hips = o
    if (!bones.chest && /(chest|spine2|spine_02)/.test(n)) bones.chest = o
    if (!bones.spine && /(^spine_?0?1$|^spine$)/.test(n)) bones.spine = o
    if (!bones.leftClavicle && /^clavicle_l$/.test(n)) bones.leftClavicle = o
    if (!bones.rightClavicle && /^clavicle_r$/.test(n)) bones.rightClavicle = o
    if (!bones.leftUpperArm && /^upperarm_l$/.test(n)) bones.leftUpperArm = o
    if (!bones.rightUpperArm && /^upperarm_r$/.test(n)) bones.rightUpperArm = o
    if (!bones.leftLowerArm && /^lowerarm_l$/.test(n)) bones.leftLowerArm = o
    if (!bones.rightLowerArm && /^lowerarm_r$/.test(n)) bones.rightLowerArm = o
    if (!bones.neck && /^neck/.test(n)) bones.neck = o
    if (!bones.leftHand && /^hand_l$/.test(n)) bones.leftHand = o
    if (!bones.rightHand && /^hand_r$/.test(n)) bones.rightHand = o
    if (!bones.leftThigh && /^thigh_l$/.test(n)) bones.leftThigh = o
    if (!bones.rightThigh && /^thigh_r$/.test(n)) bones.rightThigh = o
    if (!bones.leftCalf && /^(calf_l|leg_l|shin_l)$/.test(n)) bones.leftCalf = o
    if (!bones.rightCalf && /^(calf_r|leg_r|shin_r)$/.test(n)) bones.rightCalf = o
    if (!bones.leftFoot && /^foot_l$/.test(n)) bones.leftFoot = o
    if (!bones.rightFoot && /^foot_r$/.test(n)) bones.rightFoot = o
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

  // Rest pose: aim bones in WORLD space so the pose is correct no matter what
  // the FBX local bone axes are. Rotate a bone so its child lies along `dir`.
  const _v = () => new THREE.Vector3()
  function aim(bone, child, dir) {
    if (!bone || !child) return
    fbx.updateMatrixWorld(true)
    const from = child.getWorldPosition(_v()).sub(bone.getWorldPosition(_v()))
    if (from.lengthSq() < 1e-10) return // degenerate segment: aiming would NaN
    from.normalize()
    const dq = new THREE.Quaternion().setFromUnitVectors(from, dir.clone().normalize())
    const pq = bone.parent.getWorldQuaternion(new THREE.Quaternion())
    // world delta → bone-local delta: pq⁻¹ · dq · pq
    bone.quaternion.premultiply(pq.clone().invert().multiply(dq).multiply(pq))
  }
  fbx.updateMatrixWorld(true)
  const chestX = (bones.chest || fbx).getWorldPosition(_v()).x
  for (const s of ['left', 'right']) {
    const up = bones[s + 'UpperArm'], lo = bones[s + 'LowerArm'], hd = bones[s + 'Hand']
    // outward = away from the chest, whichever world side this arm is on
    const out = up ? (Math.sign(up.getWorldPosition(_v()).x - chestX) || (s === 'left' ? 1 : -1)) : 1
    // upper arm hangs down, out enough to clear the skirt's side (|x|≈0.19)
    aim(up, lo, new THREE.Vector3(out * 0.38, -1, 0.02))
    // forearm continues down, bending forward past the skirt hem
    aim(lo, hd, new THREE.Vector3(out * 0.20, -1, 0.28))
    // legs: straight down under the hips so she stands on one vertical axis
    aim(bones[s + 'Thigh'], bones[s + 'Calf'], new THREE.Vector3(out * 0.03, -1, 0))
    aim(bones[s + 'Calf'], bones[s + 'Foot'], new THREE.Vector3(0, -1, 0.01))
  }
  // relaxed hands: fingers curl gently (z+ on this rig), deeper toward the tip
  for (const list of Object.values(fingerBones))
    for (const b of list) {
      const seg = +(b.name.match(/_0(\d)_/)?.[1] || 1)
      b.rotation.z += b.name.startsWith('thumb') ? 0.08 : 0.13 + seg * 0.06
      b.userData.rest = b.rotation.clone()
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
  // stand on the vertical axis: pelvis directly above world origin
  const rootRef = bones.hips || bones.spine
  if (rootRef) {
    const p = rootRef.getWorldPosition(new THREE.Vector3())
    fbx.position.x -= p.x
    fbx.position.z -= p.z
    fbx.updateMatrixWorld(true)
  }

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
      // chain depth = real links only (bones with an actual offset); the rig
      // stacks zero-offset duplicate bones that belong to their parent link
      let depth = 0, p = bone
      while (p && /^hair_/i.test(p.name)) {
        if (p.position.lengthSq() > 1e-6) depth++
        p = p.parent
      }
      depth = Math.max(1, depth)
      const side = n.endsWith('_l') ? 1 : n.endsWith('_r') ? -1 : 0
      const front = n.includes('_front_') ? 1 : -1
      bone.userData.hairRest = bone.rotation.clone()
      return {
        bone, depth, side, front, phase: i * 0.73,
        x: 0, z: 0, vx: 0, vz: 0,
      }
    })
  const hairMaxDepth = Math.max(1, ...hairState.map(h => h.depth))

  // Gravity drape: aim each strand segment (root → tip) toward a blend of its
  // authored direction and straight down, so hair hangs in a natural curve
  // instead of sitting glued to the skull. Tips droop more than roots; strands
  // fan slightly outward for separation; front flows forward, back cascades.
  if (bones.head) {
    const headP = bones.head.getWorldPosition(_v())
    // next real link: BFS past the zero-offset duplicate bones (dead-end
    // decorations) to the first descendant with an actual offset
    const realChild = (bone) => {
      const queue = bone.children.filter(c => c.isBone)
      while (queue.length) {
        const q = queue.shift()
        if (q.position.lengthSq() > 1e-6) return q
        queue.push(...q.children.filter(c => c.isBone))
      }
      return null
    }
    for (const h of [...hairState].sort((a, b) => a.depth - b.depth)) {
      const child = realChild(h.bone)
      if (child) {
        const t = h.depth / hairMaxDepth
        const bp = h.bone.getWorldPosition(_v())
        const cur = child.getWorldPosition(_v()).sub(bp).normalize()
        // front bangs droop gently (they're short); back hair really hangs
        const grav = h.front > 0 ? 0.10 + t * 0.20 : 0.22 + t * 0.42
        const dir = cur.lerp(new THREE.Vector3(0, -1, 0), grav)
        // separation: fan out from the head's vertical axis
        const out = new THREE.Vector3(bp.x - headP.x, 0, bp.z - headP.z)
        if (out.lengthSq() > 1e-6) dir.add(out.normalize().multiplyScalar(0.045 + t * 0.055))
        // flow: bangs curve forward past the face, back hair drapes behind
        dir.z += h.front > 0 ? 0.04 : -0.05
        aim(h.bone, child, dir.normalize())
      }
      h.bone.userData.hairRest = h.bone.rotation.clone() // rest = draped pose
    }
  }

  const prevHeadRot = bones.head ? bones.head.rotation.clone() : null
  let prevSceneY = fbx.rotation.y
  let prevHeadPos = null
  const headVel = { x: 0, z: 0 } // smoothed head world velocity → hair inertia

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
  const shrugU = morphSetter(/mouthShrugUpper/i)
  const shrugL = morphSetter(/mouthShrugLower/i)
  const jawFwd = morphSetter(/jawForward/i)
  const cheekPuff = morphSetter(/cheekPuff/i)
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

  // Cloth touch response: when a hand gets inside a skirt panel's space, the
  // panel's bone swings away (world-space, around the horizontal axis ⟂ to the
  // push) and springs back when the hand leaves — fabric yields, never clips.
  const skirtState = skirtLinks.map(bone => ({
    bone, restQ: bone.quaternion.clone(), x: 0, z: 0, vx: 0, vz: 0,
  }))
  const _sq = new THREE.Quaternion(), _pq = new THREE.Quaternion(), _ax = new THREE.Vector3()
  function updateSkirt(dt) {
    if (!skirtState.length) return
    const safeDt = Math.max(1 / 120, Math.min(dt, 1 / 20))
    const hands = []
    for (const k of ['leftHand', 'rightHand'])
      if (bones[k]) hands.push(bones[k].getWorldPosition(new THREE.Vector3()))
    for (const s of skirtState) {
      const bp = s.bone.getWorldPosition(_v())
      bp.y -= 0.08 // test against the middle of the hanging panel, not its pivot
      let tx = 0, tz = 0
      for (const hp of hands) {
        const dx = bp.x - hp.x, dy = bp.y - hp.y, dz = bp.z - hp.z
        const overlap = 0.11 - Math.hypot(dx, dy, dz)
        if (overlap > 0) {
          const hl = Math.hypot(dx, dz) || 1
          tx += (dx / hl) * overlap * 5.5
          tz += (dz / hl) * overlap * 5.5
        }
      }
      s.vx += (tx - s.x) * 30 * safeDt
      s.vz += (tz - s.z) * 30 * safeDt
      s.vx *= Math.exp(-11 * safeDt)
      s.vz *= Math.exp(-11 * safeDt)
      s.x += s.vx
      s.z += s.vz
      const ang = Math.min(0.38, Math.hypot(s.x, s.z)) // yield, never fold inside-out
      s.bone.quaternion.copy(s.restQ)
      if (ang > 0.003) {
        const inv = 1 / Math.hypot(s.x, s.z)
        _ax.set(-s.z * inv, 0, s.x * inv)       // cross(down, push)
        _sq.setFromAxisAngle(_ax, ang)
        const pq = s.bone.parent.getWorldQuaternion(_pq)
        s.bone.quaternion.premultiply(pq.clone().invert().multiply(_sq).multiply(pq))
      }
    }
  }

  function updateHair(dt, t) {
    if (!hairState.length || !bones.head) return
    const safeDt = Math.max(1 / 120, Math.min(dt, 1 / 20))
    const head = bones.head.rotation
    const headDx = prevHeadRot ? head.x - prevHeadRot.x : 0
    const headDz = prevHeadRot ? head.z - prevHeadRot.z : 0
    const sceneDy = fbx.rotation.y - prevSceneY
    if (prevHeadRot) prevHeadRot.copy(head)
    prevSceneY = fbx.rotation.y
    // head world velocity: body sway/dance swings the hair even when the head
    // itself doesn't rotate
    bones.head.updateWorldMatrix(true, false)
    const e = bones.head.matrixWorld.elements
    if (prevHeadPos) {
      headVel.x += ((e[12] - prevHeadPos.x) / safeDt - headVel.x) * 0.25
      headVel.z += ((e[14] - prevHeadPos.z) / safeDt - headVel.z) * 0.25
    }
    prevHeadPos = { x: e[12], z: e[14] }

    for (const h of hairState) {
      const rest = h.bone.userData.hairRest
      const tip = h.depth / hairMaxDepth
      const amp = 0.04 + tip * 0.24            // tips swing wide, roots barely
      const spring = 30 - tip * 19             // loose tips ≈ slow pendulum
      const damping = 6.5 - tip * 2            // underdamped → follow-through
      const breeze = (Math.sin(t * 0.9 + h.phase) + Math.sin(t * 1.7 + h.phase * 1.9) * 0.5) * 0.022 * tip
      const targetX = (-headDx * 4.5 - headVel.z * 0.8 + breeze * h.front) * tip
      const targetZ = (-headDz * 3.8 - sceneDy * 3.4 + headVel.x * 0.8 + breeze * h.side) * tip
      h.vx += (targetX - h.x) * spring * safeDt
      h.vz += (targetZ - h.z) * spring * safeDt
      h.vx *= Math.exp(-damping * safeDt)
      h.vz *= Math.exp(-damping * safeDt)
      h.x += h.vx
      h.z += h.vz
      h.bone.rotation.x = rest.x + Math.max(-amp, Math.min(amp, h.x))
      h.bone.rotation.z = rest.z + Math.max(-amp, Math.min(amp, h.z))
    }
  }

  return {
    scene: fbx,
    isMina: true,
    channels: {
      jaw, funnel, stretch, blink, browUp, browSad, browDown, frown, squint, eyeWide,
      lipPress, lipUpper, lipLower, lipSideL, lipSideR, lipRollU, lipRollL,
      shrugU, shrugL, jawFwd, cheekPuff,
      smileL, smileR, dimple, nose, cheek,
      smile: v => { smileM(v); cheek(v * 0.4) },
      tears: v => { tearsMat.opacity = v * 0.85 },
      lookX: v => { lookL(Math.max(0, v)); lookR(Math.max(0, -v)) },
      lookY: v => { lookU(Math.max(0, v)); lookD(Math.max(0, -v)) },
    },
    getBone: k => bones[k] || null,
    fingers: fingerBones,
    groundY,
    bodyHeight,
    frameHeight,
    lookHeight: 1.35,
    update: (dt) => { updateSkirt(dt); updateHair(dt, performance.now() * 0.001) },
  }
}
