import logging
import traceback
from pathlib import Path
from google.api_core import exceptions as google_exceptions

import cv2

from celstate.convex_sync import ConvexSyncError
from celstate.generator import MediaGenerator
from celstate.processor import MediaProcessor
from celstate.job_store import JobStore

from celstate.layout_analyzer import LayoutAnalyzer
from celstate.tracer import Tracer

logger = logging.getLogger(__name__)

class Orchestrator:
    def __init__(self, job_store: JobStore, generator: MediaGenerator, processor: MediaProcessor):
        self.job_store = job_store
        self.generator = generator
        self.processor = processor

        self.analyzer = LayoutAnalyzer()

    def _upload_output_assets(self, job: dict, output_dir: Path) -> None:
        sync = self.job_store.convex_sync
        if not sync.enabled:
            return

        name = job["name"]
        required_assets = [
            ("output_png", output_dir / f"{name}.png", "image/png"),
            ("debug_png", output_dir / f"{name}_debug.png", "image/png"),
        ]
        optional_assets = [
            ("mask_png", output_dir / f"{name}_mask.png", "image/png"),
        ]

        for role, path, content_type in required_assets:
            if not path.exists():
                raise ConvexSyncError(f"Missing required output asset: {path}")
            try:
                sync.upload_asset(job["id"], path, role, content_type)
            except ConvexSyncError as exc:
                if sync.strict:
                    raise
                logger.warning("Convex asset upload failed (non-strict): %s", exc)

        for role, path, content_type in optional_assets:
            if path.exists():
                try:
                    sync.upload_asset(job["id"], path, role, content_type)
                except ConvexSyncError as exc:
                    if sync.strict:
                        raise
                    logger.warning("Convex asset upload failed (non-strict): %s", exc)

    def _upload_trace_artifact(self, job_id: str, trace_path: Path) -> None:
        sync = self.job_store.convex_sync
        if not sync.enabled:
            return
        if not trace_path.exists():
            logger.warning("Trace artifact missing for Convex upload: %s", trace_path)
            return
        try:
            sync.upload_asset(job_id, trace_path, "trace_json", "application/json")
        except ConvexSyncError as exc:
            logger.warning("Trace upload failed (non-fatal): %s", exc)

    def run_job(self, job_id: str):
        job = self.job_store.get_job(job_id)
        if not job:
            logger.error(f"Job {job_id} not found")
            return

        job_dir = self.job_store._get_job_dir(job_id)
        studio_dir = job_dir / "studio"
        output_dir = job_dir / "outputs"
        trace_dir = job_dir / "trace"
        
        # Initialize tracer for observability
        tracer = Tracer(job_id)
        tracer.record("input", {
            "prompt": job["prompt"],
            "asset_type": job["type"],
            "style_context": job["style_context"],
            "name": job["name"]
        })

        try:
            job["status"] = "running"
            job["progress_stage"] = "generating"
            self.job_store.save_job(job_id, job)

            if job["type"] in ["image", "container", "icon", "texture", "decoration", "effect"]:
                # 1. Generate white/black pass
                job["progress_stage"] = "generating_passes"
                self.job_store.save_job(job_id, job)
                
                # Extract render_size_hint from job (optional)
                render_size_hint = job.get("render_size_hint")
                if render_size_hint is not None:
                    try:
                        render_size_hint = int(render_size_hint)
                    except (ValueError, TypeError):
                        logger.warning(f"Invalid render_size_hint: {render_size_hint}. Ignoring.")
                        render_size_hint = None
                
                paths = self.generator.generate_image_pair(
                    prompt=job["prompt"],
                    name=job["name"],
                    studio_dir=studio_dir,
                    asset_type=job["type"],
                    style_context=job["style_context"],
                    render_size_hint=render_size_hint,
                    tracer=tracer
                )
                
                # 2. Process (difference matting)
                job["progress_stage"] = "processing_matting"
                self.job_store.save_job(job_id, job)
                
                result = self.processor.process_image(
                    white_path=Path(paths["white"]),
                    black_path=Path(paths["black"]),
                    name=job["name"],
                    output_dir=output_dir
                )
                
                job["component"] = result["component"]
                job["telemetry"] = result.get("telemetry")
                
                # 3. Quality Gate: Verify container has transparent hole
                if job["type"] == "container":
                    job["progress_stage"] = "verifying_container"
                    self.job_store.save_job(job_id, job)
                    
                    # Read the output image for verification
                    output_path = output_dir / f"{job['name']}.png"
                    rgba = cv2.imread(str(output_path), cv2.IMREAD_UNCHANGED)
                    
                    if rgba is not None:
                        hole_check = self.analyzer.verify_container_hole(rgba)
                        if not hole_check["valid"]:
                            raise ValueError(
                                f"Container quality check failed: {hole_check['message']}. "
                                f"Center transparency: {hole_check['center_transparency']:.1%}. "
                                "The generated asset does not have a usable transparent center for content placement."
                            )
                        logger.info(f"Container verified: {hole_check['center_transparency']:.1%} center transparency")

                # Upload output assets to Convex after verification
                self._upload_output_assets(job, output_dir)
                

            job["status"] = "succeeded"
            job["progress_stage"] = "completed"
            
            # Record successful output
            tracer.record("output", {
                "status": "succeeded",
                "component": job.get("component")
            })
            

                
            self.job_store.save_job(job_id, job)
            
            # Finalize trace (success path)
            try:
                trace_path = tracer.finalize(trace_dir)
                logger.info(f"Trace saved to {trace_path}")
                self._upload_trace_artifact(job_id, trace_path)
            except Exception as trace_err:
                logger.error(f"Failed to save trace: {trace_err}")

        except Exception as e:
            logger.error(f"Job {job_id} failed: {e}")
            logger.error(traceback.format_exc())
            
            job["status"] = "failed"
            job["progress_stage"] = "error"
            
            # Map known exceptions to clean error messages
            trace_prefix = f"[TraceID: {job_id}]"
            
            if isinstance(e, ConvexSyncError):
                job["error"] = f"{trace_prefix} Convex sync failed: {str(e)}"
            elif isinstance(e, google_exceptions.InvalidArgument):
                # Attempt to extract structured errors if available, otherwise use string
                # e.errors implies gRPC status details which might not always be populated in the python exception object directly as a list
                # But str(e) usually captures the message well.
                job["error"] = f"{trace_prefix} Invalid Argument (API). Details: {str(e)}"
            elif isinstance(e, google_exceptions.ResourceExhausted):
                job["error"] = f"{trace_prefix} Rate Limit Exceeded. Please try again later."
                job["retry_after"] = 60  # Suggest 60s cooldown
            elif isinstance(e, google_exceptions.PermissionDenied):
                job["error"] = f"{trace_prefix} API Permission Denied. Check credentials."
            elif isinstance(e, RuntimeError) and "HF_TOKEN" in str(e):
                job["error"] = f"{trace_prefix} Configuration Error: HF_TOKEN missing on server."
            else:
                job["error"] = f"{trace_prefix} {str(e)}"
            
            # Record error in trace
            tracer.record("error", {
                "status": "failed",
                "error": job["error"],
                "exception_type": type(e).__name__
            })
                
            should_sync = not isinstance(e, ConvexSyncError)
            try:
                self.job_store.save_job(job_id, job, sync=should_sync)
            except ConvexSyncError as sync_err:
                logger.error("Convex sync failed while saving failed job: %s", sync_err)
            
            # Finalize trace (error path)
            try:
                trace_path = tracer.finalize(trace_dir)
                logger.info(f"Trace saved to {trace_path}")
                self._upload_trace_artifact(job_id, trace_path)
            except Exception as trace_err:
                logger.error(f"Failed to save trace: {trace_err}")
