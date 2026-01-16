"""
Layout Analyzer: Orchestrator for "Smart Asset" metadata extraction.

This module provides the high-level interface for analyzing asset layouts,
delegating low-level Computer Vision operations to image_analysis_core.
"""

from pathlib import Path
from typing import Dict, Any

import numpy as np

from celstate.image_analysis_core import ImageAnalysisCore


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
        
        # Adaptive Fallback Logic ("Liberal Fallback")
        # 1. Calculate Coverage stats
        lir_area = lir_zone["width"] * lir_zone["height"]
        bounds_area = layout_bounds["width"] * layout_bounds["height"]
        lir_coverage = lir_area / bounds_area if bounds_area > 0 else 0
        
        # 2. Check if the container is mostly empty (Void Density)
        void_density = self.core.calculate_void_density(img_rgba, layout_bounds)
        
        # 3. Decision Tree
        # Case A: Peripheral LIR (Edge artifact) -> Fallback
        if is_peripheral and lir_zone["width"] > 0 and lir_zone["height"] > 0:
            safe_zone = layout_bounds.copy()
            safe_zone["_strategy"] = "fallback_peripheral"
            
        # Case B: Tiny LIR in a mostly empty box (Pill/Circle scenario) -> Upgrade
        # If LIR covers < 45% of box (tightened from 65%), and box is > 55% empty,
        # we assume it's a geometric constraint (ears/corners) and upgrade.
        elif lir_coverage < 0.45 and void_density > 0.55:
            safe_zone = layout_bounds.copy()
            safe_zone["_strategy"] = "adaptive_pill_upgrade"
            
        # Case C: Standard LIR is good enough
        else:
            safe_zone = lir_zone
            safe_zone["_strategy"] = "lir_robust"
            
        # Smart Slice Scaling Logic
        slice_insets = self.core.detect_9slice_insets(img_rgba)
        symmetry = self.core.check_symmetry(img_rgba)
        
        # Check for Doubly Symmetric Geometric Shapes (Pills, Circles, Squircles)
        # We require HIGH symmetry (> 0.9) on BOTH axes to apply this destructive override.
        is_doubly_symmetric = symmetry["vertical"] > 0.9 and symmetry["horizontal"] > 0.9
        
        if is_doubly_symmetric and shape_type in ["rounded_rectangle", "circle"]:
            corner_radius = shape_hint.get("corner_radius", 0)
            if shape_type == "circle":
                 # Circles are effectively pills with radius = width/2
                 corner_radius = shape_hint.get("diameter_px", 0) // 2
            
            if corner_radius > 0:
                aspect_ratio = w / h if h > 0 else 0
                
                # Horizontal Pill (or wide squircle) -> Protect Left/Right caps
                if aspect_ratio >= 1.2:
                    slice_insets["left"] = max(slice_insets["left"], corner_radius)
                    slice_insets["right"] = max(slice_insets["right"], corner_radius)
                    
                # Vertical Pill -> Protect Top/Bottom caps
                elif aspect_ratio <= 0.8:
                    slice_insets["top"] = max(slice_insets["top"], corner_radius)
                    slice_insets["bottom"] = max(slice_insets["bottom"], corner_radius)
                    
                # Square/Squircle (near 1.0) -> Protect All corners
                else: 
                    slice_insets["top"] = max(slice_insets["top"], corner_radius)
                    slice_insets["bottom"] = max(slice_insets["bottom"], corner_radius)
                    slice_insets["left"] = max(slice_insets["left"], corner_radius)
                    slice_insets["right"] = max(slice_insets["right"], corner_radius)

        # 6. Advanced Metadata: Visual Edge & Anchors (Robust for Organic)
        visual_edge_bounds = self.core.calculate_visual_edge_bounds(img_rgba)
        anchor_points = self.core.calculate_anchor_points(img_rgba, layout_bounds)
        
        # 7. Advanced Metadata: Inner Radii & Arc Centers (Strictly Geometric)
        inner_radius = self.core.calculate_inner_radii(img_rgba, layout_bounds, shape_type)
        arc_centers = self.core.calculate_arc_centers(img_rgba, layout_bounds, inner_radius, shape_type)
        
        # 8. Schema Update: Rename corner_radius to outer_corner_radius
        if "corner_radius" in shape_hint:
            shape_hint["outer_corner_radius"] = shape_hint.pop("corner_radius")
            
        # Add inner_corner_radius to shape_hint for completeness
        if inner_radius:
            shape_hint["inner_corner_radius"] = inner_radius

        return {
            "content_zones": content_zones,
            "slice_insets": slice_insets,
            "shape_hint": shape_hint,
            "transparency": self.analyze_transparency(img_rgba),
            "safe_zone": safe_zone,
            "visual_edge_bounds": visual_edge_bounds,
            "anchor_points": anchor_points,
            "arc_centers": arc_centers,
            "layout_bounds": layout_bounds
        }
