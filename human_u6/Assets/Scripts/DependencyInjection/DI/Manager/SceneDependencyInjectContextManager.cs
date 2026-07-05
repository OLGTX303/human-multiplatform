using OLGTX.DependencyInject.Extension;
using UnityEngine;
using UnityEngine.Serialization;

namespace OLGTX.DependencyInject
{
    /// <summary>
    /// ����������ע��������
    /// </summary>
    [DefaultExecutionOrder(-200)]
    [HelpURL("http://www.lkz.fit")]
    [DisallowMultipleComponent]
    [AddComponentMenu("OLGTX/����ע��/����ע�볡�������Ĺ���")]
    public class SceneDependencyInjectContextManager : MonoBehaviour
    {
        /// <summary>
        /// ����
        /// </summary>
        public static SceneDependencyInjectContextManager Instance { get; private set; }

        [SerializeField, FormerlySerializedAs("�Ƿ���س���������")]
        private bool dontDestroyOnLoad = true;

        /// <summary>
        /// ����ע��Unity�����ļ�
        /// </summary>
        [SerializeField, FormerlySerializedAs("����ע��Unity�����ļ�")]
        private DIScriptableObject[] scriptableObjects;

        /// <summary>
        /// ����ע��������
        /// </summary>
        private DependencyInjectContext dependencyInjectContext;

        private object[] AllCustomComponent;

        private void Awake()
        {
            if (dontDestroyOnLoad)
                DontDestroyOnLoad(this.gameObject);

            Instance = this;
#if UNITY_EDITOR
            if (FindObjectsByType<SceneDependencyInjectContextManager>(FindObjectsSortMode.None).Length > 1)
                Debug.LogError($"�������ж��{nameof(SceneDependencyInjectContextManager)}�ű�!");
#endif

            dependencyInjectContext = new DependencyInjectContext();
            //����Զ������
              AllCustomComponent = dependencyInjectContext.GetCustomComponent();

            //���ü̳���ע��ӿ�IDIRegisterBinding����
            InvokeBindInjectsInterface(AllCustomComponent);
            //����Unity�����ļ���ע���
            InvokeInjectBindingScriptableObject();

            #region ��ʹ����Inject���Ե�����ע��

            InjectsProperty(AllCustomComponent);
            #endregion

            dependencyInjectContext.InvokeDIAwakeInterface(AllCustomComponent);
        }

        private void Start()
        {
            dependencyInjectContext.InvokeDIStartInterface(AllCustomComponent);
        }

        #region ����Unity�����ļ���ע��� ˽��
        /// <summary>
        /// ����Unity�����ļ���ע���
        /// </summary>
        private void InvokeInjectBindingScriptableObject()
        {
            foreach (DIScriptableObject item in scriptableObjects)
            {
                item.InjectBinding(dependencyInjectContext);
            }
        }
        #endregion
         

        #region ����ע��󶨵Ľӿ�
        /// <summary>
        /// ����ע��󶨵Ľӿ�
        /// ��������˭�̳���IDIRegisterBinding�ӿڣ��͵����Ǹ��ӿڷ���
        /// </summary>
        /// <param name="component">�Զ�������</param>
        public void InvokeBindInjectInterface(object component)
        {
            dependencyInjectContext.InvokeBindInjectInterface(component);
        }

        /// <summary>
        /// ����ע��󶨵Ľӿ�
        /// ��������˭�̳���IDIRegisterBinding�ӿڣ��͵����Ǹ��ӿڷ���
        /// </summary>
        /// <param name="component">�Զ�������</param>
        public void InvokeBindInjectsInterface(params object[] component)
        {
            //���ü̳���ע��ӿ�IDIRegisterBinding����
            dependencyInjectContext.InvokeBindInjectInterface(component);
        }
        #endregion

        #region ע������ֵ
        /// <summary>
        /// ע������ֵ
        /// </summary>
        /// <param name="component">�����ʵ��</param>
        public void InjectProperty(object component)
        {
            foreach (var property in component.GetType().GetUseInjectAttributeProperty())
            {
                dependencyInjectContext.InjectProperty(component, property);
            }
        }

        /// <summary>
        /// ע������ֵ
        /// </summary>
        /// <param name="component">�����ʵ��,������</param>
        public void InjectsProperty(object[] components)
        {
            foreach (object item in components)
            {
                foreach (var property in item.GetType().GetUseInjectAttributeProperty())
                {
                    dependencyInjectContext.InjectProperty(item, property);
                }
            }
            
        }
        #endregion

        #region ��ð�����ע��Ľӿ�
        /// <summary>
        /// ��ð�����ע��Ľӿ�
        /// </summary>
        /// <returns></returns>
        public IRegisterBinding GetRegisterBindingInterface()
        {
            return dependencyInjectContext;
        }
        #endregion

    }

}