using System.Collections.Generic;
using UnityEngine;

namespace LKZ.CrossPlatform.Display
{
    /// <summary>
    /// True cross-platform "hologram": renders the character from 4 orthogonal
    /// directions and lays the views out in a + (plus) pattern on a black screen.
    /// Place a transparent 4-sided pyramid (Pepper's Ghost) on the display and
    /// each face reflects one view, producing a floating 3D image.
    ///
    /// Works identically on Windows / macOS / Linux / Android / iOS / WebGL
    /// because it is pure camera + viewport work - zero native code.
    ///
    /// Also supports SingleReflection mode (one flipped view at the top of the
    /// screen) for 45-degree-glass showcases and holographic fan uploads.
    /// </summary>
    public sealed class PepperGhostPyramidDisplay : IHolographicDisplay
    {
        public string DisplayName => "Pepper's Ghost Pyramid (4-view)";
        public bool IsSupported => true; // every platform

        /// <summary>Distance of each virtual camera from the character.</summary>
        public float CameraDistance = 2.2f;
        /// <summary>Height offset the cameras look at (roughly chest height).</summary>
        public float LookAtHeight = 1.2f;
        /// <summary>Size of each square viewport as a fraction of the shorter screen edge.</summary>
        [Range(0.2f, 0.5f)] public float ViewSize = 0.32f;
        /// <summary>If true only one mirrored view is rendered (45° glass / holo fan).</summary>
        public bool SingleViewMode = false;

        private readonly List<Camera> _rigCameras = new List<Camera>();
        private Camera _clearCamera;

        public void Initialize(Camera mainCamera, Transform characterRoot)
        {
            // Main camera becomes a pure black background clearer.
            _clearCamera = mainCamera;
            _clearCamera.clearFlags = CameraClearFlags.SolidColor;
            _clearCamera.backgroundColor = Color.black;
            _clearCamera.cullingMask = 0;           // renders nothing
            _clearCamera.depth = -10;

            Vector3 target = characterRoot.position + Vector3.up * LookAtHeight;

            if (SingleViewMode)
            {
                CreateView("Holo_Front", target, characterRoot, 180f, TopCenterRect(), flipY: true);
                return;
            }

            // Four views: front (bottom), back (top), left (left), right (right).
            // Each view is rotated so the reflection in the pyramid face is upright.
            CreateView("Holo_Front", target, characterRoot,   0f, BottomRect(), rollDeg: 0f);
            CreateView("Holo_Back",  target, characterRoot, 180f, TopRect(),    rollDeg: 180f);
            CreateView("Holo_Left",  target, characterRoot,  90f, LeftRect(),   rollDeg: -90f);
            CreateView("Holo_Right", target, characterRoot, -90f, RightRect(),  rollDeg: 90f);
        }

        private void CreateView(string name, Vector3 target, Transform character,
                                float yawDeg, Rect viewport, float rollDeg = 0f, bool flipY = false)
        {
            var go = new GameObject(name);
            go.transform.SetParent(character, false);

            Vector3 dir = Quaternion.Euler(0, yawDeg, 0) * Vector3.back;
            go.transform.position = target + dir * CameraDistance;
            go.transform.LookAt(target);
            go.transform.Rotate(0, 0, rollDeg, Space.Self);

            var cam = go.AddComponent<Camera>();
            cam.clearFlags = CameraClearFlags.SolidColor;
            cam.backgroundColor = Color.black;   // black = invisible in the reflection
            cam.rect = viewport;
            cam.fieldOfView = 30f;
            cam.depth = 0;

            if (flipY)
            {
                // Mirror vertically for a single 45° reflector.
                cam.projectionMatrix = cam.projectionMatrix * Matrix4x4.Scale(new Vector3(1, -1, 1));
                // Flipped projection inverts winding; URP handles this, but if you
                // see inside-out geometry, invert culling via a RendererFeature.
            }

            _rigCameras.Add(cam);
        }

        // --- Viewport layout (normalized, square views arranged in a plus) ---
        private float SquareH() => ViewSize;                                        // height fraction
        private float SquareW() => ViewSize * Screen.height / (float)Screen.width;  // width fraction, keeps square pixels

        private Rect BottomRect()    => Square(0.5f, 0f);
        private Rect TopRect()       => Square(0.5f, 1f - SquareH());
        private Rect LeftRect()      => Square(SquareW() / 2f, 0.5f - SquareH() / 2f);
        private Rect RightRect()     => Square(1f - SquareW() / 2f, 0.5f - SquareH() / 2f);
        private Rect TopCenterRect() => Square(0.5f, 1f - SquareH());

        private Rect Square(float centerX, float y)
        {
            float w = SquareW(), h = SquareH();
            return new Rect(centerX - w / 2f, Mathf.Clamp01(y), w, h);
        }

        public void Shutdown()
        {
            foreach (var c in _rigCameras)
                if (c) Object.Destroy(c.gameObject);
            _rigCameras.Clear();
            if (_clearCamera)
            {
                _clearCamera.cullingMask = ~0;
                _clearCamera.depth = -1;
            }
        }
    }

    /// <summary>Plain fullscreen view - the safe default on every platform.</summary>
    public sealed class StandardDisplay : IHolographicDisplay
    {
        public string DisplayName => "Standard";
        public bool IsSupported => true;
        public void Initialize(Camera mainCamera, Transform characterRoot) { }
        public void Shutdown() { }
    }
}
