import sys
import os
from pathlib import Path
import numpy as np
import logging

# Add project root to path
sys.path.append(str(Path(__file__).parent.parent))

from src.engine.core.analyzer import LayoutAnalyzer
from src.engine.core.interpreter import CreativeInterpreter, SYSTEM_PROMPT

def test_layout_analyzer():
    print("Testing LayoutAnalyzer...")
    analyzer = LayoutAnalyzer()
    
    # Test 1: Wide content zone (Row)
    # Width 200, Height 100 -> Ratio 2.0
    hint_wide = analyzer._analyze_layout_strategy(200, 100)
    print(f"Wide (200x100) Hint: {hint_wide}")
    assert hint_wide["suggested"] == "horizontal_row"
    assert hint_wide["avatar_alignment"] == "left"
    
    # Test 2: Tall content zone (Column)
    # Width 80, Height 100 -> Ratio 0.8
    hint_tall = analyzer._analyze_layout_strategy(80, 100)
    print(f"Tall (80x100) Hint: {hint_tall}")
    assert hint_tall["suggested"] == "vertical_column"
    
    # Test 3: Square content zone (Centered)
    # Width 100, Height 100 -> Ratio 1.0
    hint_square = analyzer._analyze_layout_strategy(100, 100)
    print(f"Square (100x100) Hint: {hint_square}")
    assert hint_square["suggested"] == "centered"

    print("LayoutAnalyzer tests passed!\n")

def test_interpreter_prompt():
    print("Testing CreativeInterpreter Prompt Structure...")
    # Mocking environment variable if not present just for instantiation check
    if not os.environ.get("HF_TOKEN"):
        os.environ["HF_TOKEN"] = "mock_token"
        
    interpreter = CreativeInterpreter()
    
    prompt = "A pill container"
    asset_type = "container"
    style = "Organic vines"
    
    # We can't easily mock the client call cleanly without a proper mock lib,
    # but we can verify the SYSTEM_PROMPT content and verify the user_message construction if we exposed it.
    # Since we modified interpret(), let's check if the code runs up to the client call.
    
    print("Verifying System Prompt contains 'Aperture vs. Frame'...")
    assert "THE GOLDEN RULE: \"Aperture vs. Frame\"" in SYSTEM_PROMPT
    assert "FUNCTIONAL APERTURE" in SYSTEM_PROMPT
    assert "DECORATIVE FRAME" in SYSTEM_PROMPT
    print("System Prompt verification passed!")

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    try:
        test_layout_analyzer()
        test_interpreter_prompt()
        print("All verification tests passed!")
    except AssertionError as e:
        print(f"Verification FAILED: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"An error occurred: {e}")
        sys.exit(1)
