// Bridges ThirdPersonController state into the Animator and layers procedural
// IK on top so limbs never look stiff:
//   - locomotion blend tree driven by Speed / Grounded / Crouch / Slide params
//   - foot IK: raycast each foot to the ground, plant it, tilt to the slope
//   - hand IK: optional weapon grip targets (left/right)
//   - head look-at with weight fade, and aim-driven spine twist
//
// Requires: Animator with a Humanoid avatar (IK passes need it) and IK Pass
// enabled on the base layer. Blend tree setup is in docs/CHARACTER_CONTROLLER.md.
using UnityEngine;

namespace LKZ.CrossPlatform.Character
{
    [RequireComponent(typeof(Animator))]
    public sealed class CharacterAnimationDriver : MonoBehaviour
    {
        [Header("Foot IK")]
        public bool footIK = true;
        public LayerMask groundMask = ~0;
        [Range(0f, 1f)] public float footIKWeight = 1f;
        public float footRayHeight = 0.5f;                 // ray start above ankle
        public float footOffset = 0.02f;                   // sole thickness

        [Header("Hand IK (weapon holding)")]
        public Transform leftHandTarget;                   // grip transforms on the weapon
        public Transform rightHandTarget;
        [Range(0f, 1f)] public float handIKWeight = 1f;

        [Header("Look At")]
        public Transform lookTarget;                       // aim point / camera focus
        [Range(0f, 1f)] public float lookWeight = 0.7f;

        [Header("Aim (spine twist)")]
        [Range(-60f, 60f)] public float aimPitch;          // set by camera each frame while aiming
        public bool aiming;
        public Transform spine;                            // chest/upper-spine bone

        Animator _anim;
        ThirdPersonController _controller;
        float _lookWeightSmooth;

        static readonly int SpeedHash = Animator.StringToHash("Speed");
        static readonly int GroundedHash = Animator.StringToHash("Grounded");
        static readonly int CrouchHash = Animator.StringToHash("Crouch");
        static readonly int SlideHash = Animator.StringToHash("Slide");
        static readonly int JumpHash = Animator.StringToHash("Jump");

        void Awake()
        {
            _anim = GetComponent<Animator>();
            _controller = GetComponentInParent<ThirdPersonController>();
            if (spine == null && _anim.isHuman)
                spine = _anim.GetBoneTransform(HumanBodyBones.UpperChest)
                     ?? _anim.GetBoneTransform(HumanBodyBones.Chest);
        }

        void Update()
        {
            if (_controller == null) return;
            var v = _controller.Velocity; v.y = 0;
            _anim.SetFloat(SpeedHash, v.magnitude, 0.08f, Time.deltaTime); // damped → smooth blends
            _anim.SetBool(GroundedHash, _controller.IsGrounded);
            _anim.SetBool(CrouchHash, _controller.Current == ThirdPersonController.State.Crouch);
            _anim.SetBool(SlideHash, _controller.Current == ThirdPersonController.State.Slide);
            if (_controller.Current == ThirdPersonController.State.Jump) _anim.SetTrigger(JumpHash);
        }

        // spine twist after the Animator so it stacks on the playing clip
        void LateUpdate()
        {
            if (aiming && spine != null)
                spine.rotation = Quaternion.AngleAxis(aimPitch, spine.right) * spine.rotation;
        }

        void OnAnimatorIK(int layerIndex)
        {
            if (footIK && _controller != null && _controller.IsGrounded)
            {
                PlantFoot(AvatarIKGoal.LeftFoot);
                PlantFoot(AvatarIKGoal.RightFoot);
            }
            if (leftHandTarget != null)
            {
                _anim.SetIKPositionWeight(AvatarIKGoal.LeftHand, handIKWeight);
                _anim.SetIKRotationWeight(AvatarIKGoal.LeftHand, handIKWeight);
                _anim.SetIKPosition(AvatarIKGoal.LeftHand, leftHandTarget.position);
                _anim.SetIKRotation(AvatarIKGoal.LeftHand, leftHandTarget.rotation);
            }
            if (rightHandTarget != null)
            {
                _anim.SetIKPositionWeight(AvatarIKGoal.RightHand, handIKWeight);
                _anim.SetIKRotationWeight(AvatarIKGoal.RightHand, handIKWeight);
                _anim.SetIKPosition(AvatarIKGoal.RightHand, rightHandTarget.position);
                _anim.SetIKRotation(AvatarIKGoal.RightHand, rightHandTarget.rotation);
            }
            // look-at with smooth weight so glances never snap
            float targetW = lookTarget != null ? lookWeight : 0f;
            _lookWeightSmooth = Mathf.MoveTowards(_lookWeightSmooth, targetW, 3f * Time.deltaTime);
            if (_lookWeightSmooth > 0.001f && lookTarget != null)
            {
                _anim.SetLookAtWeight(_lookWeightSmooth, 0.25f, 0.8f, 1f, 0.5f);
                _anim.SetLookAtPosition(lookTarget.position);
            }
        }

        void PlantFoot(AvatarIKGoal goal)
        {
            Vector3 footPos = _anim.GetIKPosition(goal);
            Vector3 origin = footPos + Vector3.up * footRayHeight;
            if (!Physics.Raycast(origin, Vector3.down, out RaycastHit hit,
                    footRayHeight + 0.6f, groundMask, QueryTriggerInteraction.Ignore))
                return;

            _anim.SetIKPositionWeight(goal, footIKWeight);
            _anim.SetIKRotationWeight(goal, footIKWeight * 0.7f);
            _anim.SetIKPosition(goal, hit.point + Vector3.up * footOffset);
            // tilt the foot onto the slope, keeping the clip's yaw
            Quaternion cur = _anim.GetIKRotation(goal);
            _anim.SetIKRotation(goal, Quaternion.FromToRotation(Vector3.up, hit.normal) * cur);
        }
    }
}
