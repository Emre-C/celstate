import json
import logging
import os
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from celstate.convex_sync import ConvexSync, ConvexSyncError

logger = logging.getLogger(__name__)


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class JobStore:
    def __init__(self, base_dir: Path, convex_sync: Optional[ConvexSync] = None):
        self.base_dir = base_dir
        self.base_dir.mkdir(parents=True, exist_ok=True)
        self.convex_sync = convex_sync or ConvexSync()

    def _get_job_dir(self, job_id: str) -> Path:
        return self.base_dir / job_id

    def _get_job_file(self, job_id: str) -> Path:
        return self._get_job_dir(job_id) / "job.json"

    def create_job(
        self,
        asset_type: str,
        prompt: str,
        style_context: str,
        layout_intent: str = "auto",
        name: Optional[str] = None,
        render_size_hint: Optional[int] = None,
        **kwargs,
    ) -> Dict[str, Any]:
        job_id = str(uuid.uuid4())
        job_dir = self._get_job_dir(job_id)
        job_dir.mkdir(parents=True, exist_ok=True)
        
        # Create subdirs for studio, outputs, and traces
        (job_dir / "studio").mkdir(exist_ok=True)
        (job_dir / "outputs").mkdir(exist_ok=True)
        (job_dir / "trace").mkdir(exist_ok=True)

        job_data = {
            "id": job_id,
            "status": "queued",
            "type": asset_type,
            "layout_intent": layout_intent,
            "prompt": prompt,
            "style_context": style_context,
            "name": name or f"asset_{job_id[:8]}",
            "created_at": _utcnow_iso(),
            "updated_at": _utcnow_iso(),
            "progress_stage": "initialized",
            "component": None,
            "error": None,
        }

        if render_size_hint is not None:
            job_data["render_size_hint"] = render_size_hint
        
        if kwargs:
            job_data.update(kwargs)

        
        self.save_job(job_id, job_data)
        return job_data

    def save_job(self, job_id: str, data: Dict[str, Any], sync: bool = True):
        data["updated_at"] = _utcnow_iso()
        job_file = self._get_job_file(job_id)
        
        # Atomic write: write to temp file then rename
        # This prevents race conditions where reader sees partial/empty file
        with tempfile.NamedTemporaryFile("w", dir=self._get_job_dir(job_id), delete=False) as tf:
            json.dump(data, tf, indent=2)
            temp_name = tf.name
            
        try:
            os.replace(temp_name, job_file)
        except Exception as e:
            # Fallback cleanup if replace fails (unlikely)
            if os.path.exists(temp_name):
                os.remove(temp_name)
            raise e

        if sync:
            self._sync_job(data)

    def get_job(self, job_id: str) -> Optional[Dict[str, Any]]:
        job_file = self._get_job_file(job_id)
        if not job_file.exists():
            return None
        with open(job_file, "r") as f:
            return json.load(f)

    def list_jobs(self) -> List[Dict[str, Any]]:
        jobs = []
        for job_dir in self.base_dir.iterdir():
            if job_dir.is_dir():
                job = self.get_job(job_dir.name)
                if job:
                    jobs.append(job)
        return sorted(jobs, key=lambda x: x["created_at"], reverse=True)

    def _sync_job(self, data: Dict[str, Any]) -> None:
        if not self.convex_sync.enabled:
            return
        try:
            self.convex_sync.upsert_job(data)
        except ConvexSyncError as exc:
            if self.convex_sync.strict:
                raise
            logger.warning("Convex sync failed (non-strict): %s", exc)
