// Third-person character controller: CharacterController capsule, camera-
// relative movement with acceleration/deceleration, and a small explicit
// state machine (Idle/Walk/Run/Sprint/Crouch/Jump/Fall/Slide).
//
// Input: uses the new Input System when the project enables it, and falls
// back to the legacy axes otherwise, so the package compiles everywhere.
// Combat/vault/swim/vehicle states are declared in the enum with entry hooks
// (TrySetAction) but need animation clips this repo doesn't ship — wire them
// in the Animator when the clips exist (see docs/CHARACTER_CONTROLLER.md).
using UnityEngine;
#if ENABLE_INPUT_SYSTEM
using UnityEngine.InputSystem;
#endif

namespace LKZ.CrossPlatform.Character
{
    [RequireComponent(typeof(CharacterController))]
    public sealed class ThirdPersonController : MonoBehaviour
    {
        public enum State { Idle, Walk, Run, Sprint, Crouch, Jump, Fall, Slide, Action }

        [Header("Movement (m/s)")]
        public float walkSpeed = 2.0f;
        public float runSpeed = 4.5f;
        public float sprintSpeed = 7.0f;
        public float crouchSpeed = 1.4f;
        public float acceleration = 12f;
        public float deceleration = 16f;
        [Tooltip("Degrees/sec the character turns toward move direction.")]
        public float turnSpeed = 720f;

        [Header("Jump / Air")]
        public float jumpHeight = 1.1f;
        public float gravityScale = 1.5f;
        public float coyoteTime = 0.12f;                   // grace after leaving a ledge

        [Header("Slide")]
        public float slideSpeed = 8f;
        public float slideDuration = 0.8f;

        [Header("References")]
        public Transform cameraTransform;                  // orbit camera or Cinemachine brain

        public State Current { get; private set; } = State.Idle;
        public Vector3 Velocity => _velocity;
        public bool IsGrounded => _controller.isGrounded;

        CharacterController _controller;
        Vector3 _velocity;                                 // world, includes vertical
        float _speed;                                      // horizontal scalar (smoothed)
        float _groundedGraceLeft;
        float _slideLeft;
        bool _crouchHeld;

        void Awake()
        {
            _controller = GetComponent<CharacterController>();
            if (cameraTransform == null && Camera.main != null)
                cameraTransform = Camera.main.transform;
        }

        void Update()
        {
            ReadInput(out Vector2 move, out bool sprint, out bool jump, out bool crouch, out bool slide);
            _crouchHeld = crouch;

            bool grounded = _controller.isGrounded;
            _groundedGraceLeft = grounded ? coyoteTime : _groundedGraceLeft - Time.deltaTime;

            // ------- state transitions
            if (Current == State.Slide)
            {
                _slideLeft -= Time.deltaTime;
                if (_slideLeft <= 0f) Current = crouch ? State.Crouch : State.Run;
            }
            else if (!grounded && _velocity.y < -0.5f) Current = State.Fall;
            else if (jump && _groundedGraceLeft > 0f)
            {
                _velocity.y = Mathf.Sqrt(2f * -Physics.gravity.y * gravityScale * jumpHeight);
                Current = State.Jump;
                _groundedGraceLeft = 0f;
            }
            else if (slide && grounded && _speed > runSpeed * 0.8f)
            {
                Current = State.Slide;
                _slideLeft = slideDuration;
            }
            else if (grounded)
            {
                float mag = move.magnitude;
                Current = crouch ? State.Crouch
                    : mag < 0.05f ? State.Idle
                    : sprint && mag > 0.6f ? State.Sprint
                    : mag > 0.55f ? State.Run
                    : State.Walk;
            }

            // ------- horizontal movement, camera-relative
            Vector3 wishDir = Vector3.zero;
            if (move.sqrMagnitude > 0.001f && cameraTransform != null)
            {
                Vector3 fwd = Vector3.ProjectOnPlane(cameraTransform.forward, Vector3.up).normalized;
                Vector3 right = Vector3.Cross(Vector3.up, fwd);
                wishDir = (fwd * move.y + right * move.x).normalized;
            }

            float targetSpeed = Current switch
            {
                State.Sprint => sprintSpeed,
                State.Run => runSpeed,
                State.Walk => walkSpeed,
                State.Crouch => crouchSpeed * move.magnitude,
                State.Slide => slideSpeed,
                State.Jump or State.Fall => _speed,        // keep air momentum
                _ => 0f,
            };
            float accel = targetSpeed > _speed ? acceleration : deceleration;
            _speed = Mathf.MoveTowards(_speed, targetSpeed, accel * Time.deltaTime);

            // slide continues along facing; everything else follows input
            Vector3 planar = Current == State.Slide ? transform.forward * _speed
                : wishDir * _speed;

            // face movement direction (not while sliding)
            if (wishDir.sqrMagnitude > 0.001f && Current != State.Slide)
            {
                Quaternion look = Quaternion.LookRotation(wishDir);
                transform.rotation = Quaternion.RotateTowards(transform.rotation, look, turnSpeed * Time.deltaTime);
            }

            // ------- gravity + move
            _velocity = new Vector3(planar.x, _velocity.y, planar.z);
            _velocity.y += Physics.gravity.y * gravityScale * Time.deltaTime;
            if (grounded && _velocity.y < -2f) _velocity.y = -2f;   // stick to slopes
            _controller.Move(_velocity * Time.deltaTime);

            // crouch capsule
            float targetHeight = (Current == State.Crouch || Current == State.Slide) ? 1.1f : 1.75f;
            _controller.height = Mathf.MoveTowards(_controller.height, targetHeight, 6f * Time.deltaTime);
            _controller.center = new Vector3(0, _controller.height * 0.5f, 0);
        }

        // External systems (combat, vault, vehicles) reserve the body here;
        // the Animator plays the montage/clip, then calls ReleaseAction().
        public bool TrySetAction()
        {
            if (Current == State.Action) return false;
            Current = State.Action;
            return true;
        }
        public void ReleaseAction() { if (Current == State.Action) Current = State.Idle; }

        void ReadInput(out Vector2 move, out bool sprint, out bool jump, out bool crouch, out bool slide)
        {
#if ENABLE_INPUT_SYSTEM
            var kb = Keyboard.current;
            var pad = Gamepad.current;
            move = Vector2.zero;
            if (kb != null)
                move = new Vector2((kb.dKey.isPressed ? 1 : 0) - (kb.aKey.isPressed ? 1 : 0),
                                   (kb.wKey.isPressed ? 1 : 0) - (kb.sKey.isPressed ? 1 : 0));
            if (pad != null && pad.leftStick.ReadValue().sqrMagnitude > 0.01f)
                move = pad.leftStick.ReadValue();
            sprint = (kb?.leftShiftKey.isPressed ?? false) || (pad?.leftStickButton.isPressed ?? false);
            jump = (kb?.spaceKey.wasPressedThisFrame ?? false) || (pad?.buttonSouth.wasPressedThisFrame ?? false);
            crouch = (kb?.leftCtrlKey.isPressed ?? false) || (pad?.buttonEast.isPressed ?? false);
            slide = (kb?.cKey.wasPressedThisFrame ?? false) || (pad?.rightStickButton.wasPressedThisFrame ?? false);
#else
            move = new Vector2(Input.GetAxis("Horizontal"), Input.GetAxis("Vertical"));
            sprint = Input.GetKey(KeyCode.LeftShift);
            jump = Input.GetKeyDown(KeyCode.Space);
            crouch = Input.GetKey(KeyCode.LeftControl);
            slide = Input.GetKeyDown(KeyCode.C);
#endif
        }
    }
}
