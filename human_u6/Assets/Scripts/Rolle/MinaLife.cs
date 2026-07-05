using System.Collections.Generic;
using UnityEngine;

namespace OLGTX.Rolle
{
    /// <summary>
    /// The "alive" layer: breathing, weight sway, head micro-drift, blinking,
    /// eye saccades and LLM-driven facial emotions + gaze, layered after the
    /// Animator (mirrors the web version's behavior.js). The face rig uses
    /// ARKit morph names (mouthSmileLeft, browInnerUp, eyeLookOutLeft, ...).
    /// Added at runtime by RolleManager — no scene wiring.
    /// </summary>
    public sealed class MinaLife : MonoBehaviour
    {
        Transform head, neck, chest, spine;

        struct Shape { public SkinnedMeshRenderer r; public int i; public float w; }
        readonly List<Shape> blink = new List<Shape>();
        readonly List<Shape> lookL = new List<Shape>(), lookR = new List<Shape>();
        readonly List<Shape> lookU = new List<Shape>(), lookD = new List<Shape>();
        // audio lipsync: TTS RMS drives jaw + mouth shapes (works on every outfit,
        // unlike the talk clip's path-bound face curves)
        readonly List<Shape> lipJaw = new List<Shape>(), lipFunnel = new List<Shape>(), lipStretch = new List<Shape>();
        AudioSource voice;
        readonly float[] audioBuf = new float[256];
        float lipLevel;
        readonly List<Shape> emoTargets = new List<Shape>();
        readonly Dictionary<(SkinnedMeshRenderer, int), float> emoCurrent = new Dictionary<(SkinnedMeshRenderer, int), float>();
        SkinnedMeshRenderer[] renderers;
        bool scanned;

        float emoIntensity = 1f, emoHoldT;
        float blinkT = 2f, blinkPhase = -1f;
        // gaze: current/target in [-1,1] (x right, y up); saccades when idle,
        // LLM look overrides for a while
        float gx, gy, tx, ty, gazeT = 1.5f, lookHoldT;
        // groove: rhythmic bob/sway while dance music plays (no dance clips yet)
        bool grooveOn; float grooveW;

        // breast jiggle: spring sim per breast bone, driven by chest motion
        class Jiggle
        {
            public Transform bone;
            public Vector3 restLocal;
            public Vector3 simPos, vel;
            public bool primed;
        }
        readonly List<Jiggle> jiggles = new List<Jiggle>();
        const float JIGGLE_STIFF = 320f;   // spring toward the animated rest point
        const float JIGGLE_DAMP = 10f;     // velocity damping
        const float JIGGLE_MAX = 0.03f;    // max world displacement (m)

        // skirt sim (port of the web client's updateSkirt): each skirt bone
        // swings away from leg/hand colliders and springs back — cloth attaches
        // to the surface instead of letting limbs pass through it
        class SkirtLink
        {
            public Transform b;
            public Quaternion restQ;
            public float x, z, vx, vz;          // swing state (radians)
            public Vector3 pv, prevPos;         // smoothed pivot velocity
            public bool primed;
        }
        readonly List<SkirtLink> skirt = new List<SkirtLink>();
        Transform thighL, thighR, calfL, calfR, footL, footR, handL, handR, hips;
        readonly List<(Vector3 p, float r)> colliders = new List<(Vector3, float)>(16);
        float bodyScale = 1f;   // mesh height / 1.7m — keeps radii correct at any import scale

        // ARKit-name recipes (matched lowercase-contains across all face meshes)
        static readonly Dictionary<string, (string key, float w)[]> EMOTIONS = new Dictionary<string, (string, float)[]>
        {
            { "happy",     new[]{ ("mouthsmile", 65f), ("cheeksquint", 25f) } },
            { "laugh",     new[]{ ("mouthsmile", 100f), ("eyesquint", 35f), ("cheeksquint", 45f) } },
            { "sad",       new[]{ ("mouthfrown", 55f), ("browinnerup", 70f) } },
            { "cry",       new[]{ ("mouthfrown", 70f), ("browinnerup", 85f), ("eyesquint", 45f) } },
            { "angry",     new[]{ ("browdown", 85f), ("mouthfrown", 40f), ("nosesneer", 30f) } },
            { "surprised", new[]{ ("browouterup", 70f), ("eyewide", 60f), ("jawopen", 12f) } },
            { "neutral",   new (string, float)[0] },
        };

        void Awake()
        {
            foreach (var t in GetComponentsInChildren<Transform>(true))
            {
                var n = t.name.ToLowerInvariant();
                if (head == null && n.EndsWith("head")) head = t;
                else if (neck == null && n.Contains("neck")) neck = t;
                else if (chest == null && (n.Contains("spine_02") || n.Contains("spine2") || n.Contains("chest"))) chest = t;
                else if (spine == null && (n.Contains("spine_01") || n == "spine")) spine = t;
                if (n.Contains("breast"))
                    jiggles.Add(new Jiggle { bone = t, restLocal = t.localPosition });
                if (n.StartsWith("skirt_") && t.localPosition.sqrMagnitude > 1e-6f)
                    skirt.Add(new SkirtLink { b = t, restQ = t.localRotation });
                if (n == "thigh_l") thighL = t; else if (n == "thigh_r") thighR = t;
                else if (n == "calf_l") calfL = t; else if (n == "calf_r") calfR = t;
                else if (n == "foot_l") footL = t; else if (n == "foot_r") footR = t;
                else if (n == "hand_l") handL = t; else if (n == "hand_r") handR = t;
                else if (hips == null && (n == "pelvis" || n == "hips")) hips = t;
            }
            renderers = GetComponentsInChildren<SkinnedMeshRenderer>(true);
            foreach (var r in renderers)
            {
                var mesh = r.sharedMesh;
                if (mesh == null) continue;
                for (int i = 0; i < mesh.blendShapeCount; i++)
                {
                    var n = mesh.GetBlendShapeName(i).ToLowerInvariant();
                    if (n.Contains("eyeblink")) blink.Add(new Shape { r = r, i = i, w = 100f });
                    if (n.Contains("eyelookoutleft") || n.Contains("eyelookinright")) lookL.Add(new Shape { r = r, i = i, w = 100f });
                    if (n.Contains("eyelookoutright") || n.Contains("eyelookinleft")) lookR.Add(new Shape { r = r, i = i, w = 100f });
                    if (n.Contains("eyelookup")) lookU.Add(new Shape { r = r, i = i, w = 100f });
                    if (n.Contains("eyelookdown")) lookD.Add(new Shape { r = r, i = i, w = 100f });
                    if (n.Contains("jawopen")) lipJaw.Add(new Shape { r = r, i = i, w = 72f });
                    if (n.Contains("mouthfunnel") || n.Contains("mouthpucker")) lipFunnel.Add(new Shape { r = r, i = i, w = 30f });
                    if (n.Contains("mouthstretch")) lipStretch.Add(new Shape { r = r, i = i, w = 25f });
                }
            }
            voice = GetComponent<AudioSource>();
            if (renderers.Length > 0)
            {
                var b = renderers[0].bounds;
                foreach (var r in renderers) b.Encapsulate(r.bounds);
                if (b.size.y > 0.01f) bodyScale = b.size.y / 1.7f;
            }
            scanned = true;
        }

        public void SetEmotion(string name, float intensity, float holdSeconds)
        {
            if (!scanned) return;
            emoTargets.Clear();
            emoIntensity = Mathf.Clamp01(intensity <= 0 ? 0.8f : intensity);
            emoHoldT = holdSeconds <= 0 ? 3.5f : holdSeconds;
            if (!EMOTIONS.TryGetValue(name.ToLowerInvariant(), out var recipe)) return;
            int found = 0;
            foreach (var r in renderers)
            {
                var mesh = r.sharedMesh;
                if (mesh == null) continue;
                for (int i = 0; i < mesh.blendShapeCount; i++)
                {
                    var n = mesh.GetBlendShapeName(i).ToLowerInvariant();
                    foreach (var (key, w) in recipe)
                        if (n.Contains(key)) { emoTargets.Add(new Shape { r = r, i = i, w = w }); found++; break; }
                }
            }
            if (found == 0 && recipe.Length > 0)
                Debug.LogWarning($"MinaLife: emotion '{name}' matched no blendshapes");
        }

        /// <summary>Dance-music groove on/off — eases in/out.</summary>
        public void SetGroove(bool on) => grooveOn = on;

        /// <summary>LLM gaze direction, x/y in [-1,1] (0,0 = back to the user).</summary>
        public void SetLook(float x, float y, float holdSeconds = 2.5f)
        {
            tx = Mathf.Clamp(x, -1f, 1f);
            ty = Mathf.Clamp(y, -1f, 1f);
            lookHoldT = holdSeconds;
            gazeT = holdSeconds;
        }

        static float N(float t, float f) => (Mathf.PerlinNoise(t * f, 0.37f) - 0.5f) * 2f;

        void LateUpdate()
        {
            float t = Time.time, dt = Time.deltaTime;

            // ---- micro-motion: breath + weight sway + head drift, additive
            float breath = Mathf.Sin(t * 1.6f);
            if (spine) spine.localRotation *= Quaternion.Euler(breath * 0.5f, N(t, 0.05f) * 1.2f, N(t + 7f, 0.06f) * 1.0f);
            if (chest) chest.localRotation *= Quaternion.Euler(breath * 1.1f, N(t + 3f, 0.09f) * 1.4f, N(t + 11f, 0.07f) * 1.0f);
            if (neck) neck.localRotation *= Quaternion.Euler(N(t + 5f, 0.11f) * 1.4f, N(t + 2f, 0.13f) * 1.8f, N(t + 9f, 0.08f) * 0.8f);
            if (head) head.localRotation *= Quaternion.Euler(N(t + 13f, 0.17f) * 1.6f, N(t + 17f, 0.15f) * 2.2f, N(t + 19f, 0.12f) * 0.9f);

            // ---- groove: beat bob (~1.8Hz) + slow sway while dance music plays
            grooveW += ((grooveOn ? 1f : 0f) - grooveW) * (1f - Mathf.Exp(-dt * 2f));
            if (grooveW > 0.01f)
            {
                float beat = Mathf.Sin(t * Mathf.PI * 2f * 1.8f);
                float sway = Mathf.Sin(t * Mathf.PI * 2f * 0.9f);
                if (spine) spine.localRotation *= Quaternion.Euler(beat * 2.0f * grooveW, sway * 3.0f * grooveW, sway * 2.0f * grooveW);
                if (chest) chest.localRotation *= Quaternion.Euler(-beat * 1.5f * grooveW, 0f, Mathf.Sin(t * Mathf.PI * 2f * 0.9f + 1f) * 2.5f * grooveW);
                if (head) head.localRotation *= Quaternion.Euler(beat * 2.2f * grooveW, 0f, Mathf.Sin(t * Mathf.PI * 2f * 0.9f + 0.5f) * 1.5f * grooveW);
            }

            // ---- breast jiggle (LAST: reacts to animator + micro-motion + groove
            // this same frame): spring sim toward where the animation put the bone
            float jdt = Mathf.Min(dt, 1f / 30f);   // hitch-safe integration step
            foreach (var j in jiggles)
            {
                if (j.bone == null || j.bone.parent == null) continue;
                Vector3 targetWorld = j.bone.parent.TransformPoint(j.restLocal);
                if (!j.primed) { j.simPos = targetWorld; j.vel = Vector3.zero; j.primed = true; }
                j.simPos += j.vel * jdt;
                j.vel += (targetWorld - j.simPos) * (JIGGLE_STIFF * jdt);
                j.vel *= Mathf.Exp(-JIGGLE_DAMP * jdt);
                Vector3 disp = j.simPos - targetWorld;
                float m = disp.magnitude;
                if (m > JIGGLE_MAX) { disp *= JIGGLE_MAX / m; j.simPos = targetWorld + disp; }
                j.bone.position = j.simPos;
            }

            // ---- gaze: saccades when idle (mostly eye contact), LLM look wins
            if (lookHoldT > 0f) lookHoldT -= dt;
            gazeT -= dt;
            if (gazeT <= 0f && lookHoldT <= 0f)
            {
                gazeT = 0.7f + Random.value * 2.2f;
                if (Random.value < 0.65f) { tx = 0f; ty = 0f; }                    // back to the user
                else { tx = (Random.value * 2f - 1f) * 0.45f; ty = (Random.value * 2f - 1f) * 0.25f; }
            }
            float gk = 1f - Mathf.Exp(-dt * 9f);                                    // saccade-fast ease
            gx += (tx - gx) * gk;
            gy += (ty - gy) * gk;
            foreach (var s in lookR) s.r.SetBlendShapeWeight(s.i, Mathf.Max(0f, gx) * s.w);
            foreach (var s in lookL) s.r.SetBlendShapeWeight(s.i, Mathf.Max(0f, -gx) * s.w);
            foreach (var s in lookU) s.r.SetBlendShapeWeight(s.i, Mathf.Max(0f, gy) * s.w);
            foreach (var s in lookD) s.r.SetBlendShapeWeight(s.i, Mathf.Max(0f, -gy) * s.w);

            // ---- lipsync: her own voice's RMS opens the jaw (fast attack,
            // slower release), light funnel/stretch shimmer for viseme variety
            float lipTarget = 0f;
            if (voice != null && voice.isPlaying && voice.clip != null)
            {
                voice.GetOutputData(audioBuf, 0);
                float sum = 0f;
                for (int i = 0; i < audioBuf.Length; i++) sum += audioBuf[i] * audioBuf[i];
                lipTarget = Mathf.Clamp01(Mathf.Sqrt(sum / audioBuf.Length) * 9f);
            }
            lipLevel += (lipTarget - lipLevel) * (1f - Mathf.Exp(-dt * (lipTarget > lipLevel ? 28f : 14f)));
            float shimmerA = 0.5f + 0.5f * Mathf.Sin(t * 11f);
            foreach (var s in lipJaw) s.r.SetBlendShapeWeight(s.i, lipLevel * s.w);
            foreach (var s in lipFunnel) s.r.SetBlendShapeWeight(s.i, lipLevel * shimmerA * s.w);
            foreach (var s in lipStretch) s.r.SetBlendShapeWeight(s.i, lipLevel * (1f - shimmerA) * s.w);

            // ---- blink: quick close/open every 2-6s
            if (blinkPhase < 0f)
            {
                blinkT -= dt;
                if (blinkT <= 0f) blinkPhase = 0f;
            }
            else
            {
                blinkPhase += dt;
                const float DOWN = 0.07f, UP = 0.12f;
                float v = blinkPhase < DOWN ? blinkPhase / DOWN
                        : blinkPhase < DOWN + UP ? 1f - (blinkPhase - DOWN) / UP : -1f;
                if (v < 0f) { blinkPhase = -1f; blinkT = 2f + Random.value * 4f; v = 0f; }
                foreach (var s in blink) s.r.SetBlendShapeWeight(s.i, v * s.w);
            }

            // ---- emotion blendshapes: ease toward targets, decay after hold
            if (emoHoldT > 0f) emoHoldT -= dt;
            float k = 1f - Mathf.Exp(-dt * 5f);
            var live = new HashSet<(SkinnedMeshRenderer, int)>();
            if (emoHoldT > 0f)
                foreach (var s in emoTargets)
                {
                    var id = (s.r, s.i);
                    live.Add(id);
                    emoCurrent.TryGetValue(id, out float cur);
                    cur += (s.w * emoIntensity - cur) * k;
                    emoCurrent[id] = cur;
                    s.r.SetBlendShapeWeight(s.i, cur);
                }
            var keys = new List<(SkinnedMeshRenderer, int)>(emoCurrent.Keys);
            foreach (var id in keys)
            {
                if (live.Contains(id)) continue;
                float cur = emoCurrent[id] * (1f - k);
                if (cur < 0.5f) { emoCurrent.Remove(id); cur = 0f; }
                else emoCurrent[id] = cur;
                id.Item1.SetBlendShapeWeight(id.Item2, cur);
            }

            // ---- skirt: swing panels away from legs/hands, spring back (LAST,
            // so it reacts to the final pose of this frame)
            if (skirt.Count > 0) UpdateSkirt(Mathf.Clamp(dt, 1f / 120f, 1f / 20f));
        }

        static void Seg(List<(Vector3, float)> list, Transform a, Transform b, float r)
        {
            if (a == null || b == null) return;
            Vector3 pa = a.position, pb = b.position;
            list.Add((Vector3.Lerp(pa, pb, 0.25f), r));
            list.Add((Vector3.Lerp(pa, pb, 0.5f), r));
            list.Add((Vector3.Lerp(pa, pb, 0.75f), r));
        }

        void UpdateSkirt(float dt)
        {
            // gravity = the authored hanging drape (restQ): the spring always
            // pulls back to it; colliders only deflect on REAL penetration
            float S = bodyScale;
            colliders.Clear();
            if (handL != null) colliders.Add((handL.position, 0.09f * S));
            if (handR != null) colliders.Add((handR.position, 0.09f * S));
            Seg(colliders, thighL, calfL, 0.068f * S);
            Seg(colliders, thighR, calfR, 0.068f * S);
            Seg(colliders, calfL, footL, 0.055f * S);
            Seg(colliders, calfR, footR, 0.055f * S);
            Vector3 hipsP = hips != null ? hips.position : transform.position;

            foreach (var s in skirt)
            {
                Vector3 bp = s.b.position;
                // inertia: gentle, heavily smoothed — swish, not shiver
                if (!s.primed) { s.prevPos = bp; s.primed = true; }
                s.pv += ((bp - s.prevPos) / dt - s.pv) * 0.15f;
                s.prevPos = bp;
                float tx = -s.pv.x * 0.22f / S, tz = -s.pv.z * 0.22f / S;
                if (Mathf.Abs(tx) < 0.02f) tx = 0f;      // deadzone: micro-motion
                if (Mathf.Abs(tz) < 0.02f) tz = 0f;      // never rattles the cloth

                bp.y -= 0.08f * S;   // test mid-panel, not the pivot
                foreach (var (cp, cr) in colliders)
                {
                    Vector3 d = bp - cp;
                    float overlap = cr - d.magnitude;
                    if (overlap <= 0f) continue;
                    float hl = Mathf.Max(1e-4f, new Vector2(d.x, d.z).magnitude);
                    float push = overlap / S * 5f;
                    tx += d.x / hl * push;
                    tz += d.z / hl * push;
                }

                // soft cloth: low stiffness, high damping — settles, never rings
                s.vx += (tx - s.x) * 26f * dt;
                s.vz += (tz - s.z) * 26f * dt;
                float damp = Mathf.Exp(-16f * dt);
                s.vx *= damp; s.vz *= damp;
                s.x += s.vx; s.z += s.vz;

                // never swing INTO the body: strip the inward (toward hip axis) part
                float rx = bp.x - hipsP.x, rz = bp.z - hipsP.z;
                float rl = Mathf.Max(1e-4f, Mathf.Sqrt(rx * rx + rz * rz));
                float inward = -(s.x * rx + s.z * rz) / rl;
                if (inward > 0f) { s.x += rx / rl * inward * 0.9f; s.z += rz / rl * inward * 0.9f; }

                float ang = Mathf.Min(0.6f, Mathf.Sqrt(s.x * s.x + s.z * s.z));
                if (ang > 0.01f)
                {
                    var axis = new Vector3(-s.z, 0f, s.x).normalized;   // cross(down, push)
                    var pq = s.b.parent.rotation;
                    s.b.localRotation = Quaternion.Inverse(pq)
                        * Quaternion.AngleAxis(ang * Mathf.Rad2Deg, axis) * pq * s.restQ;
                }
                else s.b.localRotation = s.restQ;
            }
        }
    }
}
