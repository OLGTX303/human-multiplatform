using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.RenderGraphModule;
using UnityEngine.Rendering.RenderGraphModule.Util;
using UnityEngine.Rendering.Universal;

namespace OLGTX.TransparentWindow
{
    public class TransparentWindowRendererFeature : ScriptableRendererFeature
    {
        public RenderPassEvent m_CopyColorEvent = RenderPassEvent.AfterRenderingTransparents;
        public Material blitMaterial;

        Pass pass;

        public class Pass : ScriptableRenderPass
        {
            static readonly int MainTexId = Shader.PropertyToID("_MainTex");
            private Material m_Material;

            public Pass()
            {
            }

            public void Setup(RenderPassEvent evt, Material mat)
            {
                renderPassEvent = evt;
                m_Material = mat;
                // blit reads the camera color — never the backbuffer directly
                requiresIntermediateTexture = true;
            }

            // ---- Unity 6 Render Graph path: blit camera color through the
            // transparency material into a new target that becomes the camera color
            public override void RecordRenderGraph(RenderGraph renderGraph, ContextContainer frameData)
            {
                if (m_Material == null)
                    return;
                var resourceData = frameData.Get<UniversalResourceData>();
                var cameraData = frameData.Get<UniversalCameraData>();
                if (cameraData.cameraType != CameraType.Game)
                    return;

                if (resourceData.isActiveTargetBackBuffer)
                {
                    Debug.LogError("Skipping TransparentWindow pass. Requires an intermediate ColorTexture, we can't use the BackBuffer as a texture input.");
                    return;
                }

                TextureHandle source = resourceData.activeColorTexture;
                var desc = renderGraph.GetTextureDesc(source);
                desc.name = "_TransparentWindowColor";
                desc.clearBuffer = false;
                TextureHandle dest = renderGraph.CreateTexture(desc);

                var para = new RenderGraphUtils.BlitMaterialParameters(source, dest, m_Material, 0);
                para.sourceTexturePropertyID = MainTexId;   // the shader graph samples _MainTex
                renderGraph.AddBlitPass(para, "TransparentWindow Blit");

                resourceData.cameraColor = dest;
            }

            // ---- Compatibility Mode path (Render Graph disabled)
            public void SetInput(RTHandle src)
            {
                if (m_Material != null)
                    m_Material.SetTexture(MainTexId, src.rt);
            }

            [System.Obsolete]
            public override void Execute(ScriptableRenderContext context, ref RenderingData renderingData)
            {
                if (m_Material == null)
                    return;
                CommandBuffer cmd = CommandBufferPool.Get();
                {
                    Blit(cmd, ref renderingData, m_Material);
                }
                context.ExecuteCommandBuffer(cmd);
                cmd.Clear();
                CommandBufferPool.Release(cmd);
            }
        }

        public override void AddRenderPasses(ScriptableRenderer renderer, ref RenderingData renderingData)
        {
            if (renderingData.cameraData.cameraType != CameraType.Game)
                return;

            if (blitMaterial == null)
            {
                Debug.LogWarning(name + " blitMaterial is null and will be skipped.");
                return;
            }

            if (pass == null)
            {
                pass = new Pass();
            }
            pass.Setup(m_CopyColorEvent, blitMaterial);
            renderer.EnqueuePass(pass);
        }

        [System.Obsolete]
        public override void SetupRenderPasses(ScriptableRenderer renderer, in RenderingData renderingData)
        {
            // only invoked in Compatibility Mode; Render Graph binds the source itself
            if (renderingData.cameraData.cameraType != CameraType.Game)
                return;

            if (pass != null)
                pass.SetInput(renderer.cameraColorTargetHandle);
        }

        public override void Create()
        {
            pass = new Pass();
            pass.Setup(m_CopyColorEvent, blitMaterial);
        }
    }
}
