using OLGTX.Commands.Voice;
using OLGTX.DependencyInject;
using OLGTX.TypeEventSystem;
using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Networking;

namespace OLGTX.Voice
{
    public sealed class VoiceRecognizerModel
    {
        // holohuman backend: POST multipart "audio" (wav) -> {"text": "..."}
        const string url = "http://127.0.0.1:8710/api/asr";

        [Inject]
        private MonoBehaviour _mono { get; set; }

        [Inject]
        private ISendCommand SendCommand { get; set; }

        [Inject]
        private IRegisterCommand RegisterCommand { get; set; }


        private VoiceRecognitionResultCommand voiceRecognitionResult = new VoiceRecognitionResultCommand();

        VoiceRecognizerBase voiceRecognizer;
        public void Initialized()
        {
            RegisterCommand.Register<SettingVoiceRecognitionCommand>(SettingVoiceRecognitionCommandCallback);

            voiceRecognizer = new VoiceRecognizerHttp();
            voiceRecognizer.Initialized(this._mono, url, this.DisponseRecognition);
        }

        /// <summary>
        /// toggle recognition on/off (mic button)
        /// </summary>
        private void SettingVoiceRecognitionCommandCallback(SettingVoiceRecognitionCommand obj)
        {
            voiceRecognizer.SetIsRecogition(obj.IsStartVoiceRecognition);
        }

        /// <summary>
        /// recognition result: text chunks, then "\n" marks the utterance complete
        /// </summary>
        private void DisponseRecognition(string text1)
        {
            if (text1 == " N" || text1 == "N" || text1 == "A" || text1 == " A")
                return;

            if (!string.IsNullOrEmpty(text1))
            {
                if (text1 == "\n")
                {
                    voiceRecognitionResult.IsComplete = true;
                    voiceRecognitionResult.text = string.Empty;
                }
                else
                {
                    voiceRecognitionResult.IsComplete = false;
                    voiceRecognitionResult.text = text1;
                }

                SendCommand.Send(voiceRecognitionResult);
            }
        }

        public void OnDestroy()
        {
        }
    }


    public abstract class VoiceRecognizerBase
    {
        public abstract void Initialized(MonoBehaviour _mono, string url, Action<string> _recognizerCallback);

        public abstract void SetIsRecogition(bool IsRecogition);
    }

#if UNITY_EDITOR || UNITY_STANDALONE || UNITY_ANDROID

    /// <summary>
    /// Always-on recognizer with local voice-activity detection (the old
    /// websocket server did the VAD; the holohuman backend is one-shot HTTP).
    /// While recognition is enabled it watches the mic level: speech followed
    /// by ~0.9s of silence forms an utterance, which is sent as WAV to
    /// /api/asr (faster-whisper) and reported complete — the same contract
    /// LLMLogic expects from the old streaming recognizer.
    /// </summary>
    public sealed class VoiceRecognizerHttp : VoiceRecognizerBase
    {
        const int SR = 16000;
        const float ONSET_S = 0.08f;         // need 80ms of voice before capture starts (web asr.js)
        const float SILENCE_HOLD = 0.55f;    // silence that ends the utterance (web webkit endpointing feel)
        const float MIN_SPEECH = 0.25f;      // utterances with less voiced audio are noise — dropped
        const int MAX_SAMPLES = SR * 20;     // hard cap: send after 20s regardless

        MonoBehaviour _mono;
        Action<string> recognizerCallback;
        string url;

        AudioClip microphoneClip;
        bool IsRecogition;
        int lastSampling;
        readonly List<float> utterance = new List<float>();
        readonly List<float> preroll = new List<float>();   // last chunk before onset
        readonly float[] window = new float[SR];
        float speechSeconds, silenceSeconds, onsetSeconds;
        float noiseFloor = 0.004f;                          // adaptive ambient level
        bool inSpeech, busy;

        public override void Initialized(MonoBehaviour _mono, string url, Action<string> _recognizerCallback)
        {
            this._mono = _mono;
            this.url = url;
            recognizerCallback = _recognizerCallback;
            _mono.StartCoroutine(InitializedMicrophone());
        }

        public override void SetIsRecogition(bool IsRecogition)
        {
            if (this.IsRecogition == IsRecogition) return;
            this.IsRecogition = IsRecogition;
            // gate only — drop any partial utterance so her own TTS playback
            // (recognition is disabled while she speaks) is never transcribed
            utterance.Clear();
            preroll.Clear();
            inSpeech = false;
            speechSeconds = 0; silenceSeconds = 0; onsetSeconds = 0;
            if (IsRecogition)
                lastSampling = Microphone.GetPosition(null);
        }

        IEnumerator InitializedMicrophone()
        {
            yield return Application.RequestUserAuthorization(UserAuthorization.Microphone);
            if (Application.HasUserAuthorization(UserAuthorization.Microphone))
            {
                do
                {
                    microphoneClip = Microphone.Start(null, true, 1, SR);
                    yield return null;
                } while (!Microphone.IsRecording(null));

                _mono.StartCoroutine(MicrophoneSampling());
            }
            else
            {
                Debug.Log("Microphone permission denied");
            }
        }

        IEnumerator MicrophoneSampling()
        {
            var samplingInterval = new WaitForSeconds(1 / 20f);   // 50ms polling — VAD reacts fast
            while (true)
            {
                yield return samplingInterval;
                if (!IsRecogition || microphoneClip == null || busy)
                    continue;

                int currentPos = Microphone.GetPosition(null);
                if (currentPos == lastSampling || !microphoneClip.GetData(window, 0))
                    continue;

                // gather this poll's new samples into a chunk
                var chunk = new List<float>(1024);
                if (currentPos > lastSampling)
                {
                    for (int i = lastSampling; i < currentPos; i++) chunk.Add(window[i]);
                }
                else // ring buffer wrapped
                {
                    for (int i = lastSampling; i < SR; i++) chunk.Add(window[i]);
                    for (int i = 0; i < currentPos; i++) chunk.Add(window[i]);
                }
                lastSampling = currentPos;
                if (chunk.Count == 0) continue;

                double energy = 0;
                foreach (var s in chunk) energy += s * s;
                float rms = Mathf.Sqrt((float)(energy / chunk.Count));
                float chunkDur = (float)chunk.Count / SR;
                // adaptive threshold: ambient floor learned during silence
                float thresh = Mathf.Max(0.012f, noiseFloor * 3f);

                if (rms > thresh)
                {
                    onsetSeconds += chunkDur;
                    silenceSeconds = 0;
                    if (!inSpeech && onsetSeconds >= ONSET_S)
                    {
                        // capture starts AT onset: preroll chunk + this one, no junk before
                        inSpeech = true;
                        speechSeconds = 0;
                        utterance.Clear();
                        utterance.AddRange(preroll);
                    }
                    if (inSpeech) { utterance.AddRange(chunk); speechSeconds += chunkDur; }
                }
                else
                {
                    noiseFloor = Mathf.Lerp(noiseFloor, rms, 0.05f);
                    onsetSeconds = 0;
                    if (inSpeech)
                    {
                        silenceSeconds += chunkDur;
                        utterance.AddRange(chunk);          // keep the trailing silence
                        if (silenceSeconds >= SILENCE_HOLD || utterance.Count > MAX_SAMPLES)
                        {
                            bool worthSending = speechSeconds > MIN_SPEECH;
                            inSpeech = false;
                            silenceSeconds = 0;
                            if (worthSending) _mono.StartCoroutine(Transcribe());
                            else utterance.Clear();
                        }
                    }
                }
                // remember the last pre-onset chunk so the first syllable isn't clipped
                if (!inSpeech) { preroll.Clear(); preroll.AddRange(chunk); }
            }
        }

        IEnumerator Transcribe()
        {
            busy = true;                        // pause sampling while whisper runs
            var wav = ToWav(utterance.ToArray(), SR);
            utterance.Clear();

            var form = new WWWForm();
            form.AddBinaryData("audio", wav, "audio.wav", "audio/wav");
            using (var request = UnityWebRequest.Post(url, form))
            {
                yield return request.SendWebRequest();
                busy = false;
                lastSampling = Microphone.GetPosition(null);   // skip audio captured while busy
                if (!string.IsNullOrEmpty(request.error))
                {
                    Debug.LogError("ASR error: " + request.error);
                    yield break;
                }
                var text = JsonUtility.FromJson<AsrResult>(request.downloadHandler.text)?.text;
                if (!string.IsNullOrEmpty(text))
                {
                    recognizerCallback?.Invoke(text);
                    // let the chat bubble take a layout pass before "complete"
                    // freezes it (text + complete in one frame = zero-size bubble)
                    yield return null;
                    yield return null;
                    recognizerCallback?.Invoke("\n");   // utterance complete
                }
            }
        }

        [Serializable]
        class AsrResult { public string text; }

        static byte[] ToWav(float[] samples, int sr)
        {
            var pcm = new byte[samples.Length * 2];
            for (int i = 0; i < samples.Length; i++)
            {
                short v = (short)(Mathf.Clamp(samples[i], -1f, 1f) * 32767f);
                pcm[i * 2] = (byte)(v & 0xff);
                pcm[i * 2 + 1] = (byte)((v >> 8) & 0xff);
            }
            using (var ms = new System.IO.MemoryStream())
            using (var w = new System.IO.BinaryWriter(ms))
            {
                w.Write(System.Text.Encoding.ASCII.GetBytes("RIFF"));
                w.Write(36 + pcm.Length);
                w.Write(System.Text.Encoding.ASCII.GetBytes("WAVEfmt "));
                w.Write(16); w.Write((short)1); w.Write((short)1);
                w.Write(sr); w.Write(sr * 2); w.Write((short)2); w.Write((short)16);
                w.Write(System.Text.Encoding.ASCII.GetBytes("data"));
                w.Write(pcm.Length);
                w.Write(pcm);
                return ms.ToArray();
            }
        }
    }
#endif
}
