"""
Layout Analyzer: Orchestrator for "Smart Asset" metadata extraction.

This module provides the high-level interface for analyzing asset layouts,
delegating low-level Computer Vision operations to image_analysis_core.
"""

from pathlib import Path
from typing import Dict, Any

import numpy as np

from src.engine.core.image_analysis_core import ImageAnalysisCore


class LayoutAnalyzer:
    """
    High-level orchestrator for extracting layout-ready metadata.
    
    This class combines raw CV data from ImageAnalysisCore with business logic
    to provide semantic metadata like "Safe Zones" and "Content Insets".
    """

    def __init__(self):
        self.core = ImageAnalysisCore()

    def analyze_transparency(self, img_rgba: np.ndarray) -> Dict[str, Any]:
        """
        Analyzes overall transparency distribution.
        """
        alpha = img_rgba[:, :, 3]
        total = alpha.size
        
        center_ratio = self.core.analyze_center_transparency_ratio(img_rgba)
        center_pct = (center_ratio * 100)
        
        return {
            "size": f"{img_rgba.shape[1]}x{img_rgba.shape[0]}",
            "transparent": f"{np.sum(alpha == 0) / total * 100:.1f}%",
            "semi_transparent": f"{np.sum((alpha > 0) & (alpha < 255)) / total * 100:.1f}%",
            "opaque": f"{np.sum(alpha == 255) / total * 100:.1f}%",
            "center_transparency": f"{center_pct:.1f}%"
        }

    def verify_container_hole(
        self, img_rgba: np.ndarray, min_transparent_ratio: float = 0.15
    ) -> Dict[str, Any]:
        """
        Verifies that a container asset has a usable transparent "hole".
        """
        ratio = self.core.analyze_center_transparency_ratio(img_rgba)
        
        if ratio >= min_transparent_ratio:
            return {
                "valid": True,
                "center_transparency": ratio,
                "message": "Content zone verified"
            }
        else:
            return {
                "valid": False,
                "center_transparency": ratio,
                "message": f"Insufficient center transparency ({ratio:.1%}). Container may obscure avatar."
            }

    # Proxy methods for convenience/compatibility if needed, 
    # but preferably we use analyze_full or call core directly if public.
    # For now, we expose the main capabilities needed by Processor.

    def calculate_visible_bbox(self, img_rgba: np.ndarray, threshold: int = 10) -> Dict[str, int]:
        """Proxy for core method."""
        return self.core.calculate_visible_bbox(img_rgba, threshold)

    def generate_mask(self, img_rgba: np.ndarray, output_path: Path) -> Path:
        """Proxy for core method."""
        return self.core.generate_mask(img_rgba, output_path)

    def generate_debug_overlay(
        self,
        img_rgba: np.ndarray,
        safe_zone: Dict[str, int],
        content_zones: Dict[str, int],
        output_path: Path
    ) -> Path:
        """Proxy for core method."""
        return self.core.generate_debug_overlay(img_rgba, safe_zone, content_zones, output_path)

    def analyze_full(self, img_rgba: np.ndarray) -> Dict[str, Any]:
        """
        Performs full layout analysis.
        
        Combines shape classification, content zone detection, and LIR
        to produce the final "Smart Asset" metadata.
        """
        # 1. Classify Shape
        shape_hint = self.core.classify_shape(img_rgba)
        shape_type = shape_hint.get("type", "geometric")
        
        # 2. Detect Content Zones (Insets)
        content_zones = self.core.detect_content_zones(img_rgba, shape_type)
        
        # 3. Calculate Layout Bounds (from Content Zones)
        h, w = img_rgba.shape[:2]
        layout_bounds = {
            "x": content_zones["inset_left"],
            "y": content_zones["inset_top"],
            "width": w - content_zones["inset_left"] - content_zones["inset_right"],
            "height": h - content_zones["inset_top"] - content_zones["inset_bottom"]
        }
        
        # 4. Calculate LIR (Strict Safe Zone)
        lir_margin = 0.0 if shape_type in ["rectangle", "rounded_rectangle", "circle", "geometric"] else 0.02
        
        lir_zone = self.core.find_largest_inscribed_rectangle(
            img_rgba, 
            safety_margin_ratio=lir_margin,
            shape_type=shape_type,
            bounds=layout_bounds
        )
        
        # 5. Validate LIR result (Fallback Logic)
        # If LIR is pushed to the periphery by artifacts, fallback to layout_bounds
        lir_center_y = lir_zone["y"] + lir_zone["height"] / 2
        lir_center_x = lir_zone["x"] + lir_zone["width"] / 2
        
        is_peripheral = (
            lir_center_y < h * 0.25 or lir_center_y > h * 0.75 or
            lir_center_x < w * 0.25 or lir_center_x > w * 0.75
        )
        
        if is_peripheral and lir_zone["width"] > 0 and lir_zone["height"] > 0:
            safe_zone = layout_bounds.copy()
            safe_zone["_fallback"] = "layout_bounds"
        else:
            safe_zone = lir_zone
            
        return {
            "content_zones": content_zones,
            "slice_insets": self.core.detect_9slice_insets(img_rgba),
            "shape_hint": shape_hint,
            "transparency": self.analyze_transparency(img_rgba),
            "safe_zone": safe_zone,
            "layout_bounds": layout_bounds
        }
