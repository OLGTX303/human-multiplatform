#if UNITY_WEBGL && !UNITY_EDITOR
using System;
using System.Runtime.InteropServices;
using UnityEngine;

namespace LKZ.CrossPlatform.Voice
{
    /// <summary>
    /// WebGL recognizer. System.Net.WebSockets and UnityEngine.Microphone do NOT
    /// exist in the browser sandbox, so this delegates to Plugins/WebGL/HoloVoice.jslib
    /// which uses the browser's native WebSocket + getUserMedia/AudioWorklet.
    /// Results are delivered back via SendMessage to a receiver GameObject.
    ///
    /// IMPORTANT: browsers require wss:// (TLS) when the page is served over https,
    /// and microphone access requires a user gesture + permission prompt.
    /// </summary>
    public sealed class WebGLStreamingRecognizer : IVoiceRecognizer
    {
        [DllImport("__Internal")] private static extern void HoloVoice_Init(string url, string receiverGoName);
        [DllImport("__Internal")] private static extern void HoloVoice_Start();
        [DllImport("__Internal")] private static extern void HoloVoice_Stop();

        public bool IsSupported => true;

        private WebGLVoiceReceiver _receiver;

        public void Initialize(MonoBehaviour host, string url, Action<string> onResult)
        {
            var go = new GameObject("~WebGLVoiceReceiver");
            UnityEngine.Object.DontDestroyOnLoad(go);
            _receiver = go.AddComponent<WebGLVoiceReceiver>();
            _receiver.OnResult = onResult;
            HoloVoice_Init(url, go.name);
        }

        public void SetRecognizing(bool on)
        {
            if (on) HoloVoice_Start(); else HoloVoice_Stop();
        }

        public void Dispose() => HoloVoice_Stop();
    }

    /// <summary>Receives SendMessage callbacks from the jslib.</summary>
    public sealed class WebGLVoiceReceiver : MonoBehaviour
    {
        public Action<string> OnResult;
        // Called from JS: SendMessage(goName, "OnAsrResult", text)
        public void OnAsrResult(string text) => OnResult?.Invoke(text);
        public void OnAsrError(string msg) => Debug.LogWarning($"[ASR-WebGL] {msg}");
    }
}
#endif
