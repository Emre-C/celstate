
import unittest
from unittest.mock import MagicMock, patch
from pathlib import Path
import shutil
import tempfile

from celstate.orchestrator import Orchestrator
from celstate.job_store import JobStore

class TestOrchestratorTypes(unittest.TestCase):
    def setUp(self):
        self.test_dir = Path(tempfile.mkdtemp())
        self.job_store = JobStore(self.test_dir)
        self.generator = MagicMock()
        self.processor = MagicMock()
        self.orchestrator = Orchestrator(self.job_store, self.generator, self.processor)

    def tearDown(self):
        shutil.rmtree(self.test_dir)

    def test_run_job_container(self):
        # Create a container job
        job = self.job_store.create_job(
            asset_type="container",
            prompt="A test container",
            style_context="Test style"
        )
        job_id = job["id"]

        # Mock generator output
        self.generator.generate_image_pair.return_value = {
            "white": str(self.test_dir / "white.png"),
            "black": str(self.test_dir / "black.png")
        }

        # Mock processor output
        self.processor.process_image.return_value = {
            "component": {"some": "data"}
        }

        # Run job
        self.orchestrator.run_job(job_id)

        # Verify generator was called
        self.generator.generate_image_pair.assert_called_once()
        
        # Verify job status
        updated_job = self.job_store.get_job(job_id)
        self.assertEqual(updated_job["status"], "succeeded")
        self.assertEqual(updated_job["component"], {"some": "data"})

    def test_run_job_icon(self):
        # Create an icon job
        job = self.job_store.create_job(
            asset_type="icon",
            prompt="A test icon",
            style_context="Test style"
        )
        job_id = job["id"]

        # Mock generator/processor
        self.generator.generate_image_pair.return_value = {
            "white": "w", "black": "b"
        }
        self.processor.process_image.return_value = {
            "component": {"icon": "data"}
        }

        self.orchestrator.run_job(job_id)
        
        self.generator.generate_image_pair.assert_called_once()
        updated_job = self.job_store.get_job(job_id)
        self.assertEqual(updated_job["component"], {"icon": "data"})

if __name__ == '__main__':
    unittest.main()
