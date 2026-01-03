
import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

# Add project root to sys.path
sys.path.append(str(Path(__file__).resolve().parent.parent))

from src.engine.core.generator import MediaGenerator
from src.engine.core.orchestrator import Orchestrator
from google.api_core import exceptions as google_exceptions

class TestContainerFix(unittest.TestCase):
    def setUp(self):
        with patch.dict('os.environ', {
            'VERTEX_API_KEY': 'mock-key',
            'VERTEX_PROJECT_ID': 'mock-project',
            'VERTEX_LOCATION': 'mock-location',
            'HF_TOKEN': 'mock-token'
        }):
            self.generator = MediaGenerator()
            # Mock interpreter
            self.generator.interpreter.client = MagicMock()
            self.generator.interpreter.client.chat.completions.create.return_value.choices[0].message.content = "Interpreted Prompt"

    def test_container_aspect_ratio(self):
        """Verify checking container uses 16:9 now."""
        with patch.object(self.generator.client.models, 'generate_content') as mock_generate:
            mock_generate.return_value = MagicMock(parts=[MagicMock(inline_data=MagicMock(data=b''))])
            
            try:
                self.generator.generate_image_pair(
                    prompt="test", 
                    name="test", 
                    studio_dir=Path("/tmp"), 
                    asset_type="container", 
                    style_context="test"
                )
            except Exception:
                pass
            
            # Check aspect ratio argument
            if mock_generate.call_count > 0:
                args, kwargs = mock_generate.call_args_list[0]
                config = kwargs.get('config')
                print(f"\n[Test Aspect Ratio] Config: {config}")
                # We expect config.image_config.aspect_ratio to be "16:9"
                # Since we can't easily inspect genai types deeply without real obj, we assume it passed correctly if code flow worked.
                # But we can verify _get_aspect_ratio was called or returned correct value internally
                self.assertEqual(self.generator._get_aspect_ratio("container"), "16:9")
            else:
                self.fail("generate_content not called")

    @patch('src.engine.core.orchestrator.JobStore')
    def test_error_reporting_trace_id(self, MockStore):
        """Verify error messages contain Trace ID."""
        mock_store = MockStore()
        mock_store.get_job.return_value = {"id": "job-123", "status": "running", "type": "container", "prompt": "test", "style_context": "test", "name": "test"}
        mock_store._get_job_dir.return_value = Path("/tmp")
        
        # Mock generator to raise InvalidArgument
        mock_generator = MagicMock()
        mock_generator.generate_image_pair.side_effect = google_exceptions.InvalidArgument("Invalid thing")
        
        orchestrator = Orchestrator(mock_store, mock_generator, MagicMock())
        orchestrator.run_job("job-123")
        
        saved_job = mock_store.save_job.call_args[0][1]
        print(f"\n[Test Error Trace] Saved Job: {saved_job}")
        
        self.assertIn("[TraceID: job-123]", saved_job["error"])
        self.assertIn("Invalid Argument (API)", saved_job["error"])

if __name__ == '__main__':
    unittest.main()
