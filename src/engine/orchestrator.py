import logging
import traceback
from pathlib import Path
from typing import Dict, Any

from src.engine.generator import MediaGenerator
from src.engine.processor import MediaProcessor
from src.engine.job_store import JobStore

logger = logging.getLogger(__name__)

class Orchestrator:
    def __init__(self, job_store: JobStore, generator: MediaGenerator, processor: MediaProcessor):
        self.job_store = job_store
        self.generator = generator
        self.processor = processor

    def run_job(self, job_id: str):
        job = self.job_store.get_job(job_id)
        if not job:
            logger.error(f"Job {job_id} not found")
            return

        job_dir = self.job_store._get_job_dir(job_id)
        studio_dir = job_dir / "studio"
        output_dir = job_dir / "outputs"

        try:
            job["status"] = "running"
            job["progress_stage"] = "generating"
            self.job_store.save_job(job_id, job)

            if job["type"] == "image":
                # 1. Generate white/black pass
                job["progress_stage"] = "generating_passes"
                self.job_store.save_job(job_id, job)
                
                paths = self.generator.generate_image_pair(
                    prompt=job["prompt"],
                    name=job["name"],
                    studio_dir=studio_dir
                )
                
                # 2. Process
                job["progress_stage"] = "processing_matting"
                self.job_store.save_job(job_id, job)
                
                result = self.processor.process_image(
                    white_path=Path(paths["white"]),
                    black_path=Path(paths["black"]),
                    name=job["name"],
                    output_dir=output_dir
                )
                
                job["component"] = result["component"]
                
            elif job["type"] == "video":
                # 1. Generate green screen video
                job["progress_stage"] = "generating_video"
                self.job_store.save_job(job_id, job)
                
                video_path = self.generator.generate_video(
                    prompt=job["prompt"],
                    name=job["name"],
                    studio_dir=studio_dir
                )
                
                # 2. Process
                job["progress_stage"] = "processing_chromakey"
                self.job_store.save_job(job_id, job)
                
                result = self.processor.process_video(
                    video_path=Path(video_path),
                    name=job["name"],
                    output_dir=output_dir
                )
                
                job["component"] = result["component"]

            job["status"] = "succeeded"
            job["progress_stage"] = "completed"
            self.job_store.save_job(job_id, job)

        except Exception as e:
            logger.error(f"Job {job_id} failed: {e}")
            logger.error(traceback.format_exc())
            job["status"] = "failed"
            job["error"] = str(e)
            job["progress_stage"] = "error"
            self.job_store.save_job(job_id, job)
