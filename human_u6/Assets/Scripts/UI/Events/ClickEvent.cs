using System;
using UnityEngine;
using UnityEngine.EventSystems;

namespace OLGTX.UI.Events
{
    public sealed class ClickEvent : MonoBehaviour, IPointerClickHandler
    {
        public event Action ClickEventCallback;
          void IPointerClickHandler.OnPointerClick(PointerEventData eventData)
        {
            ClickEventCallback?.Invoke();
        }
    }
}
