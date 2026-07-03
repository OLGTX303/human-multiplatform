#if !UNITY_WEBGL || UNITY_EDITOR
using System;
using System.Collections;
using System.Net.WebSockets;
using System.Threading;
using UnityEngine;

namespace LKZ.CrossPlatform.Voice
{
    /// <summary>
    /// Streaming recognizer for Windows / macOS / Linux / Android / iOS.
    /// Captures 16 kHz mono PCM from Unity's Microphone API and streams it over
    /// a WebSocket to the ASR service; receives text frames back.
    ///
    /// Mobile notes:
    ///  - Android: add RECORD_AUDIO permission (Player Settings adds it
    ///    automatically when Microphone is referenced) and request it at runtime.
    ///  - iOS: set "Microphone Usage Description" in Player Settings.
    ///  - Use wss:// in production; iOS ATS and Android 9+ block cleartext.
    /// </summary>
    public sealed class NativeStreamingRecognizer : IVoiceRecognizer
    {
        public bool IsSupported => Microphone.devices != null;

        private MonoBehaviour _host;
        private Action<string> _onResult;
        private string _url;

        private ClientWebSocket _socket;
        private CancellationTokenSource _cts;
        private AudioClip _micClip;
        private int _lastSample;
        private bool _recognizing;
        private Coroutine _pump;

        private const int SampleRate = 16000;

        public void Initialize(MonoBehaviour host, string url, Action<string> onResult)
        {
            _host = host; _url = url; _onResult = onResult;
#if UNITY_ANDROID && !UNITY_EDITOR
            if (!UnityEngine.Android.Permission.HasUserAuthorizedPermission(UnityEngine.Android.Permission.Microphone))
                UnityEngine.Android.Permission.RequestUserPermission(UnityEngine.Android.Permission.Microphone);
#endif
        }

        public void SetRecognizing(bool on)
        {
            if (on == _recognizing) return;
            _recognizing = on;
            if (on) _host.StartCoroutine(Start());
            else Stop();
        }

        private IEnumerator Start()
        {
            _cts = new CancellationTokenSource();
            _socket = new ClientWebSocket();
            var connect = _socket.ConnectAsync(new Uri(_url), _cts.Token);
            while (!connect.IsCompleted) yield return null;
            if (connect.IsFaulted) { Debug.LogError($"[ASR] connect failed: {connect.Exception?.GetBaseException().Message}"); yield break; }

            _micClip = Microphone.Start(null, true, 10, SampleRate);
            _lastSample = 0;
            _pump = _host.StartCoroutine(PumpAudio());
            ReceiveLoop();
        }

        private IEnumerator PumpAudio()
        {
            var send = new float[SampleRate]; // up to 1s scratch
            while (_recognizing && _socket?.State == WebSocketState.Open)
            {
                int pos = Microphone.GetPosition(null);
                int count = pos - _lastSample;
                if (count < 0) count += _micClip.samples; // ring buffer wrap
                if (count > 0)
                {
                    if (count > send.Length) count = send.Length;
                    _micClip.GetData(send, _lastSample % _micClip.samples);
                    var pcm = new byte[count * 2];
                    for (int i = 0; i < count; i++)
                    {
                        short s = (short)Mathf.Clamp(send[i] * short.MaxValue, short.MinValue, short.MaxValue);
                        pcm[i * 2] = (byte)(s & 0xff);
                        pcm[i * 2 + 1] = (byte)((s >> 8) & 0xff);
                    }
                    _lastSample = pos;
                    var seg = new ArraySegment<byte>(pcm);
                    var t = _socket.SendAsync(seg, WebSocketMessageType.Binary, true, _cts.Token);
                    while (!t.IsCompleted) yield return null;
                }
                yield return new WaitForSeconds(0.08f); // ~80ms chunks
            }
        }

        private async void ReceiveLoop()
        {
            var buf = new byte[8192];
            try
            {
                while (_socket.State == WebSocketState.Open && !_cts.IsCancellationRequested)
                {
                    var r = await _socket.ReceiveAsync(new ArraySegment<byte>(buf), _cts.Token);
                    if (r.MessageType == WebSocketMessageType.Close) break;
                    string text = System.Text.Encoding.UTF8.GetString(buf, 0, r.Count);
                    MainThread.Post(() => _onResult?.Invoke(text));
                }
            }
            catch (Exception e) { Debug.LogWarning($"[ASR] receive ended: {e.Message}"); }
        }

        private void Stop()
        {
            Microphone.End(null);
            if (_pump != null) _host.StopCoroutine(_pump);
            _cts?.Cancel();
            try { _socket?.Abort(); } catch { }
            _socket?.Dispose(); _socket = null;
        }

        public void Dispose() => Stop();
    }

    /// <summary>Tiny main-thread dispatcher (WebSocket callbacks arrive on worker threads).</summary>
    public sealed class MainThread : MonoBehaviour
    {
        private static readonly System.Collections.Concurrent.ConcurrentQueue<Action> _q = new();
        private static MainThread _inst;
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        private static void Boot() { if (_inst == null) { var go = new GameObject("~MainThread"); DontDestroyOnLoad(go); _inst = go.AddComponent<MainThread>(); } }
        public static void Post(Action a) => _q.Enqueue(a);
        private void Update() { while (_q.TryDequeue(out var a)) a(); }
    }
}
#endif
