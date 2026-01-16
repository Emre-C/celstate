import unittest
from unittest.mock import MagicMock, patch
import os

# Set dummy env vars to prevent init errors
os.environ["VERTEX_PROJECT_ID"] = "dummy"
os.environ["VERTEX_LOCATION"] = "dummy"
os.environ["VERTEX_API_KEY"] = "dummy"
os.environ["HF_TOKEN"] = "dummy"

from celstate.interpreter import CreativeInterpreter

class TestOpticalSizing(unittest.TestCase):
    def setUp(self):
        self.interpreter = CreativeInterpreter()
        # Mock the OpenAI client
        self.interpreter.client = MagicMock()
        
        # Mock response to avoid actual API error
        mock_response = MagicMock()
        mock_response.choices[0].message.content = "Mocked Response"
        self.interpreter.client.chat.completions.create.return_value = mock_response

    def test_small_render_hint(self):
        """Test that small render hint (<128) logic is applied."""
        self.interpreter.interpret(
            prompt="icon", 
            asset_type="icon", 
            style_context="style", 
            render_size_hint=32
        )
        
        # Verify the call arguments
        call_args = self.interpreter.client.chat.completions.create.call_args
        messages = call_args.kwargs['messages']
        user_content = messages[1]['content']
        
        # Check if the hint text is present in the prompt
        self.assertIn("Render Hint: 32 px width", user_content)
        print("✅ Correctly passed 32px hint to context")

    def test_large_render_hint(self):
        """Test that large render hint (>400) logic is applied."""
        self.interpreter.interpret(
            prompt="container", 
            asset_type="container", 
            style_context="style", 
            render_size_hint=800
        )
        
        # Verify
        call_args = self.interpreter.client.chat.completions.create.call_args
        messages = call_args.kwargs['messages']
        user_content = messages[1]['content']
        
        self.assertIn("Render Hint: 800 px width", user_content)
        print("✅ Correctly passed 800px hint to context")

if __name__ == "__main__":
    unittest.main()
