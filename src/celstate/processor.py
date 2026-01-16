from pathlib import Path
from typing import Dict, Any

import cv2
import numpy as np

from celstate.layout_analyzer import LayoutAnalyzer
from celstate.snippets import SnippetGenerator

# Manifest version for component output
MANIFEST_VERSION = "0.1"



class MediaProcessor:
    def __init__(self):
        self.analyzer = LayoutAnalyzer()
        self.snippet_generator = SnippetGenerator()

    def _crop_to_opaque_bounds(self, rgba: np.ndarray) -> np.ndarray:
        """
        Crops image to the bounding box of non-transparent pixels.
        
        Eliminates wasted canvas space where Gemini generates a shape
        (e.g., 3:1 pill) on a larger square canvas with empty transparent margins.
        
        Uses analyzer.calculate_visible_bbox with threshold=10 to filter noise.
        
        Args:
            rgba: RGBA image as numpy array (H, W, 4)
            
        Returns:
            Cropped RGBA image containing only the opaque content region
        """
        bbox = self.analyzer.calculate_visible_bbox(rgba, threshold=10)
        
        if bbox["width"] == 0 or bbox["height"] == 0:
            return rgba  # Return original if empty
            
        x, y, w, h = bbox["x"], bbox["y"], bbox["width"], bbox["height"]
        return rgba[y:y+h, x:x+w]

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

        # Adaptive Noise Gate: Eliminate background noise to enable cleaning cropping
        alpha = self._apply_adaptive_noise_gate(alpha)
        
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
                    "mask_asset": mask_filename,  # None if not organic
                     # Generative Code Snippets (Fat Response)
                    "snippets": self.snippet_generator.generate_all(
                         safe_zone=layout_metadata["safe_zone"],
                         layout_bounds=layout_metadata["layout_bounds"],
                         image_size=(width, height)
                    )
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
    def _apply_adaptive_noise_gate(self, alpha: np.ndarray) -> np.ndarray:
        """
        Dynamically filters background noise from the alpha channel.
        
        Solves the "Thumbnail Effect" where noisy background pixels (alpha ~5-15%)
        prevent the auto-cropper from finding the true content bounds.
        
        Algorithm:
        1. Calculate histogram of alpha channel.
        2. Identify the "Noise Mode" (dominant peak in low-alpha range).
        3. Define cutoff as Mean + 4*StdDev of the noise tail.
        4. Apply soft knee gating to preserve smooth transitions for real content.
        
        Args:
            alpha: Normalized alpha channel (0.0 - 1.0)
            
        Returns:
            Filtered alpha channel
        """
        # Work in 0-255 uint8 space for histogram analysis
        alpha_u8 = (alpha * 255).astype(np.uint8)
        
        # 1. Analyze "Low End" (Background Noise candidates)
        # We assume background is the dominant feature in the bottom 50% of intensity
        # If the image is 100% cloud, this might clip, but that's an edge case.
        # Focus on 0 < alpha < 128 (ignore perfect 0, as it's not noise)
        
        # Get pixels in the "potential noise" range
        # Note: We consider >0 to ignore already-clean pixels
        noise_candidates = alpha_u8[(alpha_u8 > 0) & (alpha_u8 < 128)]
        
        if noise_candidates.size < 100:
            # Image is already clean or fully opaque using >128
            return alpha
            
        # 2. Statistical profiling of the noise
        # We expect a Gaussian-ish distribution around the noise floor mean
        noise_mean = np.mean(noise_candidates)
        noise_std = np.std(noise_candidates)
        
        # 3. Calculate Cutoff Threshold
        # Aggressive 4-sigma coverage to kill the long tail of noise
        # Snap to 0 if it's super clean (mean < 2), otherwise calculated
        # Clamp to max 128 to prevent killing real semi-transparent content
        
        if noise_mean < 2:
             cutoff_u8 = 5 # Hard floor for near-perfect images
        else:
             cutoff_u8 = min(128, int(noise_mean + 4 * noise_std))
             
        cutoff = cutoff_u8 / 255.0
        
        # 4. Apply Transfer Function (Soft Knee)
        # alpha_out = (alpha_in - cutoff) / (1 - cutoff)  [normalized re-expansion]
        # This shifts the floor to 0 and scales the rest to fits
        
        # Create mask of usable pixels
        mask = alpha > cutoff
        
        # Initialize output
        filtered = np.zeros_like(alpha)
        
        # Apply re-normalization only to pixels above cutoff
        # (val - cutoff) / (1 - cutoff)
        denominator = 1.0 - cutoff
        if denominator > 0:
            filtered[mask] = (alpha[mask] - cutoff) / denominator
            
        return filtered




