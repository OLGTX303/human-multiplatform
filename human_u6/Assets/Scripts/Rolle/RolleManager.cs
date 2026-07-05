using OLGTX.Commands.Chat;
using OLGTX.Commands.Voice;
using OLGTX.DependencyInject;
using OLGTX.TypeEventSystem;
using System;
using System.Collections;
using UnityEngine;

namespace OLGTX.Rolle
{
    public interface IRolleManager
    {
        public int RolleCount { get; }
        public int CurrentIndex { get; }

    }

    public interface IRollePosition
    {
        public Vector3 Position { get; }

        /// <summary>
        /// 角色显示的位置
        /// </summary>
        public Vector3 RolleShowPosition { get; }
    }

    public sealed class RolleManager : MonoBehaviour, IRolleManager, IRollePosition, IDRegisterBindingInterface, DIAwakeInterface
    { 
        [SerializeField]
        private Vector3 rolleMiddlePos; 

        [SerializeField]
        private GameObject[] RolleGames;

        public float switchRolleSpeed = 1f;

        private RolleControl[] RolleControls;

        private int rolleIndex = 0;

        [Inject]
        private IRegisterCommand RegisterCommand { get; set; }


        public AudioSource AudioSource => RolleControls[rolleIndex].AudioSource;

        public int RolleCount => RolleControls.Length;

        public int CurrentIndex => rolleIndex;

        public Vector3 Position => RolleControls[rolleIndex].transform.position;

        public Vector3 RolleShowPosition => rolleMiddlePos;
          

        public float switchDancePosResetSpeed = 2f;


        static readonly Quaternion defaultRotation = Quaternion.Euler(0, 180, 0);
        public void OnAwake()
        {
            Instance = this;
            // roster = scene-assigned rolles (casual) + the performance outfit
            // loaded from Resources — no scene wiring needed
            var games = new System.Collections.Generic.List<GameObject>(RolleGames);
            var perf = Resources.Load<GameObject>("Outfits/SK_MINA_PERFORMANCE_01_with_bones_in_skirt Variant 1");
            if (perf != null) games.Add(perf);

            var controls = new System.Collections.Generic.List<RolleControl>();
            float refHeight = 0;
            foreach (var g in games)
            {
                var go = Instantiate(g, this.rolleMiddlePos, Quaternion.Euler(0, 180, 0), base.transform);
                var rc = go.GetComponent<RolleControl>();
                if (rc == null) rc = go.AddComponent<RolleControl>();          // Resources-loaded outfit prefab
                if (go.GetComponent<AudioSource>() == null) go.AddComponent<AudioSource>();
                var anim = go.GetComponent<Animator>();
                if (anim != null && anim.runtimeAnimatorController == null && controls.Count > 0)
                    anim.runtimeAnimatorController = controls[0].GetComponent<Animator>().runtimeAnimatorController;
                if (anim != null) anim.applyRootMotion = false;   // clips never move her
                go.AddComponent<MinaLife>();   // micro-motion + blink + emotions
                // the outfit FBXs are authored at different unit scales — normalise
                // every rolle to the first one's measured mesh height
                float h = MeshHeight(go);
                if (controls.Count == 0) refHeight = h;
                else if (h > 0.01f && refHeight > 0.01f)
                    go.transform.localScale *= refHeight / h;
                rc.RolleDisable();
                controls.Add(rc);
            }
            RolleControls = controls.ToArray();

            RolleControls[0].RolleEnable();
            ApplyOutfitMaterial(FilmMaterial());   // film texture is the default look

            // the free source drop ships the 8 dance STATES but not their motion
            // clips — entering an empty state freezes the pose. Only allow dance
            // if actual dance clips exist in the controller.
            var ctrl = RolleControls[0].GetComponent<Animator>()?.runtimeAnimatorController;
            if (ctrl != null)
                foreach (var clip in ctrl.animationClips)
                    if (clip != null && (clip.name.ToLowerInvariant().Contains("dance") ||
                                         clip.name.ToLowerInvariant().Contains("rhythm") ||
                                         clip.name.ToLowerInvariant().Contains("moonwalk")))
                    { dancesAvailable = true; break; }
            if (!dancesAvailable) Debug.Log("[Mina] dance clips missing from this project — dance requests will be ignored");

            RegisterCommand.Register<ChatGPTStartTalkCommand>(ChatGPTStartTalkCommandCallback);
            RegisterCommand.Register<SettingVoiceRecognitionCommand>(SettingVoiceRecognitionCommandCallback);

            OLGTX.GPT.LLM.OnControl += ApplyControl;   // LLM drives body/appearance
        }

        private void OnDestroy()
        {
            OLGTX.GPT.LLM.OnControl -= ApplyControl;
        }

        // ---- LLM <control> dispatcher: same fields the web client honours
        private static readonly string[] DanceOrder =
            { "kemusan", "ghost", "tech", "welcome", "art", "boom", "fairy", "king" };

        // ---- dance music from the sample's own CDN (found via the shipped
        // DanceVoiceConfig.asset; same tracks the web client uses). 6 tracks
        // cover 8 dances — mapping mirrors the web version.
        private const string DANCE_CDN = "https://unity.qny.lkz.fit/digital/dance_voice/";
        private static readonly string[] DanceMusic =
            { "ke_mu_san.mp3", "1.mp3", "2.mp3", "3.mp3", "4.mp3", "5.mp3", "3.mp3", "5.mp3" };
        private AudioSource musicSource;
        private Coroutine musicCor;
        private readonly System.Collections.Generic.Dictionary<string, AudioClip> musicCache =
            new System.Collections.Generic.Dictionary<string, AudioClip>();

        private void StartDance(int idx)   // 1..8
        {
            dancing = idx;
            if (dancesAvailable) RolleControls[rolleIndex].SetDanceAnimation(idx);   // real clip when present
            RolleControls[rolleIndex].GetComponent<MinaLife>()?.SetGroove(true);     // groove regardless
            if (musicCor != null) StopCoroutine(musicCor);
            musicCor = StartCoroutine(PlayMusic(DanceMusic[idx - 1]));
        }

        private void StopDance()
        {
            dancing = 0;
            RolleControls[rolleIndex].SetDanceAnimation(0);
            RolleControls[rolleIndex].GetComponent<MinaLife>()?.SetGroove(false);
            if (musicCor != null) { StopCoroutine(musicCor); musicCor = null; }
            if (musicSource != null) musicSource.Stop();
        }

        private IEnumerator PlayMusic(string file)
        {
            if (musicSource == null)
            {
                musicSource = gameObject.AddComponent<AudioSource>();
                musicSource.loop = true;
                musicSource.volume = 0.5f;
            }
            if (!musicCache.TryGetValue(file, out var clip) || clip == null)
            {
                using (var req = UnityEngine.Networking.UnityWebRequestMultimedia.GetAudioClip(DANCE_CDN + file, AudioType.MPEG))
                {
                    yield return req.SendWebRequest();
                    if (!string.IsNullOrEmpty(req.error)) { Debug.LogWarning("dance music: " + req.error); yield break; }
                    clip = UnityEngine.Networking.DownloadHandlerAudioClip.GetContent(req);
                    musicCache[file] = clip;
                }
            }
            if (dancing == 0) yield break;    // stopped while downloading
            musicSource.clip = clip;
            musicSource.Play();
            musicCor = null;
        }

        private void ApplyControl(string json)
        {
            Newtonsoft.Json.Linq.JObject c;
            try { c = Newtonsoft.Json.Linq.JObject.Parse(json); } catch { return; }

            var emo = (string)c["emotion"];
            if (!string.IsNullOrEmpty(emo))
                RolleControls[rolleIndex].GetComponent<MinaLife>()?.SetEmotion(
                    emo, (float?)c["intensity"] ?? 0.8f, (float?)c["hold"] ?? 4f);

            var dance = (string)c["dance"];
            if (!string.IsNullOrEmpty(dance))
            {
                if (dance == "stop") StopDance();
                else
                {
                    int idx = System.Array.IndexOf(DanceOrder, dance.ToLowerInvariant()) + 1;
                    StartDance(idx > 0 ? idx : 1);   // CDN music + groove (+ clip when installed)
                }
            }

            var garment = (string)c["garment"];
            if (!string.IsNullOrEmpty(garment))
                SwitchOutfit(garment.ToLowerInvariant().StartsWith("perf") ? 1 : 0);

            var dress = (string)c["dress"];
            if (!string.IsNullOrEmpty(dress)) ApplyOutfitColor(Cap(dress));

            var hair = (string)c["hair"];
            if (!string.IsNullOrEmpty(hair))
            {
                if (hair.ToLowerInvariant() == "blonde") hair = "Beige";   // closest available
                ApplySlotMaterial("HAIR", Resources.Load<Material>("Outfits/MAT_MINA_HAIR_" + Cap(hair)));
            }

            var eye = (string)c["eye"];
            if (!string.IsNullOrEmpty(eye))
                ApplySlotMaterial("EYES", Resources.Load<Material>("Outfits/MAT_MINA_EYES_" + Cap(eye)));

            var action = (string)c["action"];
            if (action == "wave" || action == "heart") RolleControls[rolleIndex].TriggerSaluteAnimation();

            var look = c["look"] as Newtonsoft.Json.Linq.JArray;
            if (look != null && look.Count >= 2)
                RolleControls[rolleIndex].GetComponent<MinaLife>()?.SetLook((float)look[0], (float)look[1]);
        }

        /// <summary>
        /// Keyword fallback so she reacts to what she SAYS even when the LLM
        /// omits the control block (mirrors the web version's cueSentence).
        /// Called by LLMLogic for every sentence sent to TTS.
        /// </summary>
        public void CueSentence(string s)
        {
            var life = RolleControls[rolleIndex].GetComponent<MinaLife>();
            if (life == null || string.IsNullOrEmpty(s)) return;
            if (System.Text.RegularExpressions.Regex.IsMatch(s, @"haha|lol|hilarious|so funny|joke", System.Text.RegularExpressions.RegexOptions.IgnoreCase))
                life.SetEmotion("laugh", 0.9f, 3f);
            else if (System.Text.RegularExpressions.Regex.IsMatch(s, @"i'?m sorry|so sad|sadly|unfortunately|terrible|miss(ed)? you|lonely", System.Text.RegularExpressions.RegexOptions.IgnoreCase))
                life.SetEmotion("sad", 0.8f, 3.5f);
            else if (System.Text.RegularExpressions.Regex.IsMatch(s, @"outrageous|unacceptable|angry|annoying|\bugh\b", System.Text.RegularExpressions.RegexOptions.IgnoreCase))
                life.SetEmotion("angry", 0.7f, 3f);
            else if (System.Text.RegularExpressions.Regex.IsMatch(s, @"wow|amazing|incredible|unbelievable|really\?|no way|can'?t believe", System.Text.RegularExpressions.RegexOptions.IgnoreCase))
                life.SetEmotion("surprised", 0.8f, 2.5f);
            else if (System.Text.RegularExpressions.Regex.IsMatch(s, @"love|great|awesome|glad|happy|excited|yay|nice to|[!]", System.Text.RegularExpressions.RegexOptions.IgnoreCase))
                life.SetEmotion("happy", 0.7f, 3f);
        }

        public static RolleManager Instance { get; private set; }

        private static string Cap(string s) =>
            string.IsNullOrEmpty(s) ? s : char.ToUpperInvariant(s[0]) + s.Substring(1).ToLowerInvariant();

        public float PlaySaluteAnimationDelay = 1f;
        private IEnumerator Start()
        {
            yield return new WaitForSeconds(PlaySaluteAnimationDelay);
            RolleControls[0].TriggerSaluteAnimation();
        }

         
        void IDRegisterBindingInterface.DIRegisterBinding(IRegisterBinding registerBinding)
        {
            registerBinding.Binding<IRolleManager>().To(this);
            registerBinding.Binding<IRollePosition>().To(this);
        }

        private bool isSwitch;
          
        private void SettingVoiceRecognitionCommandCallback(SettingVoiceRecognitionCommand obj)
        {
            if (obj.IsStartVoiceRecognition)
                RolleControls[this.rolleIndex].SetAnimationTalk(false);
        }

        private void ChatGPTStartTalkCommandCallback(ChatGPTStartTalkCommand obj)
        {
            RolleControls[this.rolleIndex].SetAnimationTalk(true);
        }

        private static float MeshHeight(GameObject g)
        {
            var rs = g.GetComponentsInChildren<SkinnedMeshRenderer>(true);
            if (rs.Length == 0) return 0;
            var b = rs[0].bounds;
            foreach (var r in rs) b.Encapsulate(r.bounds);
            return b.size.y;
        }

        // ---- outfit / colour: swap the outfit renderer's materials at runtime.
        // Colour mats live in Resources/Outfits; "Film" is the White mat cloned
        // with the film base-colour texture (the web version's default look).
        private Material _filmMat;
        private bool IsPerformance => rolleIndex == 1;

        private Material FilmMaterial()
        {
            if (_filmMat == null)
            {
                var src = Resources.Load<Material>("Outfits/MAT_MINA_CASUAL_White");
                var tex = Resources.Load<Texture2D>("Outfits/T_MINA_CASUAL_BaseColor_Film4096");
                if (src == null || tex == null) return null;
                _filmMat = new Material(src) { name = "MAT_MINA_CASUAL_Film" };
                _filmMat.SetTexture("_BaseMap", tex);
                _filmMat.SetTexture("_MainTex", tex);
            }
            return _filmMat;
        }

        // replace every material slot whose MATERIAL name contains `tag`
        // (case-insensitive) on the ACTIVE rolle. Material name only — renderer
        // names carry the FBX name (…_CASUAL_…), which would catch the skin.
        private void ApplySlotMaterial(string tag, Material mat)
        {
            if (mat == null) { Debug.LogWarning($"slot '{tag}': material not found"); return; }
            tag = tag.ToLowerInvariant();
            bool any = false;
            foreach (var r in RolleControls[rolleIndex].GetComponentsInChildren<SkinnedMeshRenderer>(true))
            {
                var mats = r.sharedMaterials;
                bool changed = false;
                for (int i = 0; i < mats.Length; i++)
                {
                    if (mats[i] != null && mats[i].name.ToLowerInvariant().Contains(tag))
                    { mats[i] = mat; changed = true; any = true; }
                }
                if (changed) r.sharedMaterials = mats;
            }
            if (!any) Debug.LogWarning($"slot '{tag}': no matching material on {RolleControls[rolleIndex].name}");
        }

        private void ApplyOutfitMaterial(Material mat) =>
            ApplySlotMaterial(IsPerformance ? "PERFORMANCE" : "CASUAL", mat);

        private void ApplyOutfitColor(string color)
        {
            if (!IsPerformance && color == "Film") { ApplyOutfitMaterial(FilmMaterial()); return; }
            var mat = Resources.Load<Material>("Outfits/MAT_MINA_" + (IsPerformance ? "PERFORMANCE_" : "CASUAL_") + color);
            ApplyOutfitMaterial(mat);
        }

        private void SwitchOutfit(int index)
        {
            if (index == rolleIndex || index < 0 || index >= RolleControls.Length) return;
            RolleControls[rolleIndex].SetDanceAnimation(0);
            RolleControls[rolleIndex].RolleDisable();
            rolleIndex = index;
            RolleControls[rolleIndex].RolleEnable();
            dancing = 0;
            if (!IsPerformance) ApplyOutfitMaterial(FilmMaterial());   // casual defaults to film
        }

        // ---- dance test controls: the animator has 8 dance states on the
        // "dance" int (1..8, 0 = stop) that nothing triggered before.
        // ponytail: OnGUI buttons — no scene/prefab wiring needed
        private int dancing;
        private static readonly string[] DanceNames =
            { "High 1", "High 2", "High 3", "High 4", "Mid 1", "Mid 2", "Mid 3", "Moonwalk" };
        private static readonly string[] CasualColors =
            { "Film", "White", "Pink", "Black", "Blue", "Green", "Red", "Violet" };
        private static readonly string[] PerformanceColors =
            { "White", "Black", "Blue", "Green", "Red", "Violet" };

        // everything is LLM-driven by default; F2 shows the manual debug panel
        private bool showDebugUI;
        private bool dancesAvailable;
        private void Update()
        {
            if (Input.GetKeyDown(KeyCode.F2)) showDebugUI = !showDebugUI;
        }

        // she performs IN PLACE: whatever a clip or blend does, the root is
        // pinned back to the stage spot every frame (bones still animate freely)
        private void LateUpdate()
        {
            if (RolleControls == null || RolleControls.Length == 0) return;
            var tr = RolleControls[rolleIndex].transform;
            tr.position = rolleMiddlePos;
            tr.rotation = defaultRotation;
        }

        private void OnGUI()
        {
            if (!showDebugUI) return;
            if (RolleControls == null || RolleControls.Length == 0) return;
            const float W = 96, H = 44, PAD = 6;
            float x = Screen.width - W - 12, y = 12;
            GUIStyle head = new GUIStyle(GUI.skin.label) { richText = true, alignment = TextAnchor.MiddleCenter };

            GUI.Label(new Rect(x, y, W, 24), dancesAvailable ? "<b>Dance</b>" : "<b>Dance</b> (music)", head);
            y += 26;
            for (int i = 0; i < DanceOrder.Length; i++)
            {
                bool active = dancing == i + 1;
                if (GUI.Button(new Rect(x, y, W, H), active ? "Stop" : Cap(DanceOrder[i])))
                {
                    if (active) StopDance();
                    else StartDance(i + 1);
                }
                y += H + PAD;
            }

            // outfit column, left of the dance column
            float x2 = x - W - PAD * 2;
            float y2 = 12;
            GUI.Label(new Rect(x2, y2, W, 24), "<b>Outfit</b>", head);
            y2 += 26;
            if (GUI.Button(new Rect(x2, y2, W, H), IsPerformance ? "Casual" : "Performance"))
                SwitchOutfit(IsPerformance ? 0 : 1);
            y2 += H + PAD * 2;

            GUI.Label(new Rect(x2, y2, W, 24), "<b>Colour</b>", head);
            y2 += 26;
            foreach (var c in IsPerformance ? PerformanceColors : CasualColors)
            {
                if (GUI.Button(new Rect(x2, y2, W, H), c))
                    ApplyOutfitColor(c);
                y2 += H + PAD;
            }
        }
    }
}
