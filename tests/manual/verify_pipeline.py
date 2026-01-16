import sys
import unittest
from unittest.mock import MagicMock, patch
from pathlib import Path
import os

# Add src to path
sys.path.append(str(Path(__file__).resolve().parent.parent.parent))

from celstate.generator import MediaGenerator
from celstate.orchestrator import Orchestrator
from celstate.job_store import JobStore

class TestPipeline(unittest.TestCase):
    def setUp(self):
        # Mock environment variables required by Generator
        self.env_patcher = patch.dict(os.environ, {
            "VERTEX_API_KEY": "fake_key",
            "VERTEX_PROJECT_ID": "fake_project",
            "VERTEX_LOCATION": "us-central1",
            "HF_TOKEN": "fake_token"
        })
        self.env_patcher.start()

    def tearDown(self):
        self.env_patcher.stop()

    @patch("src.celstate.generator.genai.Client")
    @patch("src.celstate.generator.CreativeInterpreter")
    def test_full_generation_flow(self, MockInterpreter, MockGenAIClient):
        # 1. Setup Mocks
        mock_interpreter_instance = MockInterpreter.return_value
        mock_interpreter_instance.interpret.return_value = "Creative Prompt"

        mock_genai_client = MockGenAIClient.return_value
        
        # Mock response for White and Black pass
        mock_response = MagicMock()
        mock_part = MagicMock()
        mock_part.inline_data.data = b"fake_image_bytes"
        mock_part.as_image.return_value = MagicMock() # Mock PIL Image
        mock_response.parts = [mock_part]
        
        mock_genai_client.models.generate_content.return_value = mock_response

        # 2. Setup Components
        # Mock processor to avoid OpenCV dependency in this unit test
        mock_processor = MagicMock()
        mock_processor.process_image.return_value = {"component": {"assets": {"test.png": "path"}}}
        
        # Use real JobStore (with temporary dir)
        import tempfile
        import shutil
        temp_dir = tempfile.mkdtemp()
        job_store = JobStore(Path(temp_dir))
        
        generator = MediaGenerator()
        orchestrator = Orchestrator(job_store, generator, mock_processor)
        
        # 3. Create Job
        job = job_store.create_job("icon", "test prompt", "test style")
        job_id = job["id"]
        
        # 4. Run Job (Synchronously for test)
        orchestrator.run_job(job_id)
        
        # 5. Verify Results
        final_job = job_store.get_job(job_id)
        
        print(f"Final Job Status: {final_job['status']}")
        if final_job['status'] == "failed":
            print(f"Error: {final_job.get('error')}")

        self.assertEqual(final_job["status"], "succeeded")
        self.assertEqual(final_job["progress_stage"], "completed")
        self.assertIsNotNone(final_job["component"])
        
        # Verify Interpreter was called
        mock_interpreter_instance.interpret.assert_called_once()
        
        # Verify Gemini called twice (white + black)
        self.assertEqual(mock_genai_client.models.generate_content.call_count, 2)
        
        # Cleanup
        shutil.rmtree(temp_dir)

    @patch("src.celstate.generator.genai.Client")
    def test_gemini_failure_handling(self, MockGenAIClient):
        # Setup failure
        mock_genai_client = MockGenAIClient.return_value
        mock_genai_client.models.generate_content.side_effect = Exception("API Quota Exceeded")
        
        # Setup Orchestrator
        mock_processor = MagicMock()
        import tempfile
        import shutil
        temp_dir = tempfile.mkdtemp()
        job_store = JobStore(Path(temp_dir))
        
        # We need to mock Interpreter too to avoid real network call or error
        with patch("src.celstate.generator.CreativeInterpreter") as MockInterpreter:
            generator = MediaGenerator()
            orchestrator = Orchestrator(job_store, generator, mock_processor)
            
            job = job_store.create_job("icon", "test prompt", "test style")
            orchestrator.run_job(job["id"])
            
            final_job = job_store.get_job(job["id"])
            
            print(f"Failure Test Status: {final_job['status']}")
            print(f"Captured Error: {final_job.get('error')}")
            
            self.assertEqual(final_job["status"], "failed")
            self.assertIn("API Quota Exceeded", final_job["error"])
            
        shutil.rmtree(temp_dir)

if __name__ == "__main__":
    unittest.main()
