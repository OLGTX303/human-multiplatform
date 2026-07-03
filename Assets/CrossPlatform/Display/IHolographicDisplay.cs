using UnityEngine;

namespace LKZ.CrossPlatform.Display
{
    /// <summary>
    /// Abstraction over how the digital human is presented "holographically"
    /// on each platform. The rest of the app never touches Win32 or any
    /// platform API directly - it only talks to this interface.
    /// </summary>
    public interface IHolographicDisplay
    {
        /// <summary>Human-readable name for logging/UI.</summary>
        string DisplayName { get; }

        /// <summary>True if this display mode can run on the current platform.</summary>
        bool IsSupported { get; }

        /// <summary>Set up cameras / window / render targets.</summary>
        void Initialize(Camera mainCamera, Transform characterRoot);

        /// <summary>Tear down (restore window styles, destroy extra cameras...).</summary>
        void Shutdown();
    }

    public enum HoloDisplayMode
    {
        /// <summary>Normal opaque window / fullscreen (all platforms).</summary>
        Standard,
        /// <summary>Borderless transparent always-on-top desktop overlay (Windows desktop mate).</summary>
        TransparentDesktopOverlay,
        /// <summary>4-view Pepper's Ghost pyramid layout (all platforms, incl. mobile + WebGL).</summary>
        PepperGhostPyramid,
        /// <summary>Single mirrored view for a 45° glass / holographic fan display.</summary>
        SingleReflection,
        /// <summary>Side-by-side stereo for looking-glass style or simple HMD preview.</summary>
        StereoSideBySide
    }
}
