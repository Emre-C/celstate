"""
Unit tests for the CreativeInterpreter module.
"""

import unittest
from unittest.mock import MagicMock, patch
import os

from src.engine.core.interpreter import CreativeInterpreter, SYSTEM_PROMPT


class TestCreativeInterpreter(unittest.TestCase):
    """Tests for CreativeInterpreter class."""
    
    def test_passthrough_mode_without_hf_token(self):
        """When HF_TOKEN is not set, interpreter should return original prompt."""
        # Ensure HF_TOKEN is not set
        with patch.dict(os.environ, {}, clear=True):
            # Remove HF_TOKEN if it exists
            os.environ.pop("HF_TOKEN", None)
            
            interpreter = CreativeInterpreter()
            
            result = interpreter.interpret(
                prompt="A container for avatar",
                asset_type="container",
                style_context="Ghibli clouds"
            )
            
            self.assertEqual(result, "A container for avatar")
            self.assertIsNone(interpreter.client)
    
    @patch("src.engine.core.interpreter.OpenAI")
    def test_interpret_success(self, mock_openai_class):
        """When API succeeds, should return interpreted prompt."""
        # Mock the OpenAI client
        mock_client = MagicMock()
        mock_openai_class.return_value = mock_client
        
        # Mock the completion response
        mock_message = MagicMock()
        mock_message.content = "A soft, billowing cloud frame with gentle gradients..."
        mock_choice = MagicMock()
        mock_choice.message = mock_message
        mock_completion = MagicMock()
        mock_completion.choices = [mock_choice]
        mock_client.chat.completions.create.return_value = mock_completion
        
        with patch.dict(os.environ, {"HF_TOKEN": "test-token"}):
            interpreter = CreativeInterpreter()
            
            result = interpreter.interpret(
                prompt="A container for avatar",
                asset_type="container",
                style_context="Ghibli clouds"
            )
            
            self.assertEqual(result, "A soft, billowing cloud frame with gentle gradients...")
            
            # Verify the API was called correctly
            mock_client.chat.completions.create.assert_called_once()
            call_args = mock_client.chat.completions.create.call_args
            self.assertEqual(call_args.kwargs["model"], "moonshotai/Kimi-K2-Instruct-0905:groq")
            self.assertEqual(len(call_args.kwargs["messages"]), 2)
            self.assertEqual(call_args.kwargs["messages"][0]["role"], "system")
            self.assertEqual(call_args.kwargs["messages"][1]["role"], "user")
    
    @patch("src.engine.core.interpreter.OpenAI")
    def test_interpret_fallback_on_api_error(self, mock_openai_class):
        """When API fails, should fall back to original prompt."""
        mock_client = MagicMock()
        mock_openai_class.return_value = mock_client
        mock_client.chat.completions.create.side_effect = Exception("API Error")
        
        with patch.dict(os.environ, {"HF_TOKEN": "test-token"}):
            interpreter = CreativeInterpreter()
            
            result = interpreter.interpret(
                prompt="A button",
                asset_type="icon",
                style_context="Nature-inspired"
            )
            
            # Should return original prompt on failure
            self.assertEqual(result, "A button")
    
    @patch("src.engine.core.interpreter.OpenAI")
    def test_interpret_fallback_on_empty_response(self, mock_openai_class):
        """When API returns empty response, should fall back to original prompt."""
        mock_client = MagicMock()
        mock_openai_class.return_value = mock_client
        
        # Mock empty response
        mock_message = MagicMock()
        mock_message.content = ""
        mock_choice = MagicMock()
        mock_choice.message = mock_message
        mock_completion = MagicMock()
        mock_completion.choices = [mock_choice]
        mock_client.chat.completions.create.return_value = mock_completion
        
        with patch.dict(os.environ, {"HF_TOKEN": "test-token"}):
            interpreter = CreativeInterpreter()
            
            result = interpreter.interpret(
                prompt="A texture",
                asset_type="texture",
                style_context="Organic"
            )
            
            self.assertEqual(result, "A texture")
    
    def test_system_prompt_contains_whimsy_philosophy(self):
        """System prompt should encode the 'Whimsy' philosophy."""
        self.assertIn("Software Whimsy", SYSTEM_PROMPT)
        self.assertIn("Ghibli", SYSTEM_PROMPT)
        self.assertIn("IMAGINATIVE", SYSTEM_PROMPT)


if __name__ == '__main__':
    unittest.main()
