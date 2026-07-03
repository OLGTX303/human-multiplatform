#if UNITY_EDITOR
using System.Linq;
using UnityEditor;
using UnityEngine;

namespace LKZ.CrossPlatform.EditorTools
{
    /// <summary>
    /// One-click / CI builds for every platform.
    /// Menu: Tools > Holo Human > Build ...
    /// CLI:  Unity -batchmode -quit -projectPath . -executeMethod LKZ.CrossPlatform.EditorTools.MultiPlatformBuilder.BuildAll
    /// </summary>
    public static class MultiPlatformBuilder
    {
        private static string[] Scenes =>
            EditorBuildSettings.scenes.Where(s => s.enabled).Select(s => s.path).ToArray();

        private const string Out = "Builds";

        [MenuItem("Tools/Holo Human/Build Windows")]
        public static void BuildWindows() =>
            Build(BuildTarget.StandaloneWindows64, $"{Out}/Windows/HoloHuman.exe");

        [MenuItem("Tools/Holo Human/Build macOS")]
        public static void BuildMac() =>
            Build(BuildTarget.StandaloneOSX, $"{Out}/macOS/HoloHuman.app");

        [MenuItem("Tools/Holo Human/Build Linux")]
        public static void BuildLinux() =>
            Build(BuildTarget.StandaloneLinux64, $"{Out}/Linux/HoloHuman.x86_64");

        [MenuItem("Tools/Holo Human/Build Android")]
        public static void BuildAndroid()
        {
            PlayerSettings.Android.minSdkVersion = AndroidSdkVersions.AndroidApiLevel24;
            // RECORD_AUDIO is added automatically because Microphone API is referenced.
            Build(BuildTarget.Android, $"{Out}/Android/HoloHuman.apk");
        }

        [MenuItem("Tools/Holo Human/Build iOS (Xcode project)")]
        public static void BuildiOS()
        {
            PlayerSettings.iOS.cameraUsageDescription = "";
            PlayerSettings.iOS.microphoneUsageDescription = "Used for talking to the digital human.";
            Build(BuildTarget.iOS, $"{Out}/iOS");
        }

        [MenuItem("Tools/Holo Human/Build WebGL")]
        public static void BuildWebGL()
        {
            PlayerSettings.WebGL.compressionFormat = WebGLCompressionFormat.Brotli;
            PlayerSettings.WebGL.decompressionFallback = true;
            Build(BuildTarget.WebGL, $"{Out}/WebGL");
        }

        public static void BuildAll()
        {
            BuildWindows(); BuildLinux(); BuildAndroid(); BuildWebGL();
            // macOS/iOS require building on a Mac.
        }

        private static void Build(BuildTarget target, string path)
        {
            var opts = new BuildPlayerOptions
            {
                scenes = Scenes,
                target = target,
                locationPathName = path,
                options = BuildOptions.None
            };
            var report = BuildPipeline.BuildPlayer(opts);
            Debug.Log($"[Build] {target}: {report.summary.result} -> {path} " +
                      $"({report.summary.totalSize / (1024 * 1024)} MB)");
        }
    }
}
#endif
