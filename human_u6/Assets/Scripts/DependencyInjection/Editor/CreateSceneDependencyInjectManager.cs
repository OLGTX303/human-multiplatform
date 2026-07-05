using UnityEditor;
using UnityEngine;

namespace OLGTX.DependencyInject
{
    public class CreateSceneDependencyInjectManager
    {
        [UnityEditor.MenuItem("GameObject/OLGTX/��������ע�볡������", priority = 11)]
        private static void CreateEventSystemManager()
        {
            if (Object.FindFirstObjectByType<SceneDependencyInjectContextManager>() != null)
            {
                Debug.LogError("�������Ѿ���һ������ע����������ģ�����Ҫ����");
            }
            else
            {
                GameObject DIContext = new GameObject(nameof(SceneDependencyInjectContextManager));
                DIContext.AddComponent<SceneDependencyInjectContextManager>();
                Selection.activeObject = DIContext;
            }
        }
    }
}
