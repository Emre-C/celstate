"""
Image Analysis Core: Low-level Computer Vision operations for asset analysis.

This module contains the raw CV algorithms for:
- Shape classification
- Content zone detection (insets)
- Safe zone calculation (LIR)
- 9-slice scaling detection
- Morphological masking
- Debug visualization

It is designed to be used by the higher-level LayoutAnalyzer.
"""

from pathlib import Path
from typing import Dict, Any, Tuple, Optional

import cv2
import numpy as np


class ImageAnalysisCore:
    """
    Core Computer Vision toolkit for analyzing asset images.
    Provides stateless image processing methods.
    """

    def analyze_center_transparency_ratio(self, img_rgba: np.ndarray) -> float:
        """
        Calculates the transparency ratio (0.0 - 1.0) of the center 50% of the image.
        
        Useful for detecting if an asset has a "transparent hole" in the middle.
        
        Args:
            img_rgba: RGBA image as numpy array (H, W, 4)
            
        Returns:
            Float 0.0 (fully opaque) to 1.0 (fully transparent)
        """
        h, w = img_rgba.shape[:2]
        # Crop center 50%
        y1, y2 = int(h * 0.25), int(h * 0.75)
        x1, x2 = int(w * 0.25), int(w * 0.75)
        
        center_crop = img_rgba[y1:y2, x1:x2]
        if center_crop.size == 0:
            return 0.0
            
        alpha = center_crop[:, :, 3]
        mean_alpha = np.mean(alpha)
        
        # 0 = fully transparent, 255 = fully opaque
        # Ratio: 1.0 = fully transparent, 0.0 = fully opaque
        return 1.0 - (mean_alpha / 255.0)

    def detect_content_zones(
        self, img_rgba: np.ndarray, shape_type: str = "geometric"
    ) -> Dict[str, Any]:
        """
        Scans alpha channel to find insets where content can be placed.
        
        Scans from each edge inward until hitting non-transparent pixels.
        For organic shapes, adds aesthetic padding.
        
        Args:
            img_rgba: RGBA image
            shape_type: "organic" adds padding, others (geometric) do not.
            
        Returns:
            Dict with insets and layout hints.
        """
        alpha = img_rgba[:, :, 3]
        h, w = alpha.shape
        
        # Threshold: consider pixels with alpha > 10 as "content"
        content_mask = alpha > 10
        
        # Find inset from each edge by scanning until we hit content
        inset_top = self._scan_edge_inward(content_mask, "top")
        inset_bottom = self._scan_edge_inward(content_mask, "bottom")
        inset_left = self._scan_edge_inward(content_mask, "left")
        inset_right = self._scan_edge_inward(content_mask, "right")
        
        # Add aesthetic padding for organic shapes (soft/fuzzy edges need breathing room)
        if shape_type == "organic":
            # 2% aesthetic buffer for organic shapes only
            aesthetic_buffer_ratio = 0.02
            inset_top += int(h * aesthetic_buffer_ratio)
            inset_bottom += int(h * aesthetic_buffer_ratio)
            inset_left += int(w * aesthetic_buffer_ratio)
            inset_right += int(w * aesthetic_buffer_ratio)
        
        # Calculate layout strategy based on the available content zone aspect ratio
        content_width = w - (inset_left + inset_right)
        content_height = h - (inset_top + inset_bottom)
        layout_hint = self.get_layout_strategy(content_width, content_height)

        return {
            "inset_top": inset_top,
            "inset_right": inset_right,
            "inset_bottom": inset_bottom,
            "inset_left": inset_left,
            "layout_hint": layout_hint,
            # Percentage-based intrinsics for responsive scaling
            "inset_top_pct": round(inset_top / h * 100, 1) if h > 0 else 0,
            "inset_right_pct": round(inset_right / w * 100, 1) if w > 0 else 0,
            "inset_bottom_pct": round(inset_bottom / h * 100, 1) if h > 0 else 0,
            "inset_left_pct": round(inset_left / w * 100, 1) if w > 0 else 0,
            "usable_width_pct": round(content_width / w * 100, 1) if w > 0 else 0,
            "usable_height_pct": round(content_height / h * 100, 1) if h > 0 else 0,
            "coordinate_system": {
                "origin": "top-left",
                "inset_top_pct_of": "image_height",
                "inset_bottom_pct_of": "image_height",
                "inset_left_pct_of": "image_width",
                "inset_right_pct_of": "image_width"
            }
        }

    def _scan_edge_inward(self, content_mask: np.ndarray, edge: str) -> int:
        """
        Scans from an edge inward until hitting content pixels.
        Returns number of pixels from edge to first content.
        """
        h, w = content_mask.shape
        
        if edge == "top":
            for row in range(h):
                if np.any(content_mask[row, :]):
                    return row
            return h
        elif edge == "bottom":
            for row in range(h - 1, -1, -1):
                if np.any(content_mask[row, :]):
                    return h - 1 - row
            return h
        elif edge == "left":
            for col in range(w):
                if np.any(content_mask[:, col]):
                    return col
            return w
        elif edge == "right":
            for col in range(w - 1, -1, -1):
                if np.any(content_mask[:, col]):
                    return w - 1 - col
            return w
        return 0

    def get_layout_strategy(self, width: int, height: int) -> Dict[str, str]:
        """
        Suggests a layout strategy for coding agents based on aspect ratio.
        """
        if width == 0 or height == 0:
            return {
                "suggested": "centered",
                "avatar_alignment": "center",
                "text_alignment": "center"
            }
            
        aspect_ratio = width / height
        
        if aspect_ratio >= 1.5:
            # Wide container -> Horizontal Layout (Avatar Left, Text Right)
            return {
                "suggested": "horizontal_row",
                "avatar_alignment": "left",
                "text_alignment": "center-left"
            }
        elif aspect_ratio <= 0.8:
            # Tall container -> Vertical Layout (Avatar Top, Text Bottom)
            return {
                "suggested": "vertical_column",
                "avatar_alignment": "top",
                "text_alignment": "center-bottom"
            }
        else:
            # Square-ish -> Centered Cluster
            return {
                "suggested": "centered",
                "avatar_alignment": "center",
                "text_alignment": "center"
            }

    def detect_9slice_insets(self, img_rgba: np.ndarray) -> Dict[str, int]:
        """
        Detects stretchable center region vs fixed corners for 9-slice scaling.
        We look for rows/columns with consistent alpha patterns.
        """
        alpha = img_rgba[:, :, 3]
        
        # Find slice boundaries where pattern becomes uniform
        top_slice = self._find_slice_boundary(alpha, "horizontal", from_start=True)
        bottom_slice = self._find_slice_boundary(alpha, "horizontal", from_start=False)
        left_slice = self._find_slice_boundary(alpha, "vertical", from_start=True)
        right_slice = self._find_slice_boundary(alpha, "vertical", from_start=False)
        
        return {
            "top": top_slice,
            "right": right_slice,
            "bottom": bottom_slice,
            "left": left_slice
        }

    def _find_slice_boundary(
        self, 
        alpha: np.ndarray, 
        direction: str, 
        from_start: bool
    ) -> int:
        """
        Finds the boundary where the alpha pattern becomes uniform (stretchable).
        """
        h, w = alpha.shape
        min_slice = 8
        max_slice_ratio = 0.4
        
        if direction == "horizontal":
            max_slice = min(int(h * max_slice_ratio), h // 2)
            indices = range(min_slice, max_slice) if from_start else range(h - min_slice, h - max_slice, -1)
            
            for i in indices:
                if from_start:
                    if i + 1 < h and self._rows_similar(alpha[i, :], alpha[i + 1, :]):
                        return i
                else:
                    if i - 1 >= 0 and self._rows_similar(alpha[i, :], alpha[i - 1, :]):
                        return h - i
            return min_slice
        else:  # vertical
            max_slice = min(int(w * max_slice_ratio), w // 2)
            indices = range(min_slice, max_slice) if from_start else range(w - min_slice, w - max_slice, -1)
            
            for i in indices:
                if from_start:
                    if i + 1 < w and self._rows_similar(alpha[:, i], alpha[:, i + 1]):
                        return i
                else:
                    if i - 1 >= 0 and self._rows_similar(alpha[:, i], alpha[:, i - 1]):
                        return w - i
            return min_slice

    def _rows_similar(self, row1: np.ndarray, row2: np.ndarray, threshold: float = 0.95) -> bool:
        """Checks if two rows/columns have similar alpha patterns."""
        if len(row1) != len(row2):
            return False
        # Count matching pixels (difference < 10)
        matching = np.sum(np.abs(row1.astype(float) - row2.astype(float)) < 10)
        return (matching / len(row1)) >= threshold

    def classify_shape(self, img_rgba: np.ndarray) -> Dict[str, Any]:
        """
        Classifies the shape of the opaque content (circle, rectangle, organic).
        """
        alpha = img_rgba[:, :, 3]
        
        # Create binary mask
        _, binary = cv2.threshold(alpha, 127, 255, cv2.THRESH_BINARY)
        
        # Find contours
        contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        
        if not contours:
            return {"type": "empty"}
        
        # Main shape is the largest contour
        main_contour = max(contours, key=cv2.contourArea)
        area = cv2.contourArea(main_contour)
        perimeter = cv2.arcLength(main_contour, True)
        
        if perimeter == 0:
            return {"type": "organic"}
        
        # Circularity: 1.0 = perfect circle
        circularity = (4 * np.pi * area) / (perimeter ** 2)
        
        # Bounding rect stats
        x, y, w, h = cv2.boundingRect(main_contour)
        aspect_ratio = min(w, h) / max(w, h) if max(w, h) > 0 else 0
        rect_area = w * h
        rectangularity = area / rect_area if rect_area > 0 else 0
        
        if circularity > 0.85 and aspect_ratio > 0.9:
            # Likely a circle
            radius = max(w, h) / 2
            return {
                "type": "circle",
                "radius": "50%",
                "diameter_px": int(radius * 2)
            }
        elif rectangularity > 0.9:
            # Likely a rectangle
            corner_radius = self._estimate_corner_radius(main_contour, w, h)
            if corner_radius > 2:
                return {
                    "type": "rounded_rectangle",
                    "corner_radius": corner_radius
                }
            else:
                return {
                    "type": "rectangle",
                    "corner_radius": 0
                }
        elif rectangularity > 0.7:
            # Rounded rectangle with significant corners
            corner_radius = self._estimate_corner_radius(main_contour, w, h)
            return {
                "type": "rounded_rectangle",
                "corner_radius": corner_radius
            }
        else:
            return {"type": "organic"}

    def _estimate_corner_radius(self, contour: np.ndarray, width: int, height: int) -> int:
        """Estimates corner radius based on area difference from bounding box."""
        area = cv2.contourArea(contour)
        rect_area = width * height
        
        if rect_area == 0:
            return 0
        
        area_diff = rect_area - area
        # For rounded rect, area removed ≈ (4 - π) * r²
        corner_factor = 4 - np.pi
        
        if area_diff > 0:
            estimated_r = np.sqrt(area_diff / corner_factor)
            max_radius = min(width, height) / 2
            return int(min(estimated_r, max_radius))
        
        return 0

    def calculate_visible_bbox(self, img_rgba: np.ndarray, threshold: int = 10) -> Dict[str, int]:
        """Calculates strict bounding box of visible content."""
        alpha = img_rgba[:, :, 3]
        rows = np.any(alpha > threshold, axis=1)
        cols = np.any(alpha > threshold, axis=0)
        
        if not np.any(rows) or not np.any(cols):
            return {"x": 0, "y": 0, "width": 0, "height": 0}
        
        y_min, y_max = np.where(rows)[0][[0, -1]]
        x_min, x_max = np.where(cols)[0][[0, -1]]
        
        return {
            "x": int(x_min),
            "y": int(y_min),
            "width": int(x_max - x_min + 1),
            "height": int(y_max - y_min + 1)
        }

    def _create_morphological_mask(self, alpha: np.ndarray) -> np.ndarray:
        """
        Creates a 'squinted' void mask that ignores small artistic elements.
        Used for organic Safe Zone calculation.
        """
        h, w = alpha.shape
        
        # Obstacle Mask: White = Obstacle (alpha > 100)
        # Higher threshold ignores semi-transparent washout
        obstacle_mask = (alpha > 100).astype(np.uint8) * 255
        
        # Kernel: ~5% of image size (adaptive)
        k_size = int(min(h, w) * 0.05)
        k_size = max(3, k_size)
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k_size, k_size))
        
        # Morphological OPEN: Removes small obstacles
        cleaned_obstacles = cv2.morphologyEx(obstacle_mask, cv2.MORPH_OPEN, kernel)
        
        # Return Void Mask (White = Void/Safe)
        return cv2.bitwise_not(cleaned_obstacles)

    def find_largest_inscribed_rectangle(
        self, 
        img_rgba: np.ndarray,
        safety_margin_ratio: float = 0.02,
        shape_type: str = "geometric",
        bounds: Optional[Dict[str, int]] = None
    ) -> Dict[str, int]:
        """
        Finds Largest Inscribed Rectangle (LIR) within the transparent void.
        Supports organic 'squinting' and layout bound constraints.
        """
        alpha = img_rgba[:, :, 3]
        h, w = alpha.shape
        
        if shape_type == "organic":
            # Squinting for organic shapes
            void_mask = self._create_morphological_mask(alpha)
        else:
            # Strict threshold for geometric
            void_threshold = 13
            void_mask = (alpha < void_threshold).astype(np.uint8) * 255
        
        # Constrain search to Layout Bounds
        if bounds:
            bounds_mask = np.zeros((h, w), dtype=np.uint8)
            bx, by = bounds["x"], bounds["y"]
            bw, bh = bounds["width"], bounds["height"]
            cv2.rectangle(bounds_mask, (bx, by), (bx + bw, by + bh), 255, -1)
            void_mask = cv2.bitwise_and(void_mask, bounds_mask)
        
        # Apply safety margin erosion
        safety_margin = int(min(h, w) * safety_margin_ratio)
        if safety_margin > 0:
            kernel = cv2.getStructuringElement(
                cv2.MORPH_ELLIPSE, 
                (safety_margin * 2 + 1, safety_margin * 2 + 1)
            )
            safe_region = cv2.erode(void_mask, kernel)
        else:
            safe_region = void_mask
            
        # Largest Rectangle Algorithm (Center-Biased)
        center_y, center_x = h / 2.0, w / 2.0
        max_score = 0.0
        best_rect = {"x": 0, "y": 0, "width": 0, "height": 0}
        
        heights = np.zeros(w, dtype=np.int32)
        
        for row in range(h):
            row_pixels = (safe_region[row, :] > 127).astype(int)
            heights = (heights + row_pixels) * row_pixels
            
            stack = []
            
            def process_rect(idx, h_v, current_idx):
                nonlocal max_score, best_rect
                width_v = current_idx - idx
                area = width_v * h_v
                
                # Center Bias
                rect_cx = idx + width_v / 2.0
                rect_cy = (row - h_v + 1) + h_v / 2.0
                norm_dx = (rect_cx - center_x) / (w / 2.0)
                norm_dy = (rect_cy - center_y) / (h / 2.0)
                dist_norm = (norm_dx**2 + norm_dy**2) ** 0.5
                
                weight = max(0.2, 1.0 - (dist_norm * 0.7))
                score = area * weight
                
                if score > max_score:
                    max_score = score
                    best_rect = {
                        "x": int(idx),
                        "y": int(row - h_v + 1),
                        "width": int(width_v),
                        "height": int(h_v)
                    }

            for i, current_h in enumerate(heights):
                start_index = i
                while stack and stack[-1][1] > current_h:
                    index, h_val = stack.pop()
                    process_rect(index, h_val, i)
                    start_index = index
                stack.append((start_index, current_h))
            
            for index, h_val in stack:
                process_rect(index, h_val, w)
                
        return best_rect

    def generate_mask(
        self, 
        img_rgba: np.ndarray, 
        output_path: Path,
        safety_margin_ratio: float = 0.02
    ) -> Path:
        """
        Creates a content-safe clipping mask (White=Safe).
        """
        alpha = img_rgba[:, :, 3]
        h, w = alpha.shape
        
        # INVERT: Void -> White, Frame -> Black
        void_mask = (alpha < 13).astype(np.uint8) * 255
        
        safety_margin = int(min(h, w) * safety_margin_ratio)
        if safety_margin > 0:
            kernel = cv2.getStructuringElement(
                cv2.MORPH_ELLIPSE, 
                (safety_margin * 2 + 1, safety_margin * 2 + 1)
            )
            eroded_mask = cv2.erode(void_mask, kernel)
        else:
            eroded_mask = void_mask
            
        output_path.parent.mkdir(parents=True, exist_ok=True)
        cv2.imwrite(str(output_path), eroded_mask)
        return output_path

    def generate_debug_overlay(
        self,
        img_rgba: np.ndarray,
        safe_zone: Dict[str, int],
        content_zones: Dict[str, int],
        output_path: Path
    ) -> Path:
        """
        Generates debug image with safe_zone (green) and content_zones (red) overlays.
        """
        debug = img_rgba.copy()
        h, w = debug.shape[:2]
        
        # Content Zone Bounds (Red)
        top = content_zones.get("inset_top", 0)
        right = content_zones.get("inset_right", 0)
        bottom = content_zones.get("inset_bottom", 0)
        left = content_zones.get("inset_left", 0)
        
        cv2.rectangle(
            debug,
            (left, top),
            (w - right, h - bottom),
            (0, 0, 255, 255),
            3
        )
        
        # Safe Zone (Green)
        sz_x = safe_zone.get("x", 0)
        sz_y = safe_zone.get("y", 0)
        sz_w = safe_zone.get("width", 0)
        sz_h = safe_zone.get("height", 0)
        
        if sz_w > 0 and sz_h > 0:
            overlay = debug.copy()
            cv2.rectangle(
                overlay,
                (sz_x, sz_y),
                (sz_x + sz_w, sz_y + sz_h),
                (0, 255, 0, 200),
                -1
            )
            cv2.addWeighted(overlay, 0.3, debug, 0.7, 0, debug)
            cv2.rectangle(
                debug,
                (sz_x, sz_y),
                (sz_x + sz_w, sz_y + sz_h),
                (0, 255, 0, 255),
                2
            )
            
        output_path.parent.mkdir(parents=True, exist_ok=True)
        cv2.imwrite(str(output_path), debug)
        return output_path
