using OLGTX.DependencyInject;
using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;

namespace OLGTX.TypeEventSystem
{
    /// <summary>
    /// �����¼�ϵͳ����
    /// </summary>
    [DefaultExecutionOrder(-100)]
    [HelpURL("http://www.lkz.fit")]
    [DisallowMultipleComponent]
    [AddComponentMenu("OLGTX/�����¼�ϵͳ����")]
    public class TypeEventSystemManager : MonoBehaviour, ISendCommand, IRegisterCommand, IDRegisterBindingInterface 
    {
        [SerializeField, Tooltip("�Ƿ���س���������")]
        private bool dontDestroyOnLoad = true;

        /// <summary>
        /// �洢ע��Ľӿڵļ���
        /// �����Ǹ�ע������ͣ���һ���ṹ�壬������һ������
        /// ֵ���Ǹ�����ί�з���ֵ�Ľӿڣ�����EventRegister<T>�����
        /// </summary>
        private Dictionary<Type, IEventInterface> allEventType_Dic;

         
        #region ���� �ӿڷ���
        /// <summary>
        /// ����
        /// ����Ҫ�����¼��Ļ����͵���UnRegisterȡ�������¼�
        /// </summary>
        /// <param name="action">�ص�</param>
        public void Register<T>(Action<T> action)
            where T : struct
        {
            Type key = typeof(T);
            if (allEventType_Dic.TryGetValue(key, out IEventInterface value))
            {
                (value as EventRegister<T>).Register(action);
            }
            else
            {
                allEventType_Dic.Add(key, new EventRegister<T>(action));
            }
        }

        /// <summary>
        /// ȡ�������¼�
        /// </summary>
        /// <param name="action">ȡ�������Ļص�ί��</param>
        public void UnRegister<T>(Action<T> action)
            where T : struct
        {
            Type key = typeof(T);
            if (allEventType_Dic.TryGetValue(key, out IEventInterface value))
            {
                (value as EventRegister<T>).UnRegister(action);
            }
        }

        /// <summary>
        /// �����¼�
        /// </summary>
        /// <param name="instanceParameter">������Ǹ��������ע���ί�е�����
        /// �����һ��ʵ���������Ǹ�ע��ί�еĲ����ṹ�壬�ṹ��������ԷŸ������ߴ��ݲ���</param>
        public void Send<T>(T instanceParameter)
            where T : struct
        {
            Type key = typeof(T);
            if (allEventType_Dic.TryGetValue(key, out IEventInterface value))
            {
                (value as EventRegister<T>).Send(instanceParameter);
            }
        }
        #endregion

        #region ����ע��ӿڷ���
        /// <summary>
        /// ����ע��ص�
        /// �Ұ��Լ��Ľӿ�ע���ȥ
        /// </summary>
        /// <param name="registerBinding"></param>
        void IDRegisterBindingInterface.DIRegisterBinding(IRegisterBinding registerBinding)
        {
            if (dontDestroyOnLoad)
                DontDestroyOnLoad(this.gameObject);
            allEventType_Dic = new Dictionary<Type, IEventInterface>();

#if UNITY_EDITOR
            if (FindObjectsByType<TypeEventSystemManager>(FindObjectsSortMode.None).Length > 1)
                Debug.LogError($"�������ж��{nameof(TypeEventSystemManager)}�ű�!");
#endif

            registerBinding.Binding<ISendCommand>().To(this);
            registerBinding.Binding<IRegisterCommand>().To(this);
        }

        #endregion

    }
}