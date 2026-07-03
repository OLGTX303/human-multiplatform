// Minimal orbit-follow camera with collision. If the project already uses
// Cinemachine, prefer a 3rd-person-follow vcam and delete this — the
// controller only needs *a* cameraTransform, it doesn't care whose.
using UnityEngine;
#if ENABLE_INPUT_SYSTEM
using UnityEngine.InputSystem;
#endif

namespace LKZ.CrossPlatform.Character
{
    public sealed class ThirdPersonCamera : MonoBehaviour
    {
        public Transform target;                            // usually a "CameraPivot" at chest height
        public float distance = 3.2f;
        public float sensitivity = 0.15f;
        public Vector2 pitchLimits = new Vector2(-35f, 65f);
        public LayerMask collisionMask = ~0;

        float _yaw, _pitch = 12f;

        void LateUpdate()
        {
            if (target == null) return;
#if ENABLE_INPUT_SYSTEM
            Vector2 look = Mouse.current?.delta.ReadValue() ?? Vector2.zero;
            if (Gamepad.current != null) look += Gamepad.current.rightStick.ReadValue() * 12f;
#else
            Vector2 look = new Vector2(Input.GetAxis("Mouse X") * 8f, Input.GetAxis("Mouse Y") * 8f);
#endif
            _yaw += look.x * sensitivity;
            _pitch = Mathf.Clamp(_pitch - look.y * sensitivity, pitchLimits.x, pitchLimits.y);

            Quaternion rot = Quaternion.Euler(_pitch, _yaw, 0f);
            Vector3 wish = target.position - rot * Vector3.forward * distance;

            // pull in on obstruction so walls never hide the character
            float d = distance;
            if (Physics.SphereCast(target.position, 0.2f, (wish - target.position).normalized,
                    out RaycastHit hit, distance, collisionMask, QueryTriggerInteraction.Ignore))
                d = hit.distance;

            transform.position = target.position - rot * Vector3.forward * d;
            transform.rotation = rot;
        }
    }
}
