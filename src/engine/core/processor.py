import os
import subprocess
from pathlib import Path
from typing import Dict, List, Any, Optional

import cv2
import numpy as np

from src.engine.core.analyzer import LayoutAnalyzer

# Manifest version for component output
MANIFEST_VERSION = "0.1"



class MediaProcessor:
    def __init__(self):
        self.analyzer = LayoutAnalyzer()

    def _crop_to_opaque_bounds(self, rgba: np.ndarray) -> np.ndarray:
        """
        Crops image to the bounding box of non-transparent pixels.
        
        Eliminates wasted canvas space where Gemini generates a shape
        (e.g., 3:1 pill) on a larger square canvas with empty transparent margins.
        
        Args:
            rgba: RGBA image as numpy array (H, W, 4)
            
        Returns:
            Cropped RGBA image containing only the opaque content region
        """
        alpha = rgba[:, :, 3]
        
        # Find rows and columns containing any non-transparent pixels
        rows = np.any(alpha > 0, axis=1)
        cols = np.any(alpha > 0, axis=0)
        
        if not np.any(rows) or not np.any(cols):
            return rgba  # All transparent, return as-is
        
        # Get bounding box indices
        y_min, y_max = np.where(rows)[0][[0, -1]]
        x_min, x_max = np.where(cols)[0][[0, -1]]
        
        return rgba[y_min:y_max+1, x_min:x_max+1]

    def process_image(self, white_path: Path, black_path: Path, name: str, output_dir: Path) -> Dict[str, Any]:
        """Difference Matting -> single high-fidelity PNG output."""
        output_dir.mkdir(parents=True, exist_ok=True)
        
        img_w = cv2.imread(str(white_path))
        img_b = cv2.imread(str(black_path))
        
        if img_w is None or img_b is None:
            raise ValueError(f"Could not read input images: {white_path}, {black_path}")
            
        img_w = img_w.astype(float)
        img_b = img_b.astype(float)
        
        # Alpha recovery: Alpha = 1 - (pixel_distance / 255)
        diff = np.abs(img_w - img_b)
        alpha = 1.0 - (np.mean(diff, axis=2) / 255.0)
        alpha = np.clip(alpha, 0, 1)
        
        # Color recovery (un-premultiply from black)
        with np.errstate(divide='ignore', invalid='ignore'):
            color = img_b / alpha[:, :, np.newaxis]
        color = np.nan_to_num(color, nan=0.0)
        
        # Construct RGBA
        final_alpha = (alpha * 255).astype(np.uint8)
        final_bgr = np.clip(color, 0, 255).astype(np.uint8)
        rgba = cv2.merge([final_bgr[:,:,0], final_bgr[:,:,1], final_bgr[:,:,2], final_alpha])
        
        # Auto-crop to opaque bounding box (eliminates wasted canvas space)
        rgba = self._crop_to_opaque_bounds(rgba)
        
        # Write single high-fidelity PNG (lossless for CV analysis)
        h, w = rgba.shape[:2]
        filename = f"{name}.png"
        filepath = output_dir / filename
        cv2.imwrite(str(filepath), rgba)
        
        # Build manifest-compliant component structure
        width, height = w, h
        
        # Perform full layout analysis for "Smart Asset" metadata (per VISION.md)
        layout_metadata = self.analyzer.analyze_full(rgba)
        
        # Generate mask for organic shapes (per VISION.md)
        mask_filename = None
        if layout_metadata["shape_hint"].get("type") == "organic":
            mask_path = output_dir / f"{name}_mask.png"
            self.analyzer.generate_mask(rgba, mask_path)
            mask_filename = f"{name}_mask.png"
        
        # Generate debug overlay for visual verification (user feedback: "Ghost Overlay")
        debug_path = output_dir / f"{name}_debug.png"
        self.analyzer.generate_debug_overlay(
            rgba,
            layout_metadata["safe_zone"],
            layout_metadata["content_zones"],
            debug_path
        )
        
        # Build assets dict - include mask and debug overlay for URL resolution
        assets = {f"{name}.png": None}
        if mask_filename:
            assets[mask_filename] = None  # URL populated by API layer
        # Debug overlay shows safe_zone (green) and layout_bounds (red) for visual verification
        assets[f"{name}_debug.png"] = None
        
        component = {
            "manifest": {
                "version": MANIFEST_VERSION,
                "id": name,
                "type": "static",  # Single-state for now, "interactive" when multi-state
                "intrinsics": {
                    "size": {"width": width, "height": height},
                    "anchor": {"x": 0.5, "y": 0.5},
                    # Smart Asset CV metadata (from analyzer)
                    "content_zones": layout_metadata["content_zones"],
                    "slice_insets": layout_metadata["slice_insets"],
                    "shape_hint": layout_metadata["shape_hint"],
                    "safe_zone": layout_metadata["safe_zone"],
                    "layout_bounds": layout_metadata["layout_bounds"],
                    "mask_asset": mask_filename  # None if not organic
                },
                "states": {
                    "idle": {
                        "clip": f"{name}.png",
                        "loop": False
                    }
                },
                "transitions": [],
                "accessibility": {
                    "role": "image",
                    "label": name.replace("_", " ").title()
                }
            },
            "assets": assets,  # Now includes mask if present
            "telemetry": layout_metadata["transparency"]
            # NOTE: No "snippets" field. Per VISION.md Section 4A: "Measurements, not Code"
        }

        
        return {
            "name": name,
            "component": component,
            "telemetry": layout_metadata["transparency"]
        }


