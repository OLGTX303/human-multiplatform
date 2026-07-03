using LKZ.Commands.Voice;
using LKZ.DependencyInject;
using LKZ.TypeEventSystem;
using System;
using System.Collections;
using System.IO.Compression;
using System.IO;
using System.Net.WebSockets;
using System.Text;
using UnityEngine;
using UnityEngine.Networking;

namespace LKZ.Voice
{
    public sealed class VoiceRecognizerModel
    {
        const string url = "http://127.0.0.1:8710/api/asr"; // holohuman server (config.yaml)

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
#if !UNITY_WEBGL || UNITY_EDITOR
            voiceRecognizer = new VoiceRecognizerHttp();
            voiceRecognizer.Initialized(this._mono, url, this.DisponseRecognition);
#endif
        }
         
        /// <summary>
        /// ��������ʶ������ص�
        /// </summary>
        /// <param name="obj"></param>
        private void SettingVoiceRecognitionCommandCallback(SettingVoiceRecognitionCommand obj)
        {
            voiceRecognizer?.SetIsRecogition(obj.IsStartVoiceRecognition);
        }

        /// <summary>
        /// ����ʶ����
        /// </summary>
        /// <param name="count"></param>
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
        public abstract void Initialized(MonoBehaviour _mono,string websocketUrl, Action<string> _recognizerCallback);

        public abstract void SetIsRecogition(bool IsRecogition);
    }

#if !UNITY_WEBGL || UNITY_EDITOR
    /// <summary>
    /// Records while recognition is on, then POSTs the WAV to the holohuman
    /// server's /api/asr (faster-whisper) and forwards the transcription.
    /// </summary>
    public sealed class VoiceRecognizerHttp : VoiceRecognizerBase
    {
        const int SampleRate = 16000;
        const int MaxSeconds = 30; // ponytail: fixed utterance cap; chunked streaming if longer speech is needed

        MonoBehaviour _mono;
        string _url;
        Action<string> _callback;
        AudioClip _clip;

        public override void Initialized(MonoBehaviour _mono, string url, Action<string> _recognizerCallback)
        {
            this._mono = _mono;
            _url = url;
            _callback = _recognizerCallback;
            _mono.StartCoroutine(RequestMicPermission());
        }

        IEnumerator RequestMicPermission()
        {
            yield return Application.RequestUserAuthorization(UserAuthorization.Microphone);
        }

        public override void SetIsRecogition(bool IsRecogition)
        {
            if (IsRecogition)
            {
                _clip = Microphone.Start(null, false, MaxSeconds, SampleRate);
            }
            else if (_clip != null)
            {
                int pos = Microphone.GetPosition(null);
                Microphone.End(null);
                if (pos > 0)
                {
                    var samples = new float[pos];
                    _clip.GetData(samples, 0);
                    _mono.StartCoroutine(Transcribe(ToWav(samples)));
                }
                _clip = null;
            }
        }

        IEnumerator Transcribe(byte[] wav)
        {
            var form = new WWWForm();
            form.AddBinaryData("audio", wav, "speech.wav", "audio/wav");
            using (var req = UnityWebRequest.Post(_url, form))
            {
                yield return req.SendWebRequest();
                if (req.result != UnityWebRequest.Result.Success)
                {
                    Debug.LogError("[ASR] " + req.error);
                    yield break;
                }
                var text = JsonUtility.FromJson<AsrResponse>(req.downloadHandler.text).text;
                if (!string.IsNullOrEmpty(text))
                {
                    _callback?.Invoke(text);
                    _callback?.Invoke("\n"); // signals recognition complete upstream
                }
            }
        }

        static byte[] ToWav(float[] samples)
        {
            var pcm = new byte[samples.Length * 2];
            for (int i = 0; i < samples.Length; i++)
            {
                short s = (short)Mathf.Clamp(samples[i] * short.MaxValue, short.MinValue, short.MaxValue);
                pcm[i * 2] = (byte)(s & 0xff);
                pcm[i * 2 + 1] = (byte)((s >> 8) & 0xff);
            }
            using (var ms = new MemoryStream())
            using (var w = new BinaryWriter(ms))
            {
                w.Write(Encoding.ASCII.GetBytes("RIFF")); w.Write(36 + pcm.Length);
                w.Write(Encoding.ASCII.GetBytes("WAVEfmt ")); w.Write(16);
                w.Write((short)1); w.Write((short)1); w.Write(SampleRate); w.Write(SampleRate * 2);
                w.Write((short)2); w.Write((short)16);
                w.Write(Encoding.ASCII.GetBytes("data")); w.Write(pcm.Length);
                w.Write(pcm);
                return ms.ToArray();
            }
        }

        [Serializable]
        class AsrResponse { public string text; }
    }
#endif


#if UNITY_EDITOR ||UNITY_STANDALONE || UNITY_ANDROID

    public sealed class VoiceRecognizerNoWebGL : VoiceRecognizerBase
    {
        ClientWebSocket webSocket;

        AudioClip microphoneClip;


        /// <summary>
        /// ������˷���ʱ��
        /// </summary>
        WaitForSeconds samplingInterval = new WaitForSeconds(1 / 5f);

        private MonoBehaviour _mono;

        private Action<string> recognizerCallback;
        private bool IsRecogition;

        public override async void Initialized(MonoBehaviour _mono, string websocketUrl, Action<string> _recognizerCallback)
        {
            this._mono = _mono;
            recognizerCallback = _recognizerCallback;

            webSocket = new ClientWebSocket();
            await webSocket.ConnectAsync(new Uri(websocketUrl), default);

            _mono.StartCoroutine(InitializedMicrophone());
            byte[] p = new byte[1024 * 1024];
            int count = 0;
            while (true)
            {
                var result = await webSocket.ReceiveAsync(new ArraySegment<byte>(p, count, p.Length - count), default);
                count += result.Count;
                if (result.EndOfMessage)
                {
                    var str = Encoding.UTF8.GetString(p, 0, count);
                    recognizerCallback?.Invoke(str);
                    count = 0;
                }
            }
        }

        public override void SetIsRecogition(bool IsRecogition)
        {
            this.IsRecogition = IsRecogition;
            if (IsRecogition)
                this.lastSampling = Microphone.GetPosition(null);

        }

        IEnumerator InitializedMicrophone()
        {
            yield return Application.RequestUserAuthorization(UserAuthorization.Microphone);
            if (Application.HasUserAuthorization(UserAuthorization.Microphone))
            {
                do
                {
                    microphoneClip = Microphone.Start(null, true, 1, 16000);
                    yield return null;
                } while (!Microphone.IsRecording(null));

                _mono.StartCoroutine(MicrophoneSamplingRecognition());
            }
            else
            {
                Debug.Log("����Ȩ��˷�Ȩ�ޣ�");
            }
        }


        /// <summary>
        /// ��һ�β���λ��
        /// </summary>
        int lastSampling;

        float[] f = new float[16000];
        IEnumerator MicrophoneSamplingRecognition()
        {
            while (true)
            {
                yield return samplingInterval;
                if (!IsRecogition)
                    continue;

                int currentPos = Microphone.GetPosition(null);
                bool isSucceed = microphoneClip.GetData(f, 0);

                if (isSucceed)
                    if (lastSampling != currentPos)
                    {
                        int count = 0;
                        float[] p = default;
                        if (currentPos > lastSampling)
                        {
                            count = currentPos - lastSampling;
                            p = new float[count]; 
                            Array.Copy(f, lastSampling, p, 0, count);
                        }
                        else
                        {
                            count = 16000 - lastSampling;
                            p = new float[count + currentPos]; 
                            Array.Copy(f, lastSampling, p, 0, count);
                             
                            Array.Copy(f, 0, p, count, currentPos);

                            count += currentPos;
                        }

                        lastSampling = currentPos;
                        DisponseRecognition(p);
                    }

            }
        }

        private void DisponseRecognition(float[] p)
        {
            var buffer = FloatArrayToByteArray(p);

            
            this.webSocket.SendAsync(new ArraySegment<byte>(buffer), WebSocketMessageType.Binary, true, default);
        }


        byte[] FloatArrayToByteArray(in float[] floatArray)
        {
            int byteCount = floatArray.Length * sizeof(float);
            byte[] byteArray = new byte[byteCount];

            Buffer.BlockCopy(floatArray, 0, byteArray, 0, byteCount);

            return byteArray;
        }

        static byte[] Compress(in byte[] data)
        {
            using (MemoryStream compressedStream = new MemoryStream())
            {
                using (GZipStream gzipStream = new GZipStream(compressedStream, CompressionMode.Compress))
                {
                    gzipStream.Write(data, 0, data.Length);
                }
                return compressedStream.ToArray();
            }
        }
    }
#endif
}