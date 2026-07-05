using OLGTX.TypeEventSystem;
using System.Collections;
using System.Collections.Generic;
using UnityEditor;
using UnityEngine;

/// <summary>
/// �㼶�������Ҽ����������¼�ϵͳ����
/// </summary>
public class CreateTypeEventSystemManager
{
    [UnityEditor.MenuItem("GameObject/OLGTX/�����¼�ϵͳ������", priority = 11)]
    private static void CreateEventSystemManager()
    {
        if (Object.FindFirstObjectByType<TypeEventSystemManager>() != null)
        {
            Debug.LogError("�������Ѿ���һ�������¼�ϵͳ����������Ҫ����");
        }
        else
        {
            GameObject eventSystemGo = new GameObject("TypeEventSystemManager");
            eventSystemGo.AddComponent<TypeEventSystemManager>();
            Selection.activeObject = eventSystemGo;
        }
    }
}
