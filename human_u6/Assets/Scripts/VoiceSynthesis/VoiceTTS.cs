using OLGTX.Utilitys;
using System.Collections;
using UnityEngine;
using UnityEngine.Networking;

namespace OLGTX.VoiceSynthesis
{ 

    /// <summary>
    ///  语音合成
    /// </summary>
    public static class VoiceTTS
    {
        public const string ErrorMess = "语音识别出错了";

        static int voiceID;
        public static int VoiceID
        {
            get => voiceID; set
            {
                voiceID = value;
                DataSave.SetVoiceID(voiceID);
            }
        }

        static VoiceTTS()
        {
            voiceID = DataSave.GetVoiceID();
        }

        public static IEnumerator Synthesis(string content)
        {
            // holohuman backend: POST {"text": ...} -> audio/wav (kokoro).
            // VoiceID unused — the voice (af_heart) is set in config.yaml.
            using (var request = new UnityWebRequest("http://127.0.0.1:8710/api/tts", "POST"))
            {
                var body = System.Text.Encoding.UTF8.GetBytes(
                    JsonUtility.ToJson(new TTSBody { text = content }));
                request.uploadHandler = new UploadHandlerRaw(body) { contentType = "application/json" };
                request.downloadHandler = new DownloadHandlerAudioClip(request.url, AudioType.WAV);
                var result = request.SendWebRequest();
                while (!result.isDone)
                {
                    yield return null;
                }
                if (string.IsNullOrEmpty(request.error))
                {
                    AudioClip _audioClip = DownloadHandlerAudioClip.GetContent(request);
                    yield return _audioClip;
                }
                else
                {
                    yield return ErrorMess;
                }
            }
        }

        [System.Serializable]
        private class TTSBody { public string text; }
    }
}
