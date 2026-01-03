
import sys
import unittest
from unittest.mock import MagicMock, patch
from pathlib import Path

# Add project root to sys.path
sys.path.append(str(Path(__file__).resolve().parent.parent))

from src.mcp_server import generate_asset
from src.engine.core.orchestrator import Orchestrator
from google.api_core import exceptions as google_exceptions

class TestMCPErrorHandling(unittest.TestCase):
    
    def test_input_validation_length(self):
        """Test that inputs > 2000 chars are rejected immediately."""
        long_string = "a" * 2001
        
        # Call generate_asset (which is wrapped by FastMCP, but should be callable)
        # Note: If FastMCP wrapper changes signature, we might need to unwrap or adjust.
        # Assuming standard python decorator behavior where we can call it.
        result = generate_asset(
            prompt=long_string,
            asset_type="container",
            style_context="valid style"
        )
        
        print(f"\n[Test Input Length] Result: {result}")
        self.assertIn("error", result)
        self.assertIn("Validation Failed", result["error"])
        self.assertIn("prompt exceeds 2000 characters", str(result["details"]))

    def test_input_validation_type(self):
        """Test that invalid asset_type is rejected."""
        result = generate_asset(
            prompt="valid prompt",
            asset_type="invalid_type",
            style_context="valid style"
        )
        
        print(f"\n[Test Input Type] Result: {result}")
        self.assertIn("error", result)
        self.assertIn("asset_type must be", str(result["details"]))

    @patch('src.mcp_server.job_store')
    @patch('src.mcp_server.threading.Thread') # Don't spawn real threads
    def test_orchestrator_error_mapping(self, mock_thread, mock_job_store):
        """Test that orchestrator catches exceptions and maps them."""
        # This test needs to run logic normally INSIDE orchestrator.run_job
        # So we need to instantiate Orchestrator and run it synchronously.
        
        mock_job = {
            "id": "test-job-id",
            "type": "container", 
            "prompt": "test", 
            "style_context": "test",
            "name": "test_asset"
        }
        
        # Mock dependencies
        mock_generator = MagicMock()
        mock_processor = MagicMock()
        mock_store = MagicMock()
        mock_store.get_job.return_value = mock_job
        mock_store._get_job_dir.return_value = Path("/tmp/test_job")
        
        orchestrator = Orchestrator(mock_store, mock_generator, mock_processor)
        
        # Case 1: ResourceExhausted -> Rate Limit
        mock_generator.generate_image_pair.side_effect = google_exceptions.ResourceExhausted("Quota exceeded")
        
        orchestrator.run_job("test-job-id")
        
        # Verify save_job called with mapped error
        saved_job = mock_store.save_job.call_args[0][1] # arg 1 is job_id, arg 2 is job dict
        print(f"\n[Test Rate Limit] Saved Job State: {saved_job}")
        
        self.assertEqual(saved_job["status"], "failed")
        self.assertIn("Rate Limit Exceeded", saved_job["error"])
        self.assertEqual(saved_job["retry_after"], 60)

        # Case 2: HF Token Missing
        mock_generator.generate_image_pair.side_effect = RuntimeError("CreativeInterpreter not configured: HF_TOKEN environment variable is missing.")
        
        orchestrator.run_job("test-job-id")
        saved_job = mock_store.save_job.call_args[0][1]
        print(f"\n[Test Config Error] Saved Job State: {saved_job}")
        
        self.assertIn("Configuration Error", saved_job["error"])

if __name__ == '__main__':
    unittest.main()
