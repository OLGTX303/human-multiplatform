using UnityEngine;
#if UNITY_STANDALONE_WIN && !UNITY_EDITOR
using System;
using System.Runtime.InteropServices;
#endif

namespace LKZ.CrossPlatform.Display
{
    /// <summary>
    /// Windows-only: borderless, click-through-optional, always-on-top transparent
    /// window ("desktop mate" hologram). This is the original TransparentWindow.cs
    /// behaviour wrapped behind IHolographicDisplay so other platforms simply
    /// never instantiate it.
    /// </summary>
    public sealed class WindowsTransparentOverlayDisplay : IHolographicDisplay
    {
        public string DisplayName => "Windows Transparent Desktop Overlay";

        public bool IsSupported
        {
            get
            {
#if UNITY_STANDALONE_WIN && !UNITY_EDITOR
                return true;
#else
                return false;
#endif
            }
        }

        // Window size/position of the overlay (matches original 540x960 portrait).
        public int Width = 540;
        public int Height = 960;

#if UNITY_STANDALONE_WIN && !UNITY_EDITOR
        private struct MARGINS { public int cxLeftWidth, cxRightWidth, cyTopHeight, cyBottomHeight; }

        [DllImport("user32.dll")] private static extern IntPtr GetActiveWindow();
        [DllImport("user32.dll")] private static extern int SetWindowLong(IntPtr hWnd, int nIndex, uint dwNewLong);
        [DllImport("Dwmapi.dll")] private static extern uint DwmExtendFrameIntoClientArea(IntPtr hWnd, ref MARGINS margins);
        [DllImport("user32.dll", EntryPoint = "SetWindowPos")]
        private static extern int SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int cx, int cy, int flags);

        const int GWL_STYLE = -16;
        const uint WS_POPUP = 0x80000000, WS_VISIBLE = 0x10000000;
        const int SWP_SHOWWINDOW = 0x0040;
        static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
#endif

        public void Initialize(Camera mainCamera, Transform characterRoot)
        {
#if UNITY_STANDALONE_WIN && !UNITY_EDITOR
            var margins = new MARGINS { cxLeftWidth = -1 };
            IntPtr hwnd = GetActiveWindow();
            SetWindowLong(hwnd, GWL_STYLE, WS_POPUP | WS_VISIBLE);
            var res = Screen.currentResolution;
            SetWindowPos(hwnd, HWND_TOPMOST, res.width - Width, res.height - Height - 30, Width, Height, SWP_SHOWWINDOW);
            DwmExtendFrameIntoClientArea(hwnd, ref margins);

            // Camera must clear to solid color with alpha 0 for DWM transparency.
            mainCamera.clearFlags = CameraClearFlags.SolidColor;
            mainCamera.backgroundColor = new Color(0, 0, 0, 0);
#else
            Debug.LogWarning("[Holo] TransparentDesktopOverlay requested on unsupported platform; falling back to Standard.");
#endif
        }

        public void Shutdown() { /* window styles restored on process exit */ }
    }
}
