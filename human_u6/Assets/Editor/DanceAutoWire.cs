using System.IO;
using UnityEditor;
using UnityEditor.Animations;
using UnityEngine;

/// <summary>
/// Wires the Mixamo dance FBXs in Assets/Animations/Dance into the 8 empty
/// dance states of Rolle_Cointrol. Runs automatically after compile (and can
/// be re-run from the OLGTX menu). Imports each FBX as Humanoid with a looping
/// clip named "Dance_*" (the runtime dance-availability check looks for that).
/// </summary>
[InitializeOnLoad]
public static class DanceAutoWire
{
    const string DIR = "Assets/Animations/Dance";
    const string CONTROLLER = "Assets/AnimationControls/Rolle_Cointrol.controller";

    // dance int (see RolleManager.DanceOrder) -> clip file. Only 7 files were
    // provided; 'art' (5) shares boom's Hip Hop clip.
    static readonly (int idx, string file)[] MAP =
    {
        (1, "X Bot@Northern Soul Spin Combo.fbx"),  // kemusan
        (2, "X Bot@Thriller Part 2.fbx"),           // ghost
        (3, "X Bot@Robot Hip Hop Dance.fbx"),       // tech
        (4, "X Bot@Rumba Dancing.fbx"),             // welcome
        (5, "X Bot@Hip Hop Dancing.fbx"),           // art
        (6, "X Bot@Hip Hop Dancing.fbx"),           // boom
        (7, "X Bot@Snake Hip Hop Dance.fbx"),       // fairy
        (8, "X Bot@Gangnam Style.fbx"),             // king
    };

    static DanceAutoWire()
    {
        EditorApplication.delayCall += Wire;
    }

    [MenuItem("OLGTX/Wire Dance Clips")]
    public static void Wire()
    {
        if (EditorApplication.isPlayingOrWillChangePlaymode)
        {
            EditorApplication.delayCall += Wire;   // wait for edit mode
            return;
        }
        if (!Directory.Exists(DIR)) return;

        // ---- 1) import every dance FBX as Humanoid with a looping clip
        foreach (var raw in Directory.GetFiles(DIR, "*.fbx"))
        {
            var path = raw.Replace('\\', '/');
            var mi = AssetImporter.GetAtPath(path) as ModelImporter;
            if (mi == null) { AssetDatabase.ImportAsset(path); mi = AssetImporter.GetAtPath(path) as ModelImporter; }
            if (mi == null) continue;

            string clipName = "Dance_" + Path.GetFileNameWithoutExtension(path).Replace("X Bot@", "").Replace(" ", "");
            bool dirty = false;
            if (mi.animationType != ModelImporterAnimationType.Human)
            {
                mi.animationType = ModelImporterAnimationType.Human;
                mi.avatarSetup = ModelImporterAvatarSetup.CreateFromThisModel;
                dirty = true;
            }
            var existing = mi.clipAnimations;
            if (existing == null || existing.Length == 0 || existing[0].name != clipName
                || existing[0].lockRootPositionXZ || existing[0].lockRootRotation)
            {
                var clips = mi.defaultClipAnimations;
                foreach (var c in clips)
                {
                    c.name = clipName;
                    c.loopTime = true;
                    // IN PLACE: travel/turn must stay ROOT motion (bake-into-pose
                    // OFF) — root motion is discarded at runtime, so she stays
                    // put while the body dances. Only vertical bounce is baked
                    // into the pose so jumps/crouches still read.
                    c.lockRootRotation = false;
                    c.lockRootPositionXZ = false;
                    c.lockRootHeightY = true;
                    c.keepOriginalPositionY = true;
                }
                mi.clipAnimations = clips;
                dirty = true;
            }
            if (dirty) mi.SaveAndReimport();
        }

        // ---- 2) assign clips to the dance states (found via their dance==N transitions)
        var ctrl = AssetDatabase.LoadAssetAtPath<AnimatorController>(CONTROLLER);
        if (ctrl == null) { Debug.LogWarning("DanceAutoWire: controller not found at " + CONTROLLER); return; }

        bool changed = false;
        var sm = ctrl.layers[0].stateMachine;

        void TryAssign(AnimatorStateTransition t)
        {
            if (t.destinationState == null) return;
            foreach (var cond in t.conditions)
            {
                if (cond.parameter != "dance" || cond.mode != AnimatorConditionMode.Equals) continue;
                int thr = (int)cond.threshold;
                foreach (var (idx, file) in MAP)
                {
                    if (idx != thr) continue;
                    if (t.destinationState.motion != null) continue;   // keep existing clips
                    var clip = AssetDatabase.LoadAssetAtPath<AnimationClip>($"{DIR}/{file}");
                    if (clip == null) { Debug.LogWarning($"DanceAutoWire: clip missing for dance {thr}: {file}"); continue; }
                    t.destinationState.motion = clip;
                    changed = true;
                    Debug.Log($"DanceAutoWire: dance {thr} -> {t.destinationState.name} = {clip.name}");
                }
            }
        }

        foreach (var t in sm.anyStateTransitions) TryAssign(t);
        foreach (var child in sm.states)
            foreach (var t in child.state.transitions) TryAssign(t);

        if (changed)
        {
            EditorUtility.SetDirty(ctrl);
            AssetDatabase.SaveAssets();
            Debug.Log("DanceAutoWire: dance clips wired ✔");
        }
    }
}
