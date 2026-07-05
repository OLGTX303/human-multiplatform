using System;
using System.Text;
using UnityEngine.Networking;
using UnityEngine;
using System.Collections;
using System.Collections.Generic;
using OLGTX.Logics;
using Newtonsoft.Json.Linq;

namespace OLGTX.GPT
{
    public sealed class Certificate : CertificateHandler
    {
        protected override bool ValidateCertificate(byte[] certificateData)
        {
            return true;
        }
    }
    public static class LLM
    {
        /// <summary>
        /// Raised with the JSON payload of each &lt;control&gt;{...}&lt;/control&gt;
        /// block the LLM emits (emotion / dance / dress / …) — the avatar-control
        /// side channel the web client also consumes.
        /// </summary>
        public static event Action<string> OnControl;

        private readonly static WaitForSeconds wait_internal = new WaitForSeconds(0.2f);

        private readonly static char[] Segmentations = new char[] { '；', ';', '。', ':', '：', '！', '!', '?', '？', ',', '，' };

        [Serializable]
        public class UserDataStruct
        {
            public string model;
            public List<Message> messages;


            /// <summary>
            /// 是否流式
            /// </summary>
            public bool stream;

            /// <summary>
            /// 采样温度，控制输出的随机性，必须为正数
            /// 取值范围是：(0.0,1.0]，不能等于 0，默认值为 0.95,值越大，会使输出更随机，更具创造性；值越小，输出会更加稳定或确定
            /// 建议您根据应用场景调整 top_p 或 temperature 参数，但不要同时调整两个参数
            /// </summary>
            public float temperature;

            /// <summary>
            /// 用温度取样的另一种方法，称为核取样
            /// 取值范围是：(0.0, 1.0) 开区间，不能等于 0 或 1，默认值为 0.7
            /// 模型考虑具有 top_p 概率质量tokens的结果
            /// 例如：0.1 意味着模型解码器只考虑从前 10% 的概率的候选集中取tokens
            /// 建议您根据应用场景调整 top_p 或 temperature 参数，但不要同时调整两个参数
            /// </summary>
            public float top_p;

            public float top_k;
            public float max_prompt_tokens;
            public float max_new_tokens;
        }

        [Serializable]
        public class Message
        {
            private Message() { }

            public string role;
            public string content;

            public static Message CreateSystemMessage(string content)
            {
                return new Message() { role = "system", content = content };
            }

            public static Message CreateUserMessage(string content)
            {
                return new Message() { role = "user", content = content };
            }

            public static Message CreateAssistantMessage(string content)
            {
                return new Message() { role = "assistant", content = content };
            }
        }

        readonly static UserDataStruct userDataStruct;
        static readonly LLMConfig config;
        static LLM()
        {
            config = UnityEngine.Resources.Load<LLMConfig>("LLMConfig");

            userDataStruct = new UserDataStruct()
            {
                model = config.model,
                stream = true,
                messages = new List<Message>(),
                temperature = 1,
                top_p = 0.7f,
            };
            // holohuman backend prepends its own system prompt (config.yaml);
            // only add a local role refinement when one is actually set
            if (!string.IsNullOrEmpty(config.roleSetting))
                userDataStruct.messages.Add(Message.CreateSystemMessage(config.roleSetting));
        }

        /// <summary>
        /// llm
        /// </summary>
        /// <param name="content"></param>
        /// <param name="callback"></param>
        /// <returns></returns>
        public static IEnumerator Request(string content, Action<string, bool> callback)
        {
            userDataStruct.messages.Add(Message.CreateUserMessage(content));


            return RequestGPTSegmentation(JsonUtility.ToJson(userDataStruct), callback);
        }


        private static IEnumerator RequestGPTSegmentation(string requestData, Action<string, bool> callback)
        {
            string last = "";
            string mess = "";

            using (var request = new UnityWebRequest(config.url, "POST"))
            {
                request.uploadHandler = new UploadHandlerRaw(Encoding.UTF8.GetBytes(requestData))
                { contentType = "application/json" };

                request.downloadHandler = new DownloadHandlerBuffer();

                request.certificateHandler = new Certificate();

                // holohuman backend needs no key; header kept for OpenAI-compatible endpoints
                if (!string.IsNullOrEmpty(config.key))
                    request.SetRequestHeader("Authorization", $"Bearer {config.key}");
                UnityWebRequestAsyncOperation asyncOp = request.SendWebRequest();
                 
                while (!asyncOp.isDone)
                {
                    Disponse(false);
                    yield return wait_internal;
                }

                if (request.result == UnityWebRequest.Result.ConnectionError || request.result == UnityWebRequest.Result.ProtocolError)
                {
                    Debug.LogError("Error: " + request.error);
                    callback?.Invoke("Hmm, my brain isn't responding right now.", true);
                    yield break;
                }
                // 处理最后一次接收到的数据
                Disponse(true);


                void Disponse(bool isComplete)
                {
                    var str = request.downloadHandler.text;
                    string temp = str.Substring(last.Length);
                    if (!isComplete)
                    {
                        // only consume complete SSE events; a partial tail waits for the next poll
                        int cut = temp.LastIndexOf("\n\n");
                        temp = cut < 0 ? "" : temp.Substring(0, cut + 2);
                    }
                    last = str.Substring(0, last.Length + temp.Length);

                    var datas = temp.Split("data:");


                    foreach (var requestJson in datas)
                    {
                        if (string.IsNullOrEmpty(requestJson))
                            continue;

                        if (requestJson.Contains("[DONE]"))
                            break;
                        // holohuman server SSE format: data: {"delta": "..."} / {"error": "..."}
                        JToken jsonP;
                        try { jsonP = JToken.Parse(requestJson.Replace("data:", "")); }
                        catch { continue; } // partial SSE line, completed on next poll

                        var err = jsonP.SelectToken("error")?.ToString();
                        if (!string.IsNullOrEmpty(err))
                        {
                            Debug.LogError("LLM error: " + err);
                            break;
                        }

                        var tt = jsonP.SelectToken("delta")?.ToString();
                        if (!string.IsNullOrEmpty(tt))
                            mess += tt;
                    }
                    // hide <control>{...}</control> avatar-control blocks from the
                    // chat text and TTS (the web client strips them the same way)
                    // and hand their JSON to OnControl; an unclosed block is held
                    // back until the rest streams in
                    mess = System.Text.RegularExpressions.Regex.Replace(mess, @"<control>([\s\S]*?)</control>", m =>
                    {
                        try { OnControl?.Invoke(m.Groups[1].Value.Trim()); } catch (Exception e) { Debug.LogWarning("control handler: " + e.Message); }
                        return "";
                    });
                    string hold = "";
                    int openIdx = mess.IndexOf("<control>");
                    if (openIdx >= 0) { hold = mess.Substring(openIdx); mess = mess.Remove(openIdx); }
                    string text2 = "";
                    if (!isComplete)
                    {
                        int index = 0;
                        foreach (var item in Segmentations)
                        {
                            if (mess.Contains(item))
                            {
                                index = mess.IndexOf(item);
                                break;
                            }
                        }


                        if (index != 0)
                        {
                            ++index;
                            text2 = mess.Substring(0, index);
                            mess = mess.Remove(0, index);
                        }
                        mess += hold;   // unfinished control block waits for its closing tag
                    }
                    else
                    {
                        text2 = mess;   // a dangling unclosed <control> at the end is dropped
                    }
                    callback.Invoke(text2, isComplete);
                   
                }
            }
        }
    }
}
