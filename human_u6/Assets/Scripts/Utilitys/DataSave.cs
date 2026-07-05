using System.Data;
using UnityEngine;

namespace OLGTX.Utilitys
{
    internal static class DataSave
    {
        private const string VoiceTTSID_Key = "VoiceTTSID";
        private const string RoleSetting_Key = "RoleSetting";

        public static int GetVoiceID()
        {
            if (!PlayerPrefs.HasKey(VoiceTTSID_Key))
            {
                return 1;
            }

            return PlayerPrefs.GetInt(VoiceTTSID_Key);
        }

        /// <summary>
        /// 设置音色id
        /// </summary>
        /// <param name="id"></param>
        public static void SetVoiceID(int id)
        {
            PlayerPrefs.SetInt(VoiceTTSID_Key, id);
        }


        public static bool GetRoleSetting(out string data)
        {
            var has = PlayerPrefs.HasKey(RoleSetting_Key);
            if (!has)
            {
                // no local default — the holohuman backend's config.yaml system
                // prompt defines Mina's persona
                data = string.Empty;
            }
            else
                data = PlayerPrefs.GetString(RoleSetting_Key);
            return has;
        }

        public static void SetRoleSetting(string role)
        {
            PlayerPrefs.SetString(RoleSetting_Key, role);
        }

        public static void DeleteRoleSetting()
        {
            PlayerPrefs.DeleteKey(RoleSetting_Key );

        }
    }
}
