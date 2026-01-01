"""
Asset archiving utility for Celstate.
Promotes successful job outputs to a permanent, organized gallery in assets/archive/.
"""

import shutil
import logging
from pathlib import Path
from typing import List, Optional

logger = logging.getLogger(__name__)

class MediaArchiver:
    def __init__(self, archive_base: Optional[Path] = None):
        """Initialize the archiver.
        
        Args:
            archive_base: Base directory for the archive. Defaults to assets/archive/
        """
        if archive_base:
            self.archive_base = archive_base
        else:
            self.archive_base = Path(__file__).parent.parent.parent / "assets" / "archive"
            
        self.archive_base.mkdir(parents=True, exist_ok=True)

    def archive_job_assets(self, job_id: str, name: str, output_dir: Path) -> List[Path]:
        """Promote all files from a job's output directory to the archive.
        
        Args:
            job_id: The job UUID
            name: Human-readable name of the asset
            output_dir: Path to the job's outputs/ directory
            
        Returns:
            List of Paths to the archived files.
        """
        if not output_dir.exists():
            logger.warning(f"Output directory does not exist for job {job_id}: {output_dir}")
            return []

        # Create job-specific archive directory
        # Format: {job_id_prefix}_{name}
        safe_name = name.replace(" ", "_").lower()
        archive_name = f"{job_id[:8]}_{safe_name}"
        dest_dir = self.archive_base / archive_name
        dest_dir.mkdir(parents=True, exist_ok=True)

        archived_files = []
        for src_file in output_dir.iterdir():
            if src_file.is_file():
                dest_file = dest_dir / src_file.name
                shutil.copy2(src_file, dest_file)
                archived_files.append(dest_file)
                
        logger.info(f"Archived {len(archived_files)} files for job {job_id} to {dest_dir}")
        return archived_files
