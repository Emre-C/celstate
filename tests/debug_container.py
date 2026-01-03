
import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

# Add project root to sys.path
sys.path.append(str(Path(__file__).resolve().parent.parent))

from src.engine.core.generator import MediaGenerator
from google.api_core import exceptions as google_exceptions

class TestContainerFailure(unittest.TestCase):
    def setUp(self):
        with patch.dict('os.environ', {
            'VERTEX_API_KEY': 'mock-key',
            'VERTEX_PROJECT_ID': 'mock-project',
            'VERTEX_LOCATION': 'mock-location',
            'HF_TOKEN': 'mock-token'
        }):
            self.generator = MediaGenerator()
            self.generator.interpreter.client = MagicMock()
            self.generator.interpreter.client.chat.completions.create.return_value.choices[0].message.content = "Interpreted Prompt"
        
    def test_prompt_size_container(self):
        """Analyze the size of the prompt sent to Gemini for a container."""
        prompt = "A simple pill container"
        asset_type = "container"
        style_context = "Ghibli style, very detailed, fluffy clouds" # Medium length
        
        with patch.object(self.generator.client.models, 'generate_content') as mock_generate:
            mock_generate.return_value = MagicMock(parts=[MagicMock(inline_data=MagicMock(data=b''))])
            
            try:
                self.generator.generate_image_pair(
                    prompt=prompt, 
                    name="test", 
                    studio_dir=Path("/tmp"), 
                    asset_type=asset_type, 
                    style_context=style_context
                )
            except Exception:
                pass 
                
            # Get FIRST call (Generation Pass), not the second (Edit/Black Pass)
            if mock_generate.call_count > 0:
                args, kwargs = mock_generate.call_args_list[0]
                sent_prompt = kwargs['contents'][0]
                
                print(f"\n[Container Prompt Analysis]")
                print(f"Total Length: {len(sent_prompt)}")
                print(f"Token Estimate (char/4): {len(sent_prompt)/4}")
                print("--- Content Start ---")
                print(sent_prompt[:500])
                print("--- Content End ---")
                
                if len(sent_prompt) > 2000:
                    print("WARNING: Prompt might exceed 480 token limit!")
            else:
                print("Error: generate_content was not called")

    def test_prompt_size_icon(self):
        """Compare with Icon size."""
        prompt = "A simple icon"
        asset_type = "icon"
        style_context = "Ghibli style, very detailed, fluffy clouds"
        
        with patch.object(self.generator.client.models, 'generate_content') as mock_generate:
            mock_generate.return_value = MagicMock(parts=[MagicMock(inline_data=MagicMock(data=b''))])
            
            try:
                self.generator.generate_image_pair(
                    prompt=prompt, 
                    name="test", 
                    studio_dir=Path("/tmp"), 
                    asset_type=asset_type, 
                    style_context=style_context
                )
            except Exception:
                pass
                
            if mock_generate.call_count > 0:
                args, kwargs = mock_generate.call_args_list[0]
                sent_prompt = kwargs['contents'][0]
                print(f"\n[Icon Prompt Analysis]")
                print(f"Total Length: {len(sent_prompt)}")

if __name__ == '__main__':
    unittest.main()
