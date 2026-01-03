"""
Unit tests for LayoutAnalyzer LIR (Largest Inscribed Rectangle) implementation.
"""
import numpy as np
import pytest
from pathlib import Path
import tempfile

from src.engine.core.analyzer import LayoutAnalyzer


class TestFindLargestInscribedRectangle:
    """Tests for the LIR algorithm."""
    
    @pytest.fixture
    def analyzer(self):
        return LayoutAnalyzer()
    
    def test_full_transparent_image(self, analyzer):
        """A fully transparent image should return a safe zone covering the whole image."""
        # 100x50 fully transparent image (alpha = 0)
        rgba = np.zeros((50, 100, 4), dtype=np.uint8)
        
        result = analyzer.find_largest_inscribed_rectangle(rgba, safety_margin_ratio=0)
        
        assert result["x"] == 0
        assert result["y"] == 0
        assert result["width"] == 100
        assert result["height"] == 50
    
    def test_full_opaque_image(self, analyzer):
        """A fully opaque image should return a zero-size safe zone."""
        # 100x50 fully opaque image (alpha = 255)
        rgba = np.zeros((50, 100, 4), dtype=np.uint8)
        rgba[:, :, 3] = 255
        
        result = analyzer.find_largest_inscribed_rectangle(rgba, safety_margin_ratio=0)
        
        # Should have zero area
        assert result["width"] * result["height"] == 0
    
    def test_simple_frame(self, analyzer):
        """A simple 10px frame around a transparent center."""
        # 100x100 image with 10px opaque frame
        rgba = np.zeros((100, 100, 4), dtype=np.uint8)
        rgba[:, :, 3] = 255  # All opaque
        rgba[10:90, 10:90, 3] = 0  # Center transparent
        
        result = analyzer.find_largest_inscribed_rectangle(rgba, safety_margin_ratio=0)
        
        # Inner rectangle should be 80x80 starting at (10, 10)
        assert result["x"] == 10
        assert result["y"] == 10
        assert result["width"] == 80
        assert result["height"] == 80
    
    def test_safety_margin_erosion(self, analyzer):
        """Safety margin should erode the safe zone inward."""
        # 100x100 image with 10px opaque frame
        rgba = np.zeros((100, 100, 4), dtype=np.uint8)
        rgba[:, :, 3] = 255
        rgba[10:90, 10:90, 3] = 0  # 80x80 inner void
        
        # 5% margin on a 100px dim = 5px erosion
        result = analyzer.find_largest_inscribed_rectangle(rgba, safety_margin_ratio=0.05)
        
        # Should be smaller than without margin
        assert result["width"] < 80
        assert result["height"] < 80


class TestGenerateMask:
    """Tests for the updated generate_mask function."""
    
    @pytest.fixture
    def analyzer(self):
        return LayoutAnalyzer()
    
    def test_mask_inversion(self, analyzer):
        """Mask should be inverted: void=white, frame=black."""
        # 100x100 image with center void
        rgba = np.zeros((100, 100, 4), dtype=np.uint8)
        rgba[:, :, 3] = 255  # All opaque
        rgba[25:75, 25:75, 3] = 0  # Center transparent
        
        with tempfile.TemporaryDirectory() as tmpdir:
            mask_path = Path(tmpdir) / "mask.png"
            analyzer.generate_mask(rgba, mask_path, safety_margin_ratio=0)
            
            import cv2
            mask = cv2.imread(str(mask_path), cv2.IMREAD_GRAYSCALE)
            
            # Center should be white (255)
            assert mask[50, 50] == 255
            # Corners should be black (0)
            assert mask[5, 5] == 0


class TestAnalyzeFull:
    """Tests for analyze_full including safe_zone."""
    
    @pytest.fixture
    def analyzer(self):
        return LayoutAnalyzer()
    
    def test_safe_zone_in_result(self, analyzer):
        """analyze_full should return safe_zone in the result."""
        rgba = np.zeros((100, 100, 4), dtype=np.uint8)
        rgba[:, :, 3] = 255
        rgba[10:90, 10:90, 3] = 0
        
        result = analyzer.analyze_full(rgba)
        
        assert "safe_zone" in result
        assert "x" in result["safe_zone"]
        assert "y" in result["safe_zone"]
        assert "width" in result["safe_zone"]
        assert "height" in result["safe_zone"]
        assert result["safe_zone"]["width"] > 0
        assert "layout_bounds" in result
        assert result["layout_bounds"]["width"] > 0
        assert result["safe_zone"]["height"] > 0
    
    def test_safe_zone_json_serializable(self, analyzer):
        """REGRESSION: safe_zone must be JSON serializable (no numpy ints)."""
        import json
        
        rgba = np.zeros((100, 100, 4), dtype=np.uint8)
        rgba[:, :, 3] = 255
        rgba[10:90, 10:90, 3] = 0
        
        result = analyzer.analyze_full(rgba)
        
        # This will raise TypeError if numpy ints are present
        serialized = json.dumps(result)
        assert '"safe_zone"' in serialized
    def test_dual_metric_for_fragmented_void(self, analyzer):
        """
        Test that we return BOTH strict safe_zone (fragmented) AND
        loose layout_bounds (full container) for organic shapes.
        
        Simulates the "vine dripping into hole" scenario.
        """
        # 100x100 image, mostly transparent
        rgba = np.zeros((100, 100, 4), dtype=np.uint8)
        rgba[:, :, 3] = 0
        
        # Add frame (10px border)
        rgba[0:10, :, 3] = 255
        rgba[90:100, :, 3] = 255
        rgba[:, 0:10, 3] = 255
        rgba[:, 90:100, 3] = 255
        
        # Add a "vine" bisecting the center vertically (4px wide)
        mid = 50
        rgba[10:90, mid-2:mid+2, 3] = 255
        
        result = analyzer.analyze_full(rgba)
        
        # 1. Verify STRICT safe_zone (LIR)
        # Should be small (approx 38 width) because the vine splits it
        sz = result["safe_zone"]
        assert sz["width"] < 45  # Confirms it respects the vine obstacle
        
        # 2. Verify LOOSE layout_bounds (Content Rect)
        # Should be large (approx 80 width) because it ignores the vine
        lb = result["layout_bounds"]
        assert lb["width"] >= 70 # Confirms it bridges thegap

    def test_center_biased_lir(self, analyzer):
        """
        Test that LIR prefers central voids over larger peripheral voids.
        Simulates the "bottom shadow strip" problem.
        """
        # 100x100 image
        rgba = np.zeros((100, 100, 4), dtype=np.uint8)
        rgba[:, :, 3] = 0 # All transparent
        
        # Make everything opaque first
        rgba[:, :, 3] = 255
        
        # Create a LARGE void at the bottom (Shadow)
        # 100x20 strip at bottom
        rgba[80:100, :, 3] = 0
        bottom_area = 100 * 20 # 2000
        
        # Create a MEDIUM void in center (Content)
        # 40x40 box in center
        rgba[30:70, 30:70, 3] = 0
        center_area = 40 * 40 # 1600
        
        # With normal LIR, picking max area would choose Bottom (2000 > 1600).
        # With Center-Biased LIR, Center should win.
        # Bottom Weight: dist ~ 0.4 -> weight ~ 1.0 - (0.4*0.7) = 0.72?
        # Center Weight: 1.0
        # Wait, bottom dist is 0.4 (norm y). 0.4 * 0.7 = 0.28. 1 - 0.28 = 0.72.
        # 2000 * 0.72 = 1440.
        # 1600 * 1.0 = 1600.
        # Center (1600) > Bottom (1440). Center wins.
        
        result = analyzer.analyze_full(rgba)
        sz = result["safe_zone"]
        
        assert sz["width"] <= 45  # Should be approx 40, DEFINITELY not 100
        assert sz["y"] <= 40 # Should be near 30

    def test_asymmetrical_void_wins_if_dominant(self, analyzer):
        """
        Test that Center Bias doesn't break legitimate asymmetrical layouts (e.g. Sidebars).
        If the side void is significantly larger/only void, it must win.
        """
        # 100x100 Opaque
        rgba = np.zeros((100, 100, 4), dtype=np.uint8)
        rgba[:, :, 3] = 255
        
        # 1. Create Layout: Large Sidebar on Right
        # 40x80 strip on right side (Area 3200)
        # Center is at 50,50. Right strip center at 80, 50. DistX=30/50=0.6.
        # Weight ~ 1 - (0.6 * 0.7) = 0.58.
        # Score ~ 3200 * 0.58 = 1856.
        rgba[10:90, 60:100, 3] = 0
        
        # 2. Add "Noise" in Center
        # 10x10 hole in exact center (Area 100)
        # Weight 1.0. Score 100.
        rgba[45:55, 45:55, 3] = 0
        
        # 1856 >> 100. Right MUST win.
        
        result = analyzer.analyze_full(rgba)
        sz = result["safe_zone"]
        
        # Should overlap with the Right Strip
        # X should be >= 60. Width approx 40 (eroded -> 36).
        assert sz["x"] >= 55
        assert sz["width"] >= 30
        assert sz["height"] >= 70




