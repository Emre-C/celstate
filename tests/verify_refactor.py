import numpy as np
import sys
import os

# Add src to path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "../")))

from celstate.layout_analyzer import LayoutAnalyzer

def test_analyzer():
    print("Testing LayoutAnalyzer refactor...")
    
    # Create dummy RGBA image (100x100)
    # Center 50x50 transparent hole
    img = np.full((100, 100, 4), 255, dtype=np.uint8)
    
    # Make a hole in the center
    # 25-75 is 50 pixels
    img[25:75, 25:75, 3] = 0
    
    analyzer = LayoutAnalyzer()
    
    # Test analyze_transparency
    print("Running analyze_transparency...")
    transparency = analyzer.analyze_transparency(img)
    print(f"Transparency: {transparency}")
    
    # Expect center to be transparent
    # center_transparency should be 100% or close
    
    # Test analyze_full
    print("Running analyze_full...")
    result = analyzer.analyze_full(img)
    
    print("Safe Zone:", result.get("safe_zone"))
    print("Content Zones:", result.get("content_zones"))
    
    # Safe zone should be approx x=25, y=25, w=50, h=50
    sz = result["safe_zone"]
    assert sz["width"] > 40
    assert sz["height"] > 40
    
    print("Verification SUCCESS")

if __name__ == "__main__":
    test_analyzer()
