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
  // denser hair: higher opacity + lower alphaTest keeps more of each strand card
  // so the head reads as full hair, not sparse cards with gaps
  if (n.includes('HAIR')) return mk({ map: T('T_HAIR_WAVY_alpha_channel.png'),
    color: 0x3a302d, transparent: true, opacity: 0.98, alphaTest: 0.10,
    depthWrite: false, side: THREE.DoubleSide, roughness: 0.66,
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
  // performance stage costume — its own base/normal/roughness (linear data maps),
  // a bit shinier and metallic than the casual fit
  if (n.includes('PERFORMANCE')) return mk({ map: T('T_MINA_PERFORMANCE_BaseColor_Black.png', true, false),
    normalMap: T('T_MINA_PERFORMANCE_Normal.png', false, false),
    roughnessMap: T('T_MINA_PERFORMANCE_Roughness.png', false, false),
    roughness: 1.0, metalness: 0.12, ior: 1.5,
    clearcoat: 1, clearcoatRoughness: 0.12,
    sheen: 0.2, sheenRoughness: 0.35, sheenColor: 0xffe0d4,
    envMapIntensity: 1.15, reflectivity: 0.6, side: THREE.DoubleSide })
  if (n.includes('LINGERIE')) return mk({ color: 0x2b2b30, roughness: 0.7, side: THREE.DoubleSide })
  if (n.includes('HEAD') || n.includes('FACE'))
    return mk({ map: T('T_MINA_HEAD_BaseColor.png'), roughness: 0.38, ior: 1.4,
      // normal + roughness maps: pores/lips catch light instead of reading as a
      // flat mask (linear color space — they're data, not sRGB)
      normalMap: T('T_MINA_HEAD_NORMAL.png', false), roughnessMap: T('T_MINA_HEAD_Roughness.png', false),
      sheen: 0.18, sheenRoughness: 0.55, sheenColor: 0xffd9c8,
      clearcoat: 0.22, clearcoatRoughness: 0.42, envMapIntensity: 0.72 })
  if (n.includes('BODY')) return mk({ map: T('T_MINA_BODY_BaseColor_Censored.png'),
    // normal brings back nail-polish relief + skin form; roughness makes the
    // glossy nails read as glossy against matte skin (both are linear data maps)
    normalMap: T('T_MINA_BODY_Normal.png', false), roughnessMap: T('T_MINA_BODY_Roughness_Censored.png', false),
    roughness: 1.0, ior: 1.4, sheen: 0.18, sheenRoughness: 0.55, sheenColor: 0xffd9c8,
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

// full garments (separate FBX meshes), each with its own colour set. The body,
// head, hair and skeleton are shared in spirit but each FBX ships its own copy.
const GARMENTS = {
  casual: {
    fbx: 'SK_MINA_CASUAL_01_with_bones_in_skirt.fbx',
    jacket: 'SK_MINA_CASUAL_JACKET',
    colors: {
      film: 'T_MINA_CASUAL_BaseColor_Film4096.png', pink: 'T_MINA_CASUAL_BaseColor_Pink.png',
      white: 'T_MINA_CASUAL_BaseColor_White.png', black: 'T_MINA_CASUAL_BaseColor_Black.png',
      blue: 'T_MINA_CASUAL_BaseColor_Blue.png', green: 'T_MINA_CASUAL_BaseColor_Green.png',
      red: 'T_MINA_CASUAL_BaseColor_Red.png', violet: 'T_MINA_CASUAL_BaseColor_Violet.png',
    },
  },
  performance: {
    fbx: 'SK_MINA_PERFORMANCE_01_with_bones_in_skirt.fbx',
    jacket: 'SK_MINA_PERF_JACKET',
    colors: {
      black: 'T_MINA_PERFORMANCE_BaseColor_Black.png', blue: 'T_MINA_PERFORMANCE_BaseColor_Blue.png',
      green: 'T_MINA_PERFORMANCE_BaseColor_Green.png', red: 'T_MINA_PERFORMANCE_BaseColor_Red.png',
      violet: 'T_MINA_PERFORMANCE_BaseColor_Violet.png', white: 'T_MINA_PERFORMANCE_BaseColor_White.png',
    },
  },
}
export const GARMENT_KEYS = Object.keys(GARMENTS)

// eye colours: swap the iris base-colour map. hair colour: a material tint (the
// sample recolours hair the same way — one alpha map, different tint).
const EYE_TEX = {
  red: 'T_MINA_EYES_BASECOLOR_RED.png', blue: 'T_MINA_EYES_BASECOLOR_BLUE.png',
  brown: 'T_MINA_EYES_BASECOLOR_BROWN.png', dark: 'T_MINA_EYES_BASECOLOR_DARK.png',
  gray: 'T_MINA_EYES_BASECOLOR_GRAY.png', green: 'T_MINA_EYES_BASECOLOR_GREEN.png',
  purple: 'T_MINA_EYES_BASECOLOR_PURPLE.png', yellow: 'T_MINA_EYES_BASECOLOR_YELLOW.png',
}
const HAIR_TINT = {
  brown: 0x3a302d, black: 0x18140f, blonde: 0xb98b52, red: 0x6e2118, white: 0xcfc3b8, purple: 0x4a2a52,
}

export async function loadMina(garmentKey = 'casual') {
  const garment = GARMENTS[garmentKey] || GARMENTS.casual
  const fbx = await new FBXLoader().loadAsync(DIR + garment.fbx)

  const morphMeshes = []
  const casualMats = []          // outfit meshes — their map is swapped to recolor the clothes
  const eyeMats = []             // iris material(s) — map swapped for eye colour
  const hairMats = []            // hair material(s) — tinted for hair colour
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
    // UV flip: applies to every casual/performance mesh (body panels + clothing);
    // their FBX UVs are bottom-origin (head uses its own convention, no flip)
    if (/CASUAL|PERFORMANCE/i.test(mats.map(m => m?.name).join(' ') + o.name)) syncUv(o.geometry)
    // collect ONLY the clothing material (MAT_MINA_CASUAL / MAT_MINA_PERFORMANCE)
    // for recolouring — NOT the body skin (body meshes are named *_CASUAL_* but
    // wear MAT_BG_BODY, so keying off the mesh name repainted the skin).
    mapped.forEach((m, i) => {
      const mn = mats[i]?.name || ''
      if (!m?.isMeshPhysicalMaterial) return
      if (/CASUAL|PERFORMANCE/i.test(mn) && !/BODY/i.test(mn)) casualMats.push(m)
      if (/EYE/i.test(mn)) eyeMats.push(m)
      if (/HAIR/i.test(mn)) hairMats.push(m)
    })
    if (o.morphTargetDictionary) morphMeshes.push(o)
    console.log('[mina] mesh', o.name,
      'mats:', mats.map(m => m?.name).join(','),
      'morphs:', o.morphTargetDictionary ? Object.keys(o.morphTargetDictionary).join(',') : '-')
  })

  // find bones by name keyword
  const bones = {}
  const hairBones = []
  const skirtLinks = []
  const breastBones = []
  const fingerBones = { left: [], right: [] }
  const restLocalQ = {}          // per-bone rest LOCAL rotation — for mocap retargeting
  fbx.traverse(o => {
    if (!o.isBone) return
    const n = o.name.toLowerCase()
    if (!(o.name in restLocalQ)) restLocalQ[o.name] = o.quaternion.clone()
    if (/^(thumb|index|middle|ring|pinky)_0[1-3]_(l|r)$/.test(n))
      fingerBones[n.endsWith('_l') ? 'left' : 'right'].push(o)
    if (/^breast_(l|r)$/.test(n)) breastBones.push(o)
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

  // ---- hair physics: verlet chains with body colliders + live tuning ------
  // World-space particles per strand link: gravity, wind, damping, stiffness
  // toward the authored (draped) style, hard distance constraints, and sphere
  // collision against head/neck/chest/shoulders so hair can never clip skin.
  const hairParams = {
    stiffness: 0.16,        // pull toward the authored style (0..1)
    damping: 0.12,          // velocity kill per step (0..1)
    gravityMultiplier: 0.5, // 1 = full 9.8 m/s²
    wind: new THREE.Vector3(), // steady world-space wind, m/s
    flutter: 0.35,          // ambient breeze so hair is never frozen
    collisionRadius: 0.022, // per-particle clearance added to collider radii
    substeps: 2,            // raise for very fast motion
  }

  // Gravity drape: aim each strand segment (root → tip) toward a blend of its
  // authored direction and straight down, so hair hangs in a natural curve
  // instead of sitting glued to the skull. Tips droop more than roots; strands
  // fan slightly outward for separation; front flows forward, back cascades.
  // next real link: BFS past the zero-offset duplicate bones (dead-end
  // decorations) to the first descendant with an actual offset
  const nextLink = (bone) => {
    const queue = bone.children.filter(c => c.isBone)
    while (queue.length) {
      const q = queue.shift()
      if (q.position.lengthSq() > 1e-6) return q
      queue.push(...q.children.filter(c => c.isBone))
    }
    return null
  }
  if (bones.head) {
    const headP = bones.head.getWorldPosition(_v())
    for (const h of [...hairState].sort((a, b) => a.depth - b.depth)) {
      const child = nextLink(h.bone)
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

  // chains are built AFTER the drape so the sim's rest = the draped style
  fbx.updateMatrixWorld(true)
  const hairChains = []
  for (const h of hairState) {
    if (/^hair_/i.test(h.bone.parent.name)) continue // chain roots only
    const links = []
    for (let b = h.bone; b; b = nextLink(b)) links.push(b)
    if (links.length < 2) continue
    hairChains.push(links.map((bone, i) => ({
      bone,
      restQ: bone.quaternion.clone(),
      childLocal: i + 1 < links.length ? links[i + 1].position.clone() : null,
      len: i > 0 ? bone.getWorldPosition(new THREE.Vector3())
        .distanceTo(links[i - 1].getWorldPosition(_v())) : 0,
      pos: bone.getWorldPosition(new THREE.Vector3()),
      prev: bone.getWorldPosition(new THREE.Vector3()),
    })))
  }
  const hairColliders = []
  {
    const C = (bone, r, dy = 0) => bone && hairColliders.push({ bone, r, dy })
    // midpoint collider between two bones — fills the gaps single spheres leave
    const M = (a, b, f, r) => a && b && hairColliders.push({ bone: a, bone2: b, f, r, dy: 0 })
    C(bones.head, 0.095, 0.02)
    C(bones.neck, 0.065)
    C(bones.chest, 0.14)
    C(bones.spine, 0.135)          // upper back — long strands rest on it, not in it
    // mid & lower back: long strands reach the waist — without these they sink
    // through the lower back between the spine sphere and the hips
    M(bones.spine, bones.hips, 0.4, 0.135)
    M(bones.spine, bones.hips, 0.75, 0.12)
    C(bones.hips, 0.12, 0.04)
    C(bones.leftClavicle, 0.075)
    C(bones.rightClavicle, 0.075)
    // shoulder line: strands drape OVER the clavicle→deltoid ridge instead of
    // slipping through the gap between the old clavicle and upper-arm spheres
    M(bones.leftClavicle, bones.leftUpperArm, 0.55, 0.08)
    M(bones.rightClavicle, bones.rightUpperArm, 0.55, 0.08)
    C(bones.leftUpperArm, 0.07)
    C(bones.rightUpperArm, 0.07)
    M(bones.leftUpperArm, bones.leftLowerArm, 0.35, 0.06)
    M(bones.rightUpperArm, bones.rightLowerArm, 0.35, 0.06)
  }

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
    // colliders: hands + leg segments sampled at 3 points each, so a lifting
    // thigh or stepping calf pushes the cloth no matter where it meets it
    const colliders = []
    for (const k of ['leftHand', 'rightHand'])
      if (bones[k]) colliders.push({ p: bones[k].getWorldPosition(new THREE.Vector3()), r: 0.11 })
    const seg = (ka, kb, r) => {
      if (!bones[ka] || !bones[kb]) return
      const pa = bones[ka].getWorldPosition(new THREE.Vector3())
      const pb = bones[kb].getWorldPosition(_v())
      for (const f of [0.25, 0.5, 0.75])
        colliders.push({ p: pa.clone().lerp(pb, f), r })
    }
    seg('leftThigh', 'leftCalf', 0.105)
    seg('rightThigh', 'rightCalf', 0.105)
    seg('leftCalf', 'leftFoot', 0.085)
    seg('rightCalf', 'rightFoot', 0.085)
    const hipsP = bones.hips ? bones.hips.getWorldPosition(new THREE.Vector3()) : null
    // a lifting thigh carries the cloth ahead of it (kinematic coupling) —
    // the spring alone reacts too late at dance tempo
    const lift = k => bones[k]
      ? Math.max(0, bones[k].rotation.z - (bones[k].userData.rest?.z ?? bones[k].rotation.z)) : 0
    // clamp: a deep tuck (mid-jump) would otherwise fling the front panels up and
    // out — real fabric drapes over a raised knee, it doesn't balloon off it
    const liftL = Math.min(0.6, lift('leftThigh')), liftR = Math.min(0.6, lift('rightThigh'))
    for (const s of skirtState) {
      const bp = s.bone.getWorldPosition(_v())
      // inertia: each panel lags behind its own pivot's motion (body sway,
      // hip rotation, dance bounce) — cloth swings, it doesn't ride rigidly
      if (!s.pv) s.pv = { x: 0, y: 0, z: 0, px: bp.x, py: bp.y, pz: bp.z }
      s.pv.x += ((bp.x - s.pv.px) / safeDt - s.pv.x) * 0.3
      s.pv.y += ((bp.y - s.pv.py) / safeDt - s.pv.y) * 0.3
      s.pv.z += ((bp.z - s.pv.pz) / safeDt - s.pv.z) * 0.3
      s.pv.px = bp.x; s.pv.py = bp.y; s.pv.pz = bp.z
      let tx = -s.pv.x * 0.55, tz = -s.pv.z * 0.55
      const nm = s.bone.name
      const legLift = nm.endsWith('_l') ? liftL : liftR
      // gentle forward follow on a leg lift; the real drape-over-thigh work is
      // done by the from-below collider response further down
      if (legLift > 0 && !nm.includes('back'))
        tz += legLift * (nm.includes('front') ? 0.7 : 0.4)
      // vertical drop makes the hem float outward from the body axis
      if (hipsP) {
        const rx = bp.x - hipsP.x, rz = bp.z - hipsP.z
        const rl = Math.hypot(rx, rz) || 1
        const flare = Math.max(0, -s.pv.y) * 0.32
        tx += (rx / rl) * flare
        tz += (rz / rl) * flare
      }
      bp.y -= 0.08 // test against the middle of the hanging panel, not its pivot
      for (const c of colliders) {
        const dx = bp.x - c.p.x, dy = bp.y - c.p.y, dz = bp.z - c.p.z
        const overlap = c.r - Math.hypot(dx, dy, dz)
        if (overlap > 0) {
          const hl = Math.hypot(dx, dz)
          if (hl > 0.03) {                     // side hit: push horizontally away
            tx += (dx / hl) * overlap * 8
            tz += (dz / hl) * overlap * 8
          } else if (hipsP) {                  // hit from BELOW (squatting thigh
            // rising under the cloth): drape the panel outward from the hips
            // axis — its own hang direction — instead of clipping through
            const rx = bp.x - hipsP.x, rz = bp.z - hipsP.z, rl = Math.hypot(rx, rz) || 1
            tx += (rx / rl) * overlap * 8
            tz += (rz / rl) * overlap * 8
          }
        }
      }
      s.vx += (tx - s.x) * 46 * safeDt
      s.vz += (tz - s.z) * 46 * safeDt
      s.vx *= Math.exp(-13 * safeDt)
      s.vz *= Math.exp(-13 * safeDt)
      s.x += s.vx
      s.z += s.vz
      // cloth never swings INTO the body: strip the inward (toward the hips
      // axis) component of the applied swing, keep the tangential part
      if (hipsP) {
        const rx = bp.x - hipsP.x, rz = bp.z - hipsP.z
        const rl = Math.hypot(rx, rz) || 1
        const inward = -(s.x * rx + s.z * rz) / rl
        if (inward > 0) {
          s.x += (rx / rl) * inward * 0.9
          s.z += (rz / rl) * inward * 0.9
        }
      }
      // yield cap grows with the leg lift so the skirt can rotate onto a
      // squatting thigh, but never far enough to flare umbrella-flat
      const cap = 0.5 + (nm.includes('back') ? 0 : legLift * 0.5)
      const ang = Math.min(cap, Math.hypot(s.x, s.z))
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

  // ---- coat cloth: the jacket has NO cloth bones (neither does the sample —
  // it only rigs hair + skirt), so it can't spring like the skirt. Instead we
  // sway it at the VERTEX level: the lower panels / hem trail the body's motion
  // (inertia) and sag with gravity, while the shoulders stay pinned. One shared
  // pendulum drives every free vertex, weighted by how far below the chest it
  // sits — a lightweight cloth that gives the open coat a real hanging swing.
  const jacket = fbx.getObjectByName(garment.jacket)
  let jacketRest = null, jacketW = null
  if (jacket) {
    jacket.frustumCulled = false               // verts move each frame; don't cull on the stale bbox
    const pos = jacket.geometry.attributes.position
    const si = jacket.geometry.attributes.skinIndex, sw = jacket.geometry.attributes.skinWeight
    const skel = jacket.skeleton
    // SLEEVES are skinned to the arm bones — they must stay welded to the arm or
    // the cuff clips through it. Only the panels bound to the TORSO (spine/pelvis)
    // are free cloth. freeness = (how far below the chest) × (torso-bound fraction).
    const isArm = n => /(upperarm|lowerarm|hand|clavicle|twist|index|middle|ring|pinky|thumb|ik_)/i.test(n)
    jacketRest = pos.array.slice()
    jacketW = new Float32Array(pos.count)
    for (let i = 0; i < pos.count; i++) {
      const y = jacketRest[i * 3 + 1]
      const idx = [si.getX(i), si.getY(i), si.getZ(i), si.getW(i)]
      const wts = [sw.getX(i), sw.getY(i), sw.getZ(i), sw.getW(i)]
      let torso = 0
      for (let k = 0; k < 4; k++) if (!isArm(skel.bones[idx[k]]?.name || '')) torso += wts[k]
      const yF = Math.max(0, Math.min(1, (132 - y) / (132 - 108)))
      jacketW[i] = yF * yF * torso              // arm-bound (sleeve/cuff) verts → ~0 → pinned
    }
  }
  const jacketSwing = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 }
  let jacketPrev = null, jacketPrevYaw = 0
  const _jv = new THREE.Vector3(), _jq = new THREE.Quaternion(), _joff = new THREE.Vector3()
  function updateJacket(dt) {
    if (!jacket || !bones.hips) return
    const safeDt = Math.max(1 / 120, Math.min(dt, 1 / 20))
    const hp = bones.hips.getWorldPosition(_jv)
    if (!jacketPrev) { jacketPrev = hp.clone(); jacketPrevYaw = fbx.rotation.y }
    // body velocity (world, incl. the vertical dance bounce) — cloth trails it
    const vx = (hp.x - jacketPrev.x) / safeDt, vy = (hp.y - jacketPrev.y) / safeDt, vz = (hp.z - jacketPrev.z) / safeDt
    jacketPrev.copy(hp)
    const s = jacketSwing, G = 0.22
    s.vx += (-vx * G - s.x) * 16 * safeDt
    s.vy += (-vy * G - s.y) * 16 * safeDt
    s.vz += (-vz * G - s.z) * 16 * safeDt
    const damp = Math.exp(-6 * safeDt)          // loose → visible swing that settles over ~0.5s
    s.vx *= damp; s.vy *= damp; s.vz *= damp
    s.x += s.vx; s.y += s.vy; s.z += s.vz
    // cap the swing so a fast move (a jump) can't fling the coat off the body,
    // and keep it modest so the hem doesn't dive down THROUGH the skirt beneath
    // it — real cloth stays attached and stretches only so far
    const mag = Math.hypot(s.x, s.y, s.z), MAX = 0.045
    if (mag > MAX) { const k = MAX / mag; s.x *= k; s.y *= k; s.z *= k }
    // world sway (+ gravity sag) → jacket-local bind space
    const sc = fbx.scale.x || 1
    jacket.getWorldQuaternion(_jq).invert()
    _joff.set(s.x, s.y - 0.008, s.z).applyQuaternion(_jq).divideScalar(sc)
    // turn flare: a spinning body flings the open hem out to the trailing side
    // (local X) — the dominant coat motion during a dance is rotational, not linear
    const yaw = fbx.rotation.y
    const yawVel = (yaw - jacketPrevYaw) / safeDt
    jacketPrevYaw = yaw
    _joff.x += -yawVel * 0.035 / sc
    const arr = jacket.geometry.attributes.position.array
    for (let i = 0; i < jacketW.length; i++) {
      const w = jacketW[i], j = i * 3
      arr[j]     = jacketRest[j]     + w * _joff.x
      arr[j + 1] = jacketRest[j + 1] + w * _joff.y
      arr[j + 2] = jacketRest[j + 2] + w * _joff.z
    }
    jacket.geometry.attributes.position.needsUpdate = true
  }

  // ---- breast jiggle: the rig has breast_l/breast_r bones, so give them a light
  // damped spring driven by the chest's motion — they lag a bounce or sway and
  // rebound a couple times (soft tissue), instead of sitting rigidly. Small
  // amplitude; clamped so it never distorts.
  const breastState = breastBones.map(b => ({ bone: b, restQ: b.quaternion.clone(), prevW: null, a: 0, va: 0, r: 0, vr: 0 }))
  let breastT = 0
  const _brp = new THREE.Vector3(), _brv = new THREE.Vector3(), _brqi = new THREE.Quaternion()
  const _bre = new THREE.Euler(), _brq = new THREE.Quaternion()
  function updateBreast(dt) {
    if (!breastState.length) return
    const h = Math.max(1 / 120, Math.min(dt, 1 / 30))
    breastT += h
    const K = 200, C = 9                              // ~2.25 Hz, lightly damped → soft jiggle
    // always-on breathing micro-motion so they're alive even standing still
    const idleP = Math.sin(breastT * 1.7) * 0.010 + Math.sin(breastT * 0.9 + 1.1) * 0.006
    const idleR = Math.sin(breastT * 1.3 + 0.5) * 0.006
    for (const st of breastState) {
      // drive off the breast bone's OWN world motion: it sits off the spine axis,
      // so it sweeps when the body turns, sways or bounces — captures the idle
      // sway, the dance bounce AND the turn-around, which chest translation misses
      st.bone.updateWorldMatrix(true, false)
      const wp = st.bone.getWorldPosition(_brp)
      if (!st.prevW) st.prevW = wp.clone()
      const vw = _brv.subVectors(wp, st.prevW).divideScalar(h)
      st.prevW.copy(wp)
      // into chest-local so vertical/lateral stay consistent whatever way she faces
      st.bone.parent.getWorldQuaternion(_brqi).invert()
      vw.applyQuaternion(_brqi)
      const driveP = -vw.y * 0.13 - vw.z * 0.05 + idleP   // bob + fwd/back + breathing
      const driveR = -vw.x * 0.08 + idleR                 // lateral sway / turn-around
      st.va += (K * (driveP - st.a) - C * st.va) * h
      st.vr += (K * (driveR - st.r) - C * st.vr) * h
      st.a += st.va * h; st.r += st.vr * h
      st.a = Math.max(-0.16, Math.min(0.16, st.a))
      st.r = Math.max(-0.13, Math.min(0.13, st.r))
      st.bone.quaternion.copy(st.restQ).multiply(_brq.setFromEuler(_bre.set(st.a, 0, st.r)))
    }
  }

  const _hv = new THREE.Vector3(), _ht = new THREE.Vector3(), _hd = new THREE.Vector3()
  const _hw = new THREE.Vector3(), _hrd = new THREE.Vector3(), _hsd = new THREE.Vector3()
  const _hq1 = new THREE.Quaternion(), _hq2 = new THREE.Quaternion(), _hq3 = new THREE.Quaternion()
  let prevRootPos = null
  function updateHair(dt, t) {
    if (!hairChains.length) return
    const p = hairParams
    const safeDt = Math.max(1 / 240, Math.min(dt, 1 / 30))
    // teleport guard: a large root jump snaps the sim instead of whipping hair
    if (prevRootPos && prevRootPos.distanceToSquared(fbx.position) > 0.25) {
      for (const chain of hairChains)
        for (const l of chain) { l.bone.getWorldPosition(l.pos); l.prev.copy(l.pos) }
    }
    ;(prevRootPos || (prevRootPos = new THREE.Vector3())).copy(fbx.position)

    const spheres = []
    for (const c of hairColliders) {
      c.bone.updateWorldMatrix(true, false)
      const s = c.bone.getWorldPosition(new THREE.Vector3())
      if (c.bone2) { // midpoint collider (shoulder ridge, upper-arm segment)
        c.bone2.updateWorldMatrix(true, false)
        s.lerp(c.bone2.getWorldPosition(_ht), c.f)
      }
      s.y += c.dy
      spheres.push({ c: s, r: c.r + p.collisionRadius })
    }
    // wind = steady param + layered-sine flutter so idle hair still breathes
    _hw.copy(p.wind)
    _hw.x += (Math.sin(t * 1.3) + Math.sin(t * 2.9 + 1.7) * 0.4) * p.flutter
    _hw.z += Math.sin(t * 1.1 + 0.9) * p.flutter * 0.7
    const stepDt = safeDt / p.substeps
    const gStep = 9.8 * p.gravityMultiplier * stepDt * stepDt

    for (const chain of hairChains) {
      // root is kinematic: welded to the scalp, follows the head exactly
      const root = chain[0]
      root.bone.updateWorldMatrix(true, false)
      root.bone.getWorldPosition(root.pos)
      root.prev.copy(root.pos)

      for (let s = 0; s < p.substeps; s++) {
        for (let i = 1; i < chain.length; i++) {
          const l = chain[i], par = chain[i - 1]
          // verlet integrate: inertia + gravity + wind
          _hv.subVectors(l.pos, l.prev).multiplyScalar(1 - p.damping)
          l.prev.copy(l.pos)
          l.pos.add(_hv)
          l.pos.y -= gStep
          l.pos.addScaledVector(_hw, stepDt * stepDt)
          // stiffness: pull toward where the authored style puts this link
          if (par.childLocal) {
            _ht.copy(par.childLocal).applyMatrix4(par.bone.matrixWorld)
            l.pos.lerp(_ht, p.stiffness)
          }
          // hard distance constraint: strands never stretch
          _hd.subVectors(l.pos, par.pos)
          const dl = _hd.length() || 1e-6
          l.pos.copy(par.pos).addScaledVector(_hd, l.len / dl)
          // sphere collision: push out of head/neck/chest/shoulders
          for (const sp of spheres) {
            _hd.subVectors(l.pos, sp.c)
            const dd = _hd.length()
            if (dd < sp.r && dd > 1e-6) l.pos.copy(sp.c).addScaledVector(_hd, sp.r / dd)
          }
        }
      }
      // write back: rotate each bone so its child lands on the solved particle
      for (let i = 0; i < chain.length - 1; i++) {
        const l = chain[i], child = chain[i + 1]
        l.bone.quaternion.copy(l.restQ)
        l.bone.updateWorldMatrix(true, false)
        const bw = l.bone.getWorldPosition(_hv)
        const wq = l.bone.getWorldQuaternion(_hq1)
        _hrd.copy(l.childLocal).applyQuaternion(wq).normalize()
        _hsd.copy(child.pos).sub(bw).normalize()
        _hq2.setFromUnitVectors(_hrd, _hsd)
        const pq = l.bone.parent.getWorldQuaternion(_hq3)
        l.bone.quaternion.premultiply(pq.clone().invert().multiply(_hq2).multiply(pq))
        l.bone.updateWorldMatrix(true, false)
      }
      // resync particles to the final bone positions for the next frame
      for (const l of chain) l.bone.getWorldPosition(l.pos)
    }
  }

  // ---- dance: clip-driven, the sample project's mechanism (its Unity animator
  // plays mocap FBX clips; same Character-Creator rig => clips drive Mina
  // directly, no retargeting). The 8 dances mirror the sample's dance panel;
  // music tracks come from the sample's own CDN (downloaded to models/dances/).
  // The sample shipped WITHOUT the dance FBXs — drop each clip at
  // holohuman/models/dances/<key>.fbx and it plays with its matched track.
  const DANCES = [
    { key: 'kemusan', label: 'Kemusan', music: 'ke_mu_san.mp3' }, // 科目三
    { key: 'ghost',   label: 'Ghost',   music: '1.mp3' },
    { key: 'tech',    label: 'Tech',    music: '2.mp3' },
    { key: 'welcome', label: 'Welcome', music: '3.mp3' },
    { key: 'art',     label: 'Art',     music: '4.mp3' },
    { key: 'boom',    label: 'Boom',    music: '5.mp3' },
    { key: 'fairy',   label: 'Fairy',   music: '3.mp3' }, // sample CDN has 6 tracks for 8 dances
    { key: 'king',    label: 'King',    music: '5.mp3' },
  ]
  const mixer = new THREE.AnimationMixer(fbx)
  const clipCache = {} // key -> AnimationAction | null (null = tried, missing)
  let danceAction = null // currently playing action
  let danceAudio = null
  let poseSnap = null
  let danceStopping = false
  let turnRate = 0       // rad/s of root yaw for the current dance (0 = face front)
  let danceTurn = 0      // accumulated root yaw, eased back to 0 when the dance ends

  // procedural fallback clip: the mocap FBX pack never shipped with the sample,
  // so when a clip file is missing we synthesize a looping dance groove from
  // the rig's rest pose (bone axes measured in behavior.js: upperArm z− lifts /
  // y+ flares out, calf z− bends the knee, hips local z = world vertical).
  // One generator, per-key seeded params → 8 distinct dances.
  function makeDanceClip(key) {
    let seed = 0
    for (const c of key) seed = (seed * 31 + c.charCodeAt(0)) >>> 0
    const rnd = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32
    const bpm = 100 + Math.floor(rnd() * 32)          // 100–132
    const beat = 60 / bpm
    const T = beat * 16                                // 4 bars, loops cleanly
    const alt = rnd() < 0.6 ? Math.PI : 0              // arms alternate vs together
    const armAmp = 0.5 + rnd() * 0.5
    const swayAmp = 0.10 + rnd() * 0.10
    const twistAmp = 0.08 + rnd() * 0.10
    const kneeAmp = 0.22 + rnd() * 0.12               // beat bounce depth (radians); groundFeet keeps soles planted
    const phase = rnd() * Math.PI * 2

    const w = 2 * Math.PI / (beat * 2)                 // one full cycle per 2 beats
    // knee bounce: BOTH knees soften together on each beat (never the antiphase
    // march that sank one foot through the floor). The leg bends as a flat-sole
    // chain — thigh +θ/2, calf −θ, foot +θ/2 — so the sole stays level and, with
    // the matched hip drop below, dead planted on the ground.
    const knee = t => kneeAmp * (0.5 - 0.5 * Math.cos(t * w * 2))
    // euler-offset curves per bone (t in seconds), mirroring left/right
    const moves = {
      hips:          t => ({ y: Math.sin(t * w + phase) * swayAmp, z: 0, x: 0 }),
      spine:         t => ({ y: Math.sin(t * w + phase) * twistAmp, z: Math.sin(t * w * 0.5) * 0.06, x: 0 }),
      chest:         t => ({ y: Math.sin(t * w + phase + 0.4) * twistAmp, z: 0, x: Math.sin(t * w * 2) * 0.03 }),
      head:          t => ({ y: Math.sin(t * w + phase + 0.8) * 0.14, x: Math.abs(Math.sin(t * w)) * 0.08 - 0.04, z: 0 }),
      leftUpperArm:  t => ({ z: -0.45 - (Math.sin(t * w) * 0.5 + 0.5) * armAmp, y: 0.35, x: 0 }),
      rightUpperArm: t => ({ z: -0.45 - (Math.sin(t * w + alt) * 0.5 + 0.5) * armAmp, y: 0.35, x: 0 }),
      leftLowerArm:  t => ({ z: -0.5 - (Math.sin(t * w + 0.5) * 0.5 + 0.5) * 0.7, y: 0.25, x: 0 }),
      rightLowerArm: t => ({ z: -0.5 - (Math.sin(t * w + alt + 0.5) * 0.5 + 0.5) * 0.7, y: 0.25, x: 0 }),
      leftThigh:     t => ({ z: knee(t) * 0.5, y: 0, x: 0 }),
      rightThigh:    t => ({ z: knee(t) * 0.5, y: 0, x: 0 }),
      leftCalf:      t => ({ z: -knee(t), y: 0, x: 0 }),
      rightCalf:     t => ({ z: -knee(t), y: 0, x: 0 }),
      leftFoot:      t => ({ z: knee(t) * 0.5, y: 0, x: 0 }),
      rightFoot:     t => ({ z: knee(t) * 0.5, y: 0, x: 0 }),
    }
    const dt = beat / 8, n = Math.round(T / dt) + 1
    const times = Float32Array.from({ length: n }, (_, i) => i * dt)
    const tracks = []
    const eul = new THREE.Euler(), qOff = new THREE.Quaternion(), qOut = new THREE.Quaternion()
    for (const [k, fn] of Object.entries(moves)) {
      const b = bones[k]
      if (!b) continue
      const rest = b.quaternion.clone()
      const vals = new Float32Array(n * 4)
      for (let i = 0; i < n; i++) {
        const o = fn(times[i])
        eul.set(o.x, o.y, o.z)
        qOut.copy(rest).multiply(qOff.setFromEuler(eul))
        qOut.toArray(vals, i * 4)
      }
      tracks.push(new THREE.QuaternionKeyframeTrack(b.name + '.quaternion', times, vals))
    }
    // no hip-height track: groundFeet() (avatar update) re-plants the lowest sole
    // every frame, so the knee bounce naturally dips the whole body on the beat —
    // and it corrects any rig-axis quirk (or a real mocap clip) the same way.
    console.log('[mina] dance clip:', key, '← procedural', bpm + 'bpm', T.toFixed(1) + 's')
    return new THREE.AnimationClip('dance_' + key, T, tracks)
  }

  async function loadDanceClip(key) {
    if (key in clipCache) return clipCache[key]
    for (const url of [`/models/dances/${key}.fbx`, DIR + 'dance.fbx']) {
      try {
        const anim = await new FBXLoader().loadAsync(url)
        const clip = anim.animations.find(c => c.duration > 1)
        if (!clip) continue
        // position tracks live in the source rig's own origin — keep only the
        // pelvis one (root bounce/steps), re-anchored onto Mina's rest pelvis,
        // and drop the rest so the clip can't teleport or stretch the body
        for (let i = clip.tracks.length - 1; i >= 0; i--) {
          const tr = clip.tracks[i]
          if (!tr.name.endsWith('.position')) continue
          const bone = fbx.getObjectByName(tr.name.split('.')[0])
          if (!bone || !/pelvis|hips/i.test(bone.name)) { clip.tracks.splice(i, 1); continue }
          const v = tr.values, rest = bone.position
          const ox = v[0] - rest.x, oy = v[1] - rest.y, oz = v[2] - rest.z
          for (let j = 0; j < v.length; j += 3) { v[j] -= ox; v[j + 1] -= oy; v[j + 2] -= oz }
        }
        console.log('[mina] dance clip:', key, '←', url, clip.duration.toFixed(1) + 's')
        return (clipCache[key] = mixer.clipAction(clip))
      } catch { /* try next path */ }
    }
    // no FBX on disk → procedural groove, so every dance always works
    return (clipCache[key] = mixer.clipAction(makeDanceClip(key)))
  }

  const dance = {
    list: DANCES.map(d => ({ key: d.key, label: d.label })),
    get busy() { return !!danceAction && danceAction.isRunning() },
    // starts dance `key` (default: first). Resolves false if its clip is missing.
    async start(key = DANCES[0].key) {
      const meta = DANCES.find(d => d.key === key) || DANCES[0]
      const action = await loadDanceClip(meta.key)
      if (!action) return false
      if (danceAction && danceAction !== action) danceAction.stop()
      danceStopping = false
      // clips animate bone POSITIONS too (pelvis root motion) — snapshot the
      // whole skeleton so stop() can hand a clean pose back to the behavior engine
      if (!poseSnap) {
        poseSnap = []
        fbx.traverse(o => { if (o.isBone) poseSnap.push([o, o.position.clone(), o.quaternion.clone()]) })
      }
      danceAction = action
      danceAction.setEffectiveTimeScale(1)
      // procedural dances slowly turn her all the way around (a "complex action"
      // beyond the in-place groove). Yaw is applied on the ROOT in world space
      // below, so it's immune to the rig's bone-axis quirks. A real mocap FBX
      // carries its OWN root rotation, so we leave those alone (turnRate 0).
      const isProc = action.getClip().name.startsWith('dance_')
      let h = 0; for (const c of meta.key) h = (h * 31 + c.charCodeAt(0)) >>> 0
      turnRate = isProc ? [0, 0, 0.5, -0.45, 0.7][h % 5] : 0
      danceAction.reset().fadeIn(0.5).play()
      danceAudio?.pause()
      danceAudio = new Audio('/models/dances/' + meta.music)
      danceAudio.loop = true
      danceAudio.volume = 0.75
      // clip length and music length are rarely equal (shared/mismatched tracks) —
      // without this the two loop independently and drift out of phase after the
      // first repeat. Nudge the clip so a WHOLE number of clip cycles spans one
      // music loop (nearest integer keeps playback speed ≈1×), so both restart
      // together, forever.
      danceAudio.addEventListener('loadedmetadata', () => {
        const dur = danceAudio?.duration
        if (action !== danceAction || !(dur > 0) || !isFinite(dur)) return
        const clipDur = action.getClip().duration
        const cycles = Math.max(1, Math.round(dur / clipDur))
        action.setEffectiveTimeScale(clipDur * cycles / dur)
      }, { once: true })
      danceAudio.play().catch(() => {}) // missing/blocked music never blocks the dance
      return true
    },
    stop() {
      if (!danceAction) return
      danceAction.fadeOut(0.6)
      danceStopping = true // finalized frame-side in tick() — timers get throttled
      danceAudio?.pause()
      danceAudio = null
    },
    tick() {
      if (danceStopping && danceAction && danceAction.getEffectiveWeight() <= 0.001) {
        danceStopping = false
        danceAction.stop()
        if (poseSnap) for (const [b, p, q] of poseSnap) { b.position.copy(p); b.quaternion.copy(q) }
      }
    },
  }

  // ---- real mocap gestures (CC-rig FBX clips like Talking.fbx that drive EVERY
  // joint incl. fingers). Same machinery as dance: the mixer owns the body while
  // it plays, behavior yields the body but keeps face/lips/emotion live, and
  // groundFeet keeps her planted. Used for talking body language.
  let gestureAction = null, gestureStopping = false
  const gestureCache = {}
  // the mocap clips use Character-Creator bone names (CC_Base_L_Upperarm) while
  // this FBX's skeleton was renamed to the game rig (upperarm_l). Same skeleton,
  // same rest pose → a pure NAME remap binds every track (no rotation retarget).
  const CC_STEM = {
    pelvis: 'pelvis', hip: 'pelvis', spine01: 'spine_01', spine02: 'spine_02', spine03: 'spine_03',
    neck: 'neck', necktwist01: 'neck', necktwist02: 'neck', head: 'head',
    clavicle: 'clavicle', upperarm: 'upperarm', forearm: 'lowerarm', hand: 'hand',
    thigh: 'thigh', calf: 'calf', foot: 'foot',
    index1: 'index_01', index2: 'index_02', index3: 'index_03',
    mid1: 'middle_01', mid2: 'middle_02', mid3: 'middle_03',
    ring1: 'ring_01', ring2: 'ring_02', ring3: 'ring_03',
    pinky1: 'pinky_01', pinky2: 'pinky_02', pinky3: 'pinky_03',
    thumb1: 'thumb_01', thumb2: 'thumb_02', thumb3: 'thumb_03',
  }
  const SIDED = /clavicle|upperarm|lowerarm|hand|thigh|calf|foot|index|middle|ring|pinky|thumb/
  function remapCC(node) {
    let s = node.replace(/^CC_Base_/, ''), side = ''
    if (/^L_/.test(s)) { side = '_l'; s = s.slice(2) } else if (/^R_/.test(s)) { side = '_r'; s = s.slice(2) }
    const base = CC_STEM[s.toLowerCase()]
    if (!base) return null
    return SIDED.test(base) ? base + side : base
  }
  async function loadGesture(url) {
    if (url in gestureCache) return gestureCache[url]
    try {
      const anim = await new FBXLoader().loadAsync(url)
      const clip = anim.animations.find(c => c.duration > 0.4)
      if (!clip) return (gestureCache[url] = null)
      // SOURCE rest pose: the clip rig's bind rotation per bone. Retarget applies
      // the clip's motion RELATIVE to its own rest onto Mina's rest, so a different
      // bind pose can't tip her over or fold the arms into the belly.
      const srcRest = {}
      anim.traverse(o => { if (o.isBone && !(o.name in srcRest)) srcRest[o.name] = o.quaternion.clone() })
      const _qs = new THREE.Quaternion(), _qd = new THREE.Quaternion(), _qi = new THREE.Quaternion()
      const kept = [], missed = new Set()
      for (const tr of clip.tracks) {
        const dot = tr.name.lastIndexOf('.')
        const node = tr.name.slice(0, dot), prop = tr.name.slice(dot + 1)
        const mina = fbx.getObjectByName(node) ? node : remapCC(node)   // already-correct or remapped
        if (!mina || !fbx.getObjectByName(mina)) { missed.add(node); continue }
        if (prop === 'scale') { missed.add(node); continue }            // never rescale bones
        if (prop === 'position' && !/pelvis|hips/i.test(mina)) { missed.add(node); continue } // only pelvis translates
        if (/breast/i.test(mina)) { missed.add(node); continue }        // breasts keep the jiggle sim
        // clavicles keep the IDLE pose: the clip's shoulder rotations collapse
        // the deltoid against the ribs (shrunken-shoulder look); the upper arm
        // alone carries the gesture fine
        if (/clavicle/i.test(mina)) { missed.add(node); continue }
        tr.name = mina + '.' + prop
        if (prop === 'quaternion') {
          // retarget: q_out = minaRest · (srcRest⁻¹ · q_clip) — the clip's motion
          // relative to ITS rest, re-based on Mina's rest (same rig, different bind
          // pose), so nothing tips over. Hands are kept out of the body per-frame
          // by pushArmsOut() below (a fixed flare can't, since the local axes
          // rotate with the pose).
          const sr = srcRest[node], mr = restLocalQ[mina]
          if (sr && mr) {
            _qi.copy(sr).invert()
            const v = tr.values
            for (let j = 0; j < v.length; j += 4) {
              _qs.set(v[j], v[j + 1], v[j + 2], v[j + 3])
              _qd.copy(_qi).multiply(_qs)          // delta from source rest
              _qs.copy(mr).multiply(_qd)            // onto Mina's rest
              v[j] = _qs.x; v[j + 1] = _qs.y; v[j + 2] = _qs.z; v[j + 3] = _qs.w
            }
          }
        } else if (prop === 'position') {                              // re-anchor pelvis onto rest
          const bone = fbx.getObjectByName(mina), v = tr.values, rest = bone.position
          const ox = v[0] - rest.x, oy = v[1] - rest.y, oz = v[2] - rest.z
          for (let j = 0; j < v.length; j += 3) { v[j] -= ox; v[j + 1] -= oy; v[j + 2] -= oz }
        }
        kept.push(tr)
      }
      clip.tracks = kept
      console.log('[mina] gesture clip:', url.split('/').pop(), clip.duration.toFixed(1) + 's,', kept.length, 'joints bound')
      return (gestureCache[url] = mixer.clipAction(clip))
    } catch (e) { console.warn('[mina] gesture load failed', url, e); return (gestureCache[url] = null) }
  }
  const gesture = {
    get busy() { return !!gestureAction && gestureAction.isRunning() && gestureAction.getEffectiveWeight() > 0.01 },
    async play(url) {
      if (dance.busy) return false                 // dancing overrides talking body
      const act = await loadGesture(url)
      if (!act || dance.busy) return false
      if (!poseSnap) { poseSnap = []; fbx.traverse(o => { if (o.isBone) poseSnap.push([o, o.position.clone(), o.quaternion.clone()]) }) }
      if (gestureAction && gestureAction !== act) gestureAction.fadeOut(0.3)
      gestureAction = act; gestureStopping = false
      act.reset().setLoop(THREE.LoopRepeat, Infinity).fadeIn(0.4).play()
      return true
    },
    stop() {
      if (!gestureAction) return
      gestureAction.fadeOut(0.4); gestureStopping = true
    },
    tick() {
      if (gestureStopping && gestureAction && gestureAction.getEffectiveWeight() <= 0.001) {
        gestureStopping = false; gestureAction.stop()
        if (poseSnap && !dance.busy) for (const [b, p, q] of poseSnap) { b.position.copy(p); b.quaternion.copy(q) }
      }
    },
  }

  // keep the lowest sole on the floor no matter how a clip poses the legs — a
  // per-frame re-plant. It learns the standing foot height while idle and holds
  // it while dancing, so the knee bounce dips the whole body instead of lifting
  // the feet, and it absorbs any rig-axis quirk (or a real mocap clip's root
  // height) without per-clip math.
  let restFootY = null
  const _fp = new THREE.Vector3()
  function groundFeet() {
    fbx.updateMatrixWorld(true)
    let m = Infinity
    for (const k of ['leftFoot', 'rightFoot']) {
      const f = bones[k]
      if (f) m = Math.min(m, f.getWorldPosition(_fp).y)
    }
    if (!isFinite(m)) return
    // plant while ANY clip drives the legs (dance or full-body talk mocap);
    // otherwise just learn the standing foot height for the next clip
    if (!dance.busy && !gesture.busy) { restFootY = m; return }
    if (restFootY == null) restFootY = m
    fbx.position.y += restFootY - m              // lift/lower so the lowest sole touches ground
  }

  // ---- ABDUCT the talk-mocap arms off the torso. The clip pulls the upper arms
  // in against the ribs / across the belly; yaw can't fix that, so we AIM each
  // upper arm so its ELBOW is pushed radially outward from the body axis — that
  // lifts the whole arm out to the side (real abduction), forearm + hand follow.
  const _pS = new THREE.Vector3(), _pE = new THREE.Vector3(), _pH = new THREE.Vector3()
  const _pc = new THREE.Vector3(), _pT = new THREE.Vector3()
  const _pfrom = new THREE.Vector3(), _pto = new THREE.Vector3()
  const _pdq = new THREE.Quaternion(), _ppq = new THREE.Quaternion()
  // rotate `bone` in WORLD space by dq (about its shoulder), converted to local
  const worldRot = (bone, dq) => {
    bone.parent.getWorldQuaternion(_ppq)
    bone.quaternion.premultiply(_ppq.clone().invert().multiply(dq).multiply(_ppq))
    bone.updateWorldMatrix(true, false)
  }
  function pushArmsOut() {
    const inDance = dance.busy
    if (!gesture.busy && !inDance) return
    const spine = bones.chest || bones.spine
    if (!spine) return
    fbx.updateMatrixWorld(true)
    // dance: radial keep-out only (cross-body sweeps are choreography, just keep
    // them off the mesh); talk mocap: also clamp to own side + in front of chest
    const R_ELBOW = inDance ? 0.15 : 0.17, R_HAND = inDance ? 0.15 : 0.20  // min dist from body axis
    const LAT_ELBOW = inDance ? -9 : 0.10, LAT_HAND = inDance ? -9 : 0.06  // min offset toward OWN side
    const FWD_HAND = inDance ? 0 : 0.16        // a near-midline hand must be this far IN FRONT of the chest
    // lateral axis (left shoulder → right shoulder, horizontal) so the side
    // test tracks any root rotation baked into the clip
    let lx = 1, lz = 0
    if (bones.leftUpperArm && bones.rightUpperArm) {
      bones.leftUpperArm.getWorldPosition(_pS); bones.rightUpperArm.getWorldPosition(_pE)
      lx = _pE.x - _pS.x; lz = _pE.z - _pS.z
      const n = Math.hypot(lx, lz) || 1; lx /= n; lz /= n
    }
    const fx = lz, fz = -lx                    // forward = up × lat
    const chain = [['leftUpperArm', 'leftLowerArm', 'leftHand', -1], ['rightUpperArm', 'rightLowerArm', 'rightHand', 1]]
    for (const [uk, lk, hk, sgn] of chain) {
      const upper = bones[uk], lower = bones[lk], hand = bones[hk]
      if (!upper || !lower) continue
      const c = spine.getWorldPosition(_pc)
      // clamp joint P (rotating `bone` about `pivot`): first onto its own side
      // of the midline, then out to the min radius from the body axis
      const aim = (P, pivot, bone, minLat, minRad, minFwd) => {
        let ox = P.x - c.x, oz = P.z - c.z, moved = false
        const lat = (ox * lx + oz * lz) * sgn
        if (lat < minLat) { const p = (minLat - lat) * sgn; ox += p * lx; oz += p * lz; moved = true }
        // near the midline the joint must sit IN FRONT of the chest, not across it
        if (minFwd && lat < 0.14) {
          const f = ox * fx + oz * fz
          if (f < minFwd) { ox += (minFwd - f) * fx; oz += (minFwd - f) * fz; moved = true }
        }
        const d = Math.hypot(ox, oz)
        if (d > 1e-4 && d < minRad) { const s = minRad / d; ox *= s; oz *= s; moved = true }
        if (!moved) return
        _pT.set(c.x + ox, P.y, c.z + oz)
        _pfrom.copy(P).sub(pivot).normalize()
        _pto.copy(_pT).sub(pivot).normalize()
        worldRot(bone, _pdq.setFromUnitVectors(_pfrom, _pto))
      }
      // 1) abduct the upper arm: push the ELBOW out / onto its side
      const S = upper.getWorldPosition(_pS), E = lower.getWorldPosition(_pE)
      aim(E, S, upper, LAT_ELBOW, R_ELBOW)
      // 2) then the HAND, by aiming the forearm
      if (hand) {
        const E2 = lower.getWorldPosition(_pE), H = hand.getWorldPosition(_pH)
        aim(H, E2, lower, LAT_HAND, R_HAND, FWD_HAND)
      }
      // 3) keep the hand out of the HEAD sphere (face/hair) — 3D push, since
      // dance moves bring hands up beside the face. 0.12 clears the heart pose.
      if (hand && bones.head) {
        const R_HEAD = 0.12
        const Hc = bones.head.getWorldPosition(_pS); Hc.y += 0.06
        const H2 = hand.getWorldPosition(_pH)
        const d = H2.distanceTo(Hc)
        if (d > 1e-4 && d < R_HEAD) {
          _pT.copy(H2).sub(Hc).multiplyScalar(R_HEAD / d).add(Hc)
          const E3 = lower.getWorldPosition(_pE)
          _pfrom.copy(H2).sub(E3).normalize()
          _pto.copy(_pT).sub(E3).normalize()
          worldRot(lower, _pdq.setFromUnitVectors(_pfrom, _pto))
        }
      }
    }
  }

  // ---- nail tint: paint the distal-fingertip verts via a vertex-colour the hands
  // material multiplies in (there is no separate nail mesh, so it tints the nail
  // area of each fingertip). Default white = no change until a colour is set.
  let nailVerts = null, nailAttr = null
  {
    let hands = null
    fbx.traverse(o => { if (o.isSkinnedMesh && /HANDS/i.test(o.name)) hands = o })
    if (hands?.skeleton?.bones) {
      const g = hands.geometry, si = g.attributes.skinIndex, sw = g.attributes.skinWeight, sk = hands.skeleton, pos = g.attributes.position
      const isNail = nm => /(index|middle|ring|pinky)_03_(l|r)$/i.test(nm) || /thumb_02_(l|r)$/i.test(nm)
      // distal segments are ~7k verts, so binding alone paints the whole finger.
      // The nail sits at the TIP, so keep only verts farthest from the distal
      // joint — concentrates the tint on the fingertip/nail, per finger.
      hands.updateWorldMatrix(true, false)
      const _bp = new THREE.Vector3(), _vp = new THREE.Vector3()
      const perBone = {}                             // boneIndex -> [{i, d}]
      for (let i = 0; i < pos.count; i++) {
        const idx = [si.getX(i), si.getY(i), si.getZ(i), si.getW(i)]
        const wts = [sw.getX(i), sw.getY(i), sw.getZ(i), sw.getW(i)]
        let w = 0, bi = -1, bw = 0
        for (let k = 0; k < 4; k++) if (isNail(sk.bones[idx[k]]?.name || '')) { w += wts[k]; if (wts[k] > bw) { bw = wts[k]; bi = idx[k] } }
        if (w > 0.7 && bi >= 0) {
          sk.bones[bi].getWorldPosition(_bp)
          _vp.fromBufferAttribute(pos, i).applyMatrix4(hands.matrixWorld)
          ;(perBone[bi] || (perBone[bi] = [])).push({ i, d: _vp.distanceTo(_bp) })
        }
      }
      nailVerts = []
      for (const list of Object.values(perBone)) {    // keep the tip third of each fingertip
        list.sort((a, b) => b.d - a.d)
        for (const e of list.slice(0, Math.ceil(list.length * 0.33))) nailVerts.push(e.i)
      }
      nailAttr = new THREE.BufferAttribute(new Float32Array(pos.count * 3).fill(1), 3)
      g.setAttribute('color', nailAttr)
      const hm = Array.isArray(hands.material) ? hands.material : [hands.material]
      for (const m of hm) if (m?.isMeshPhysicalMaterial) { m.vertexColors = true; m.needsUpdate = true }
    }
  }
  function setNailColor(hex) {
    if (!nailVerts || !nailAttr) return false
    const c = new THREE.Color(hex), a = nailAttr.array
    a.fill(1)
    for (const i of nailVerts) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b }
    nailAttr.needsUpdate = true
    return true
  }

  // ---- generic bone poser for LLM / console control of ANY joint or finger by
  // name: it sets the bone's REST rotation so the procedural motion plays around
  // the new pose (so it persists frame-to-frame). Returns false for unknown names.
  const _poseCache = {}
  function poseBone(name, { x, y, z } = {}) {
    if (!(name in _poseCache)) { let b = null; fbx.traverse(o => { if (!b && o.isBone && o.name === name) b = o }); _poseCache[name] = b }
    const b = _poseCache[name]
    if (!b) return false
    if (!b.userData.rest) b.userData.rest = b.rotation.clone()
    const r = b.userData.rest
    if (x != null) r.x = x
    if (y != null) r.y = y
    if (z != null) r.z = z
    b.rotation.copy(r)
    return true
  }

  // ---- colour swaps (same UVs → just recolours). Clothes swap the base map,
  // eyes swap the iris map, hair changes the material tint.
  function setOutfit(key) {
    const file = garment.colors[key]
    if (!file || !casualMats.length) return false
    const map = T(file, true, false)                  // sRGB colour, flipY=false (matches syncUv)
    for (const m of casualMats) { m.map = map; m.needsUpdate = true }
    return true
  }
  function setEyeColor(key) {
    const file = EYE_TEX[key]
    if (!file || !eyeMats.length) return false
    const map = T(file, true)
    for (const m of eyeMats) { m.map = map; m.needsUpdate = true }
    return true
  }
  function setHairColor(key) {
    const tint = HAIR_TINT[key]
    if (tint == null || !hairMats.length) return false
    for (const m of hairMats) { m.color.setHex(tint); m.needsUpdate = true }
    return true
  }

  return {
    scene: fbx,
    isMina: true,
    dance,
    garment: garmentKey,
    outfits: Object.keys(garment.colors),
    eyeColors: Object.keys(EYE_TEX),
    hairColors: Object.keys(HAIR_TINT),
    setOutfit, setEyeColor, setHairColor, setNailColor, poseBone,
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
    hairParams,
    groundY,
    bodyHeight,
    frameHeight,
    lookHeight: 1.35,
    gesture,                       // real-mocap body language (talk clip) driven by behavior
    talkClip: DIR + 'Talking.fbx',
    // mixer first: while a clip plays it owns the skeleton; skirt/hair react to it
    update: (dt) => {
      mixer.update(dt); dance.tick(); gesture.tick(); pushArmsOut(); groundFeet()
      // root turn (world yaw): accumulate while dancing, ease home when it ends.
      // Wrapping to the nearest equivalent angle before easing keeps the unwind
      // short and seamless (same orientation, just a smaller number to relax).
      if (dance.busy && !danceStopping) danceTurn += turnRate * dt
      else {
        danceTurn -= 2 * Math.PI * Math.round(danceTurn / (2 * Math.PI))
        danceTurn += (0 - danceTurn) * (1 - Math.exp(-dt * 5))
      }
      if (dance.busy || Math.abs(danceTurn) > 1e-3) fbx.rotation.y = danceTurn
      updateBreast(dt); updateSkirt(dt); updateJacket(dt); updateHair(dt, performance.now() * 0.001)
    },
  }
}
