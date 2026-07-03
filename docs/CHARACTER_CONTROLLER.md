# Character Controller & Hair Physics — setup guide

Scripts live in `Assets/CrossPlatform/Character/`. No package dependencies;
the new Input System is used automatically when the project enables it
(`ENABLE_INPUT_SYSTEM`), legacy axes otherwise.

## Prefab structure

```
MinaCharacter (root)
├─ CharacterController (capsule: height 1.75, radius 0.3, center y 0.875)
├─ ThirdPersonController        ← movement + state machine
├─ HairPhysics                  ← chainRoots = hair_*_01_*, skirt_*_01_* bones
├─ CameraPivot (empty, y ≈ 1.4)
└─ Model (the KPOP_Mina FBX instance)
   ├─ Animator (Humanoid avatar, IK Pass ON for Base Layer)
   └─ CharacterAnimationDriver  ← on the same GameObject as the Animator
Main Camera
└─ ThirdPersonCamera (target = CameraPivot)   — or a Cinemachine 3rd-person vcam
```

## Model import
1. Import the Mina FBX with **Rig → Humanoid** and let Unity generate the
   avatar (required for foot/hand/look IK). Verify the bone map — `pelvis`,
   `spine_01..03`, `clavicle_*`, `upperarm/lowerarm/hand`, `thigh/calf/foot`
   auto-map cleanly on this skeleton.
2. Hair/skirt bones stay outside the Humanoid map — that's correct; the
   HairPhysics verlet sim owns them. Assign every `hair_front/back_*_01_*` and
   `skirt_*_01_*` bone to `chainRoots` (the whole child chain is simulated).
   The mesh, materials and textures are untouched, so the look is preserved
   exactly.

## Animator (blend tree)
Parameters the driver writes: `Speed` (float, damped), `Grounded` (bool),
`Crouch` (bool), `Slide` (bool), `Jump` (trigger).

Base layer: a 1D blend tree on `Speed` — Idle (0) → Walk (2) → Run (4.5) →
Sprint (7). Add Crouch/Slide/Jump/Fall states switched by the bools/trigger.
This repo ships no animation clips; use any Humanoid locomotion set (e.g.
Unity Starter Assets, Mixamo) — Humanoid retargeting makes them fit Mina
without touching the model.

**Actions (aim/shoot/reload/melee/vault/swim/vehicle):** the controller
exposes `TrySetAction()` / `ReleaseAction()` to reserve the body, and the
driver exposes hand-IK targets + `aiming`/`aimPitch` for ADS spine twist.
Wire each action as an Animator state or timeline that calls these — building
them without the actual clips would just be dead code.

## Hair physics tuning (Inspector, all hot-reloadable)
| Parameter | Meaning | Start point |
|---|---|---|
| stiffness | pull toward authored style; higher = tamer | 0.15 hair / 0.3 skirt |
| damping | motion decay; lower = swingier | 0.12 |
| mass | inertia scale | 1 |
| gravityMultiplier | 1 = real gravity sag | 1 |
| wind | world m/s vector — animate for gusts | (0,0,0) |
| substeps | raise to 3–4 if strands lag at high speeds | 2 |
| defaultCollisionRadius | per-particle skin clearance | 0.03 |

Colliders: head/neck/shoulders/chest/hips/thigh spheres are auto-built from
the Humanoid avatar (scale-aware). Add `extraColliders` for tight spots.

## Edge cases handled
- **Teleport/respawn**: root jumps > 1.5 m/frame snap the sim instead of
  whipping strands across the map.
- **Fast movement**: substepping + the distance constraint keep chains stable
  at sprint speed; raise `substeps` before touching stiffness.
- **Scale**: collider radii and gravity respond to `lossyScale`, so a 0.5×
  or 2× character keeps proportional hair behavior.
- **Slopes**: foot IK raycasts plant each foot and tilt it to the surface
  normal; `Speed` damping (0.08 s) keeps blend transitions smooth.

## Performance
Verlet chains are O(bones × substeps): Mina's ~35 simulated bones × 2
substeps ≈ 0.05 ms/frame on mid-range hardware — far under the 60 FPS
budget. Foot IK adds two raycasts per frame.
