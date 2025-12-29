import json
import uuid
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, Optional, List

class JobStore:
    def __init__(self, base_dir: Path):
        self.base_dir = base_dir
        self.base_dir.mkdir(parents=True, exist_ok=True)

    def _get_job_dir(self, job_id: str) -> Path:
        return self.base_dir / job_id

    def _get_job_file(self, job_id: str) -> Path:
        return self._get_job_dir(job_id) / "job.json"

    def create_job(self, asset_type: str, prompt: str, name: Optional[str] = None) -> Dict[str, Any]:
        job_id = str(uuid.uuid4())
        job_dir = self._get_job_dir(job_id)
        job_dir.mkdir(parents=True, exist_ok=True)
        
        # Create subdirs for studio and outputs
        (job_dir / "studio").mkdir(exist_ok=True)
        (job_dir / "outputs").mkdir(exist_ok=True)

        job_data = {
            "id": job_id,
            "status": "queued",
            "type": asset_type,
            "prompt": prompt,
            "name": name or f"asset_{job_id[:8]}",
            "created_at": datetime.utcnow().isoformat(),
            "updated_at": datetime.utcnow().isoformat(),
            "progress_stage": "initialized",
            "component": None,
            "error": None
        }
        
        self.save_job(job_id, job_data)
        return job_data

    def save_job(self, job_id: str, data: Dict[str, Any]):
        data["updated_at"] = datetime.utcnow().isoformat()
        job_file = self._get_job_file(job_id)
        with open(job_file, "w") as f:
            json.dump(data, f, indent=2)

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
