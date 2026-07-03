using System;
using UnityEngine;
using LKZ.CrossPlatform.Display;
using LKZ.CrossPlatform.Voice;

namespace LKZ.CrossPlatform
{
    /// <summary>
    /// Drop this on a GameObject in the scene (replaces TransparentWindow and
    /// the hardcoded recognizer selection in VoiceRecognizerModel).
    ///
    /// It selects the right IHolographicDisplay and IVoiceRecognizer for the
    /// current runtime platform, with per-platform defaults that you can
    /// override in the Inspector or via a config file.
    /// </summary>
    public sealed class PlatformBootstrap : MonoBehaviour
    {
        [Header("Scene refs")]
        public Camera MainCamera;
        public Transform CharacterRoot;

        [Header("Display")]
        [Tooltip("Auto = pick per-platform default below")]
        public HoloDisplayMode Mode = HoloDisplayMode.Standard;
        public bool AutoSelectPerPlatform = true;

        [Header("Voice")]
        [Tooltip("Streaming ASR endpoint. Use wss:// for WebGL/https and mobile.")]
        public string AsrUrl = "wss://your-asr-server.example.com/recognition";

        public IHolographicDisplay Display { get; private set; }
        public IVoiceRecognizer Recognizer { get; private set; }

        /// <summary>Fires with recognized text; hook your LLM pipeline here.</summary>
        public event Action<string> OnSpeechRecognized;

        private void Awake()
        {
            if (MainCamera == null) MainCamera = Camera.main;

            var mode = AutoSelectPerPlatform ? DefaultModeForPlatform() : Mode;
            Display = CreateDisplay(mode);
            if (!Display.IsSupported)
            {
                Debug.LogWarning($"[Holo] {Display.DisplayName} unsupported here, using Standard.");
                Display = new StandardDisplay();
            }
            Display.Initialize(MainCamera, CharacterRoot);
            Debug.Log($"[Holo] Display: {Display.DisplayName} | Platform: {Application.platform}");

            Recognizer = CreateRecognizer();
            Recognizer.Initialize(this, AsrUrl, t => OnSpeechRecognized?.Invoke(t));
        }

        public void StartListening() => Recognizer.SetRecognizing(true);
        public void StopListening() => Recognizer.SetRecognizing(false);

        private static HoloDisplayMode DefaultModeForPlatform()
        {
            switch (Application.platform)
            {
                case RuntimePlatform.WindowsPlayer:
                    return HoloDisplayMode.TransparentDesktopOverlay; // desktop mate
                case RuntimePlatform.Android:
                case RuntimePlatform.IPhonePlayer:
                    return HoloDisplayMode.PepperGhostPyramid;        // phone + pyramid
                case RuntimePlatform.WebGLPlayer:
                    return HoloDisplayMode.Standard;                  // embed in page; pyramid selectable in UI
                default:
                    return HoloDisplayMode.Standard;                  // macOS/Linux/editor
            }
        }

        private IHolographicDisplay CreateDisplay(HoloDisplayMode mode)
        {
            switch (mode)
            {
                case HoloDisplayMode.TransparentDesktopOverlay:
                    return new WindowsTransparentOverlayDisplay();
                case HoloDisplayMode.PepperGhostPyramid:
                    return new PepperGhostPyramidDisplay();
                case HoloDisplayMode.SingleReflection:
                    return new PepperGhostPyramidDisplay { SingleViewMode = true };
                default:
                    return new StandardDisplay();
            }
        }

        private IVoiceRecognizer CreateRecognizer()
        {
#if UNITY_WEBGL && !UNITY_EDITOR
            return new WebGLStreamingRecognizer();
#else
            return new NativeStreamingRecognizer();
#endif
        }

        /// <summary>Switch hologram mode at runtime (e.g. from a settings menu).</summary>
        public void SwitchDisplay(HoloDisplayMode mode)
        {
            Display?.Shutdown();
            Display = CreateDisplay(mode);
            if (!Display.IsSupported) Display = new StandardDisplay();
            Display.Initialize(MainCamera, CharacterRoot);
        }

        private void OnDestroy()
        {
            Recognizer?.Dispose();
            Display?.Shutdown();
        }
    }
}
