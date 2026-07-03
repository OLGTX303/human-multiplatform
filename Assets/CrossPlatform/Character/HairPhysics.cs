// Verlet bone-chain physics for hair, skirts and any dangling accessory.
// Chosen over Unity Cloth (needs a dedicated sim mesh this model doesn't have)
// and Dynamic Bones (paid asset): a verlet chain over the existing bones is
// the fastest high-quality option and preserves the authored look exactly —
// the skinned mesh, layers, colors and textures are untouched; only the bones
// the mesh is already weighted to are simulated.
//
// Setup: add to the character root, assign chain roots (e.g. every
// hair_*_01_* bone, skirt_*_01_* bone). Head/shoulder/spine colliders are
// auto-created from the Animator's Humanoid bones; add extra SphereColliderDefs
// for tight fits. All tuning lives in the Inspector.
using System.Collections.Generic;
using UnityEngine;

namespace LKZ.CrossPlatform.Character
{
    public sealed class HairPhysics : MonoBehaviour
    {
        [Header("Chains")]
        [Tooltip("Root bone of each strand/panel. All child bones become the chain.")]
        public Transform[] chainRoots;

        [Header("Dynamics")]
        [Range(0f, 1f)] public float stiffness = 0.15f;   // pull back to the authored pose
        [Range(0f, 1f)] public float damping = 0.12f;     // velocity kill per step
        public float mass = 1f;                            // scales acceleration response
        public float gravityMultiplier = 1f;               // 1 = real gravity
        public Vector3 wind;                               // world-space, m/s (animate for gusts)
        [Tooltip("Extra sim steps per frame for fast motion. 2 is enough at 60fps.")]
        [Range(1, 4)] public int substeps = 2;

        [Header("Collision")]
        public float defaultCollisionRadius = 0.03f;       // per-particle radius
        public bool autoBodyColliders = true;              // head/neck/shoulders/chest from Humanoid
        public SphereColliderDef[] extraColliders;

        [System.Serializable]
        public struct SphereColliderDef
        {
            public Transform bone;
            public float radius;
            public Vector3 offset;                         // local to bone
        }

        sealed class Particle
        {
            public Transform bone;
            public Vector3 pos, prevPos;                   // world
            public float boneLength;                       // to parent particle
            public Quaternion restLocalRot;
            public Vector3 restLocalPos;
        }

        sealed class Chain { public List<Particle> particles = new List<Particle>(); }

        readonly List<Chain> _chains = new List<Chain>();
        readonly List<SphereColliderDef> _colliders = new List<SphereColliderDef>();
        Vector3 _lastRootPos;
        const float TeleportThreshold = 1.5f;              // m/frame → snap, don't fling

        void Start()
        {
            foreach (var root in chainRoots)
                if (root != null) BuildChain(root);

            if (autoBodyColliders) BuildBodyColliders();
            if (extraColliders != null) _colliders.AddRange(extraColliders);
            _lastRootPos = transform.position;
        }

        void BuildChain(Transform root)
        {
            var chain = new Chain();
            for (var t = root; t != null; t = t.childCount > 0 ? t.GetChild(0) : null)
            {
                chain.particles.Add(new Particle
                {
                    bone = t,
                    pos = t.position,
                    prevPos = t.position,
                    restLocalRot = t.localRotation,
                    restLocalPos = t.localPosition,
                    boneLength = t.parent != null ? Vector3.Distance(t.position, t.parent.position) : 0f,
                });
                if (t.childCount == 0) break;
            }
            if (chain.particles.Count > 1) _chains.Add(chain);
        }

        void BuildBodyColliders()
        {
            var anim = GetComponentInChildren<Animator>();
            if (anim == null || !anim.isHuman) return;
            void Add(HumanBodyBones b, float r, Vector3 off = default)
            {
                var t = anim.GetBoneTransform(b);
                if (t != null) _colliders.Add(new SphereColliderDef { bone = t, radius = r, offset = off });
            }
            float s = transform.lossyScale.y;              // scale-aware radii
            Add(HumanBodyBones.Head, 0.11f * s);
            Add(HumanBodyBones.Neck, 0.06f * s);
            Add(HumanBodyBones.LeftShoulder, 0.07f * s);
            Add(HumanBodyBones.RightShoulder, 0.07f * s);
            Add(HumanBodyBones.Chest, 0.13f * s);
            Add(HumanBodyBones.Hips, 0.13f * s);
            Add(HumanBodyBones.LeftUpperLeg, 0.09f * s, new Vector3(0, -0.2f, 0));
            Add(HumanBodyBones.RightUpperLeg, 0.09f * s, new Vector3(0, -0.2f, 0));
        }

        // LateUpdate: after Animator writes the pose, so head motion drives hair
        void LateUpdate()
        {
            float dt = Time.deltaTime;
            if (dt <= 0f) return;

            // teleport guard: on respawn/vehicle-exit don't whip the hair across the map
            Vector3 rootDelta = transform.position - _lastRootPos;
            bool teleported = rootDelta.sqrMagnitude > TeleportThreshold * TeleportThreshold;
            _lastRootPos = transform.position;

            float stepDt = dt / substeps;
            Vector3 g = Physics.gravity * gravityMultiplier / Mathf.Max(0.01f, mass);

            foreach (var chain in _chains)
            {
                // root particle is kinematic: welded to the scalp/waist anchor
                var rootP = chain.particles[0];
                rootP.pos = rootP.prevPos = rootP.bone.position;

                for (int step = 0; step < substeps; step++)
                {
                    for (int i = 1; i < chain.particles.Count; i++)
                    {
                        var p = chain.particles[i];
                        var parent = chain.particles[i - 1];

                        if (teleported) { p.pos = p.prevPos = p.bone.position; continue; }

                        // verlet integrate with gravity + wind
                        Vector3 vel = (p.pos - p.prevPos) * (1f - damping);
                        p.prevPos = p.pos;
                        p.pos += vel + (g + wind / Mathf.Max(0.01f, mass)) * (stepDt * stepDt);

                        // stiffness: spring toward where the authored pose puts this bone
                        Vector3 target = parent.bone.TransformPoint(p.restLocalPos);
                        p.pos = Vector3.Lerp(p.pos, target, stiffness);

                        // distance constraint: bones never stretch
                        Vector3 toParent = p.pos - parent.pos;
                        float len = toParent.magnitude;
                        if (len > 1e-6f) p.pos = parent.pos + toParent * (p.boneLength / len);

                        // sphere collision: push out of head/body
                        for (int c = 0; c < _colliders.Count; c++)
                        {
                            var col = _colliders[c];
                            if (col.bone == null) continue;
                            Vector3 center = col.bone.TransformPoint(col.offset);
                            float r = col.radius + defaultCollisionRadius;
                            Vector3 d = p.pos - center;
                            float dist = d.magnitude;
                            if (dist < r && dist > 1e-6f) p.pos = center + d * (r / dist);
                        }
                    }
                }

                // write back: rotate each bone so its child sits at the solved position
                for (int i = 0; i < chain.particles.Count - 1; i++)
                {
                    var p = chain.particles[i];
                    var child = chain.particles[i + 1];
                    p.bone.localRotation = p.restLocalRot;
                    Vector3 restDir = p.bone.TransformDirection(child.restLocalPos.normalized);
                    Vector3 solvedDir = (child.pos - p.bone.position).normalized;
                    if (restDir.sqrMagnitude > 1e-8f && solvedDir.sqrMagnitude > 1e-8f)
                        p.bone.rotation = Quaternion.FromToRotation(restDir, solvedDir) * p.bone.rotation;
                }
                // sync particle positions to final bone positions for next frame
                foreach (var p in chain.particles) p.pos = p.bone.position;
            }
        }
    }
}
