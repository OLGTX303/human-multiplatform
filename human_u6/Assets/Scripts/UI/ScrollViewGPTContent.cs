using OLGTX.Chat.Commands;
using OLGTX.Commands.Chat;
using OLGTX.DependencyInject;
using OLGTX.Enum;
using OLGTX.TypeEventSystem;
using System;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;

namespace OLGTX.UI
{
    public sealed class ScrollViewGPTContent : MonoBehaviour, DIStartInterface, DIAwakeInterface, IBeginDragHandler, IEndDragHandler
    {
        [Inject]
        private IRegisterCommand RegisterCommand { get; set; }

        ScrollRect _scrollRect;

        private RectTransform _scrollRect_Content;

        [SerializeField]
        private GameObject _my_Go, _gpt_go;

        [SerializeField, Tooltip("���")]
        private float interval = 15f;

        [SerializeField, Tooltip("���������Ƿ������ƶ�����")]
        private float GPTGenerateContentUpMove = 30f;

        private ShowContent currentShowContent;

        /// <summary>
        /// �������ݺͲ��������ݹ�����ͼ��λ��
        /// </summary>
        private Vector3 defaultPos, GPTGenerateContentPos;
         

        private bool isSetScrollRectNormalizedPosition;

        /// <summary>
        /// �Ƿ�������GPT����
        /// </summary>
#if !UNITY_STANDALONE_WIN
        private bool isGenerateGPTContent;
#endif

        private RectTransform thisRect;

        void DIAwakeInterface.OnAwake()
        {
            thisRect = base.transform as RectTransform;

            _scrollRect = GetComponent<ScrollRect>();
            _scrollRect_Content = _scrollRect.content;

            defaultPos = thisRect.anchoredPosition;
            GPTGenerateContentPos = defaultPos;
            GPTGenerateContentPos.y += GPTGenerateContentUpMove;
             
            isSetScrollRectNormalizedPosition = true;
        }

        void DIStartInterface.OnStart()
        {
            RegisterCommand.Register<AddChatContentCommand>(AddChatContentCommandCallback);

            RegisterCommand.Register<GenerateFinishCommand>(GenerateFinishCommandCallback); 

        }
         

        private void GenerateFinishCommandCallback(GenerateFinishCommand obj)
        {
#if !UNITY_STANDALONE_WIN
            isGenerateGPTContent = false;
#endif
        }

        void IEndDragHandler.OnEndDrag(PointerEventData eventData)
        {
            isSetScrollRectNormalizedPosition = true;

        }

        void IBeginDragHandler.OnBeginDrag(PointerEventData eventData)
        {
            isSetScrollRectNormalizedPosition = false;

        }

        private void OnDestroy()
        {
            // on play-mode exit the DI container can be torn down before us
            RegisterCommand?.UnRegister<AddChatContentCommand>(AddChatContentCommandCallback);
        }

        private void AddChatContentCommandCallback(AddChatContentCommand obj)
        {
            // flush the outgoing bubble's final height into the content BEFORE
            // computing the next bubble's position — otherwise text that arrived
            // this frame is unaccounted and the bubbles overlap
            if (!object.ReferenceEquals(null, currentShowContent))
            {
                currentShowContent.FlushLayout();
                _scrollRect_Content.sizeDelta += new Vector2(0, currentShowContent.Height - lastHeight);
                currentShowContent.Enabled = false;
            }

            Vector2 pos = new Vector2(0, -_scrollRect_Content.sizeDelta.y);

            switch (obj.infoType)
            {
                case InfoType.My:
                    currentShowContent = Instantiate(_my_Go, _scrollRect_Content).GetComponent<ShowContent>();
                  //  pos.x = ScreenWidth;
                    break;
                case InfoType.ChatGPT:
                    currentShowContent = Instantiate(_gpt_go, _scrollRect_Content).GetComponent<ShowContent>();
#if !UNITY_STANDALONE_WIN
                    isGenerateGPTContent = true;
#endif
                    break;
            }

            currentShowContent.Initialized(pos);

            lastHeight = 0;

            _scrollRect_Content.sizeDelta += new Vector2(0, interval);

            obj._addTextAction(AddShowText);
        }

        float lastHeight = default;

        private void AddShowText(string c)
        {
            currentShowContent.AddText(c);
        }

        private void LateUpdate()
        {
            if (object.ReferenceEquals(null, currentShowContent))
                return;

            if (currentShowContent.Height != lastHeight)
            {
                _scrollRect_Content.sizeDelta += new Vector2(0, currentShowContent.Height - lastHeight);

                lastHeight = currentShowContent.Height;
            }

            if (isSetScrollRectNormalizedPosition)
                _scrollRect.verticalNormalizedPosition = Mathf.Lerp(_scrollRect.verticalNormalizedPosition, 0, 0.05f);

#if !UNITY_STANDALONE_WIN
            //���������ƶ�
            thisRect.anchoredPosition = Vector3.Lerp(this.thisRect.anchoredPosition, isGenerateGPTContent ? this.GPTGenerateContentPos : this.defaultPos, 0.05f);
#endif
        }


    }
}