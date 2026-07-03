using System;
using UnityEngine;

namespace LKZ.CrossPlatform.Voice
{
    /// <summary>
    /// Platform-neutral streaming speech recognition contract. Replaces the
    /// hardcoded VoiceRecognizerNoWebGL usage in VoiceRecognizerModel.
    /// </summary>
    public interface IVoiceRecognizer
    {
        bool IsSupported { get; }
        /// <param name="host">MonoBehaviour used to run coroutines.</param>
        /// <param name="url">ws:// or wss:// streaming ASR endpoint.</param>
        /// <param name="onResult">Called with partial/final recognized text.</param>
        void Initialize(MonoBehaviour host, string url, Action<string> onResult);
        void SetRecognizing(bool on);
        void Dispose();
    }
}
