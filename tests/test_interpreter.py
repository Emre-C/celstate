"""
Unit tests for the CreativeInterpreter module.
"""

import unittest
from unittest.mock import MagicMock, patch
import os

from celstate.interpreter import CreativeInterpreter, SYSTEM_PROMPT, infer_asset_type


class TestAssetTypeInference(unittest.TestCase):
    """Tests for asset type inference from prompt keywords."""
    
    def test_infer_container(self):
        self.assertEqual(infer_asset_type("a pill-shaped frame for avatars"), "container")
        self.assertEqual(infer_asset_type("chat bubble container"), "container")
        self.assertEqual(infer_asset_type("a card with rounded corners"), "container")
    
    def test_infer_icon(self):
        self.assertEqual(infer_asset_type("a glowing health potion icon"), "icon")
        self.assertEqual(infer_asset_type("submit button"), "icon")
        self.assertEqual(infer_asset_type("badge for achievements"), "icon")
    
    def test_infer_texture(self):
        self.assertEqual(infer_asset_type("seamless stone pattern"), "texture")
        self.assertEqual(infer_asset_type("tileable grass texture"), "texture")
    
    def test_infer_effect(self):
        self.assertEqual(infer_asset_type("floating sparkle particles"), "effect")
        self.assertEqual(infer_asset_type("glow animation effect"), "effect")
    
    def test_default_to_icon(self):
        self.assertEqual(infer_asset_type("a glowing health potion bottle"), "icon")
        self.assertEqual(infer_asset_type("something random"), "icon")


class TestCreativeInterpreter(unittest.TestCase):
    """Tests for CreativeInterpreter class."""
    
    def test_no_hf_token_raises_on_interpret(self):
        """When HF_TOKEN is not set, interpret() should raise RuntimeError."""
        with patch.dict(os.environ, {}, clear=True):
            os.environ.pop("HF_TOKEN", None)
            
            interpreter = CreativeInterpreter()
            self.assertIsNone(interpreter.client)
            
            with self.assertRaises(RuntimeError) as ctx:
                interpreter.interpret("A container for avatar")
            
            self.assertIn("HF_TOKEN", str(ctx.exception))
    
    @patch("celstate.interpreter.OpenAI")
    def test_interpret_success(self, mock_openai_class):
        """When API succeeds, should return interpreted prompt."""
        mock_client = MagicMock()
        mock_openai_class.return_value = mock_client
        
        mock_message = MagicMock()
        mock_message.content = "A pill-shaped frame. The center must be solid background color..."
        mock_choice = MagicMock()
        mock_choice.message = mock_message
        mock_completion = MagicMock()
        mock_completion.choices = [mock_choice]
        mock_completion.usage = None
        mock_client.chat.completions.create.return_value = mock_completion
        
        with patch.dict(os.environ, {"HF_TOKEN": "test-token"}):
            interpreter = CreativeInterpreter()
            
            result = interpreter.interpret("A pill-shaped frame for avatars")
            
            self.assertEqual(result, "A pill-shaped frame. The center must be solid background color...")
            
            mock_client.chat.completions.create.assert_called_once()
            call_args = mock_client.chat.completions.create.call_args
            self.assertEqual(call_args.kwargs["model"], "moonshotai/Kimi-K2-Instruct-0905:groq")
            self.assertEqual(call_args.kwargs["temperature"], 0.3)  # Lower temp for faithfulness
    
    @patch("celstate.interpreter.OpenAI")
    def test_interpret_raises_on_api_error(self, mock_openai_class):
        """When API fails, should raise exception (not fallback)."""
        mock_client = MagicMock()
        mock_openai_class.return_value = mock_client
        mock_client.chat.completions.create.side_effect = Exception("API Error")
        
        with patch.dict(os.environ, {"HF_TOKEN": "test-token"}):
            interpreter = CreativeInterpreter()
            
            with self.assertRaises(Exception):
                interpreter.interpret("A button")
    
    @patch("celstate.interpreter.OpenAI")
    def test_interpret_raises_on_empty_response(self, mock_openai_class):
        """When API returns empty response, should raise RuntimeError."""
        mock_client = MagicMock()
        mock_openai_class.return_value = mock_client
        
        mock_message = MagicMock()
        mock_message.content = ""
        mock_choice = MagicMock()
        mock_choice.message = mock_message
        mock_completion = MagicMock()
        mock_completion.choices = [mock_choice]
        mock_client.chat.completions.create.return_value = mock_completion
        
        with patch.dict(os.environ, {"HF_TOKEN": "test-token"}):
            interpreter = CreativeInterpreter()
            
            with self.assertRaises(RuntimeError) as ctx:
                interpreter.interpret("A texture")
            
            self.assertIn("empty", str(ctx.exception).lower())
    
    def test_system_prompt_focuses_on_transparency(self):
        """System prompt should focus on transparency, not aesthetics."""
        self.assertIn("transparency", SYSTEM_PROMPT.lower())
        self.assertIn("background", SYSTEM_PROMPT.lower())
        # The prompt should NOT inject Ghibli/Whimsy as positive directions
        # (they appear in "MUST NOT" section which is acceptable)
        self.assertNotIn("Software Whimsy", SYSTEM_PROMPT)
        self.assertNotIn("IMAGINATIVE", SYSTEM_PROMPT)
        self.assertIn("MUST NOT", SYSTEM_PROMPT)


if __name__ == '__main__':
    unittest.main()
