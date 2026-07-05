using OLGTX.DependencyInject;
using OLGTX.Utilitys;
using UnityEngine;
using UnityEngine.UI;

namespace OLGTX.UI.Events
{
    [RequireComponent(typeof(Button))]
    internal sealed class ButtonCopyTextClipboard : MonoBehaviour, DIStartInterface
    {
        public string copyText;
         
        public void OnStart()
        {
            GetComponent<Button>().onClick.AddListener(ButtonClick);
        }

        private void ButtonClick()
        {
            Clipboard.CopyClipboard(copyText); 
        }
    }
}
