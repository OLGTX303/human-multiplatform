using OLGTX.DependencyInject;
using OLGTX.VoiceSynthesis;
using UnityEngine;
using UnityEngine.UI;

namespace OLGTX.UI.Voice
{
    internal sealed class VoiceTTSIDSetting : MonoBehaviour, DIAwakeInterface
    {
        public int voiceID;

        public string voiceShowName; 

        public void OnAwake()
        {
            GetComponent<Toggle>().onValueChanged.AddListener(ToggleClick);

        }

        private void ToggleClick(bool arg0)
        {
            if(arg0  )
            {
                VoiceTTS.VoiceID = voiceID; 
            }
        }
    }
}
