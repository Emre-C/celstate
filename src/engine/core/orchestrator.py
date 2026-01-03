import logging
import traceback
from pathlib import Path
from typing import Dict, Any
from google.api_core import exceptions as google_exceptions

import cv2

from src.engine.core.generator import MediaGenerator
from src.engine.core.processor import MediaProcessor
from src.engine.core.job_store import JobStore

from src.engine.core.analyzer import LayoutAnalyzer
from src.engine.core.tracer import Tracer

logger = logging.getLogger(__name__)

class Orchestrator:
    def __init__(self, job_store: JobStore, generator: MediaGenerator, processor: MediaProcessor):
        self.job_store = job_store
        self.generator = generator
        self.processor = processor

        self.analyzer = LayoutAnalyzer()

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

            if job["type"] in ["image", "container", "icon", "texture"]:
                # 1. Generate white/black pass
                job["progress_stage"] = "generating_passes"
                self.job_store.save_job(job_id, job)
                
                paths = self.generator.generate_image_pair(
                    prompt=job["prompt"],
                    name=job["name"],
                    studio_dir=studio_dir,
                    asset_type=job["type"],
                    style_context=job["style_context"],
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
            except Exception as trace_err:
                logger.error(f"Failed to save trace: {trace_err}")

        except Exception as e:
            logger.error(f"Job {job_id} failed: {e}")
            logger.error(traceback.format_exc())
            
            job["status"] = "failed"
            job["progress_stage"] = "error"
            
            # Map known exceptions to clean error messages
            trace_prefix = f"[TraceID: {job_id}]"
            
            if isinstance(e, google_exceptions.InvalidArgument):
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
                
            self.job_store.save_job(job_id, job)
            
            # Finalize trace (error path)
            try:
                trace_path = tracer.finalize(trace_dir)
                logger.info(f"Trace saved to {trace_path}")
            except Exception as trace_err:
                logger.error(f"Failed to save trace: {trace_err}")
