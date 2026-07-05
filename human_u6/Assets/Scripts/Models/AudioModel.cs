using OLGTX.DependencyInject;
using OLGTX.Rolle;
using OLGTX.TypeEventSystem;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using UnityEngine;

namespace OLGTX.Models
{
    /// <summary>
    /// 音频模块
    /// </summary> 
    public sealed class AudioModel : MonoBehaviour, IDRegisterBindingInterface
    {
        private RolleManager rolleManager;
         

        public bool IsPlaying => rolleManager.AudioSource.isPlaying;
        public float Time => rolleManager.AudioSource.time;
         

        private void Awake()
        {
            rolleManager = FindFirstObjectByType<RolleManager>();
        }

        void IDRegisterBindingInterface.DIRegisterBinding(IRegisterBinding registerBinding)
        {
            registerBinding.Binding<AudioModel>().To(this);
        }

        public void Play(AudioClip clip)
        {
            rolleManager.AudioSource.clip = clip;
            rolleManager.AudioSource.Play();
        }

        public void Stop() => rolleManager.AudioSource.Stop();
    }
}
