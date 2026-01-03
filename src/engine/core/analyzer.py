"""
Layout Analyzer: Computer Vision module for "Smart Asset" metadata extraction.

Per VISION.md, this module enables AI agents to understand WHERE transparent regions,
content zones, and stretchable areas are located — returning `pixels + logic`.
"""

from pathlib import Path
from typing import Dict, Any, Tuple

import cv2
import numpy as np


class LayoutAnalyzer:
    """
    Computer Vision module for extracting layout-ready metadata from RGBA images.
    
    This class provides the "Alpha Scanning" capabilities described in VISION.md,
    enabling AI coding agents to place content precisely without guessing coordinates.
    """

    def analyze_transparency(self, img_rgba: np.ndarray) -> Dict[str, Any]:
        """
        Analyzes overall transparency distribution of an RGBA image.
        
        Migrated from MediaProcessor._analyze_transparency for centralization.
        
        Args:
            img_rgba: RGBA image as numpy array (H, W, 4)
            
        Returns:
            Dictionary with transparency percentages:
            {
                "size": "512x512",
                "transparent": "25.0%",
                "semi_transparent": "10.0%",
                "opaque": "65.0%",
                "center_transparency": "30.0%"
            }
        """
        alpha = img_rgba[:, :, 3]
        total = alpha.size
        return {
            "size": f"{img_rgba.shape[1]}x{img_rgba.shape[0]}",
            "transparent": f"{np.sum(alpha == 0) / total * 100:.1f}%",
            "semi_transparent": f"{np.sum((alpha > 0) & (alpha < 255)) / total * 100:.1f}%",
            "opaque": f"{np.sum(alpha == 255) / total * 100:.1f}%",
            "center_transparency": self.analyze_center_transparency(img_rgba)
        }

    def analyze_center_transparency(self, img_rgba: np.ndarray) -> str:
        """
        Calculates transparency of the center 50% of the image.
        
        Migrated from MediaProcessor._analyze_center_transparency.
        Useful for detecting if an asset has a "transparent hole" in the middle
        (e.g., decorative frames for avatars).
        
        Args:
            img_rgba: RGBA image as numpy array (H, W, 4)
            
        Returns:
            Percentage string like "75.0%" (higher = more transparent center)
        """
        h, w = img_rgba.shape[:2]
        # Crop center 50%
        y1, y2 = int(h * 0.25), int(h * 0.75)
        x1, x2 = int(w * 0.25), int(w * 0.75)
        
        center_crop = img_rgba[y1:y2, x1:x2]
        if center_crop.size == 0:
            return "unknown"
            
        alpha = center_crop[:, :, 3]
        mean_alpha = np.mean(alpha)
        
        # 0 = fully transparent, 255 = fully opaque
        percentage = (1.0 - (mean_alpha / 255.0)) * 100
        return f"{percentage:.1f}%"

    def verify_container_hole(
        self, img_rgba: np.ndarray, min_transparent_ratio: float = 0.15
    ) -> Dict[str, Any]:
        """
        Verifies that a container asset has a usable transparent "hole" for content.
        
        Per VISION.md, the "Cloud Pill" paradigm requires a guaranteed transparent center
        for placing user avatars or text. This method validates that requirement.
        
        Args:
            img_rgba: RGBA image as numpy array (H, W, 4)
            min_transparent_ratio: Minimum ratio of center transparency required (0.15 = 15%)
            
        Returns:
            Dictionary with validation result:
            {
                "valid": True/False,
                "center_transparency": float (0.0-1.0),
                "message": "Content zone verified" or error message
            }
        """
        center_trans = self.analyze_center_transparency(img_rgba)
        ratio = float(center_trans.rstrip('%')) / 100.0
        
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

    def detect_content_zones(
        self, img_rgba: np.ndarray, shape_type: str = "geometric"
    ) -> Dict[str, int]:
        """
        Scans alpha channel to find insets where content can be placed.
        
        This is the core "Alpha Scanning" capability from VISION.md.
        Scans from each edge inward until hitting non-transparent pixels.
        
        For organic shapes (watercolor, hand-drawn styles), adds aesthetic padding
        to account for soft/fuzzy edges that need visual breathing room.
        
        Args:
            img_rgba: RGBA image as numpy array (H, W, 4)
            shape_type: Shape classification ("organic", "circle", "rectangle", etc.)
            
        Returns:
            Dictionary with pixel insets from each edge:
            {"inset_top": 12, "inset_right": 8, "inset_bottom": 12, "inset_left": 8}
            
        Example:
            A decorative frame with 20px borders would return:
            {"inset_top": 20, "inset_right": 20, "inset_bottom": 20, "inset_left": 20}
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
            # 20% aesthetic buffer split between both edges (10% per side)
            aesthetic_buffer_ratio = 0.10
            inset_top += int(h * aesthetic_buffer_ratio)
            inset_bottom += int(h * aesthetic_buffer_ratio)
            inset_left += int(w * aesthetic_buffer_ratio)
            inset_right += int(w * aesthetic_buffer_ratio)
        
        # Calculate layout strategy based on the available content zone aspect ratio
        content_width = w - (inset_left + inset_right)
        content_height = h - (inset_top + inset_bottom)
        layout_hint = self._analyze_layout_strategy(content_width, content_height)

        return {
            "inset_top": inset_top,
            "inset_right": inset_right,
            "inset_bottom": inset_bottom,
            "inset_left": inset_left,
            "layout_hint": layout_hint,
            # Percentage-based intrinsics for responsive scaling (per user feedback)
            "inset_top_pct": round(inset_top / h * 100, 1),
            "inset_right_pct": round(inset_right / w * 100, 1),
            "inset_bottom_pct": round(inset_bottom / h * 100, 1),
            "inset_left_pct": round(inset_left / w * 100, 1),
            "usable_width_pct": round(content_width / w * 100, 1),
            "usable_height_pct": round(content_height / h * 100, 1),
            # Semantic metadata: clarify coordinate system to prevent CSS box model confusion
            # (CSS padding-% is width-relative; our insets are dimension-specific)
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
        
        Args:
            content_mask: Boolean mask where True = content pixel
            edge: One of "top", "bottom", "left", "right"
            
        Returns:
            Number of pixels from edge to first content
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
        else:
            return 0

    def detect_9slice_insets(self, img_rgba: np.ndarray) -> Dict[str, int]:
        """
        Detects stretchable center region vs fixed corners for 9-slice scaling.
        
        The 9-slice technique allows a small image to scale to any size by
        keeping corners fixed and stretching the center. This method finds
        the optimal slice points by analyzing alpha channel patterns.
        
        Args:
            img_rgba: RGBA image as numpy array (H, W, 4)
            
        Returns:
            Dictionary with slice insets from each edge:
            {"top": 12, "right": 12, "bottom": 12, "left": 12}
        """
        alpha = img_rgba[:, :, 3]
        h, w = alpha.shape
        
        # For 9-slice, we want to find the region where the pattern is uniform
        # (stretchable). We look for rows/columns with consistent alpha patterns.
        
        # Find top slice: last row before pattern becomes uniform
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
        
        Args:
            alpha: Alpha channel as numpy array
            direction: "horizontal" (scan rows) or "vertical" (scan columns)
            from_start: True to scan from top/left, False for bottom/right
            
        Returns:
            Pixel offset for the slice boundary
        """
        h, w = alpha.shape
        min_slice = 8  # Minimum corner size
        max_slice_ratio = 0.4  # Don't use more than 40% for corners
        
        if direction == "horizontal":
            max_slice = min(int(h * max_slice_ratio), h // 2)
            indices = range(min_slice, max_slice) if from_start else range(h - min_slice, h - max_slice, -1)
            
            for i in indices:
                if from_start:
                    # Check if rows i and i+1 are similar (pattern repeating)
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
        """
        Checks if two rows/columns have similar alpha patterns.
        
        Args:
            row1, row2: 1D numpy arrays to compare
            threshold: Similarity threshold (0-1)
            
        Returns:
            True if rows are similar enough to be stretchable
        """
        if len(row1) != len(row2):
            return False
        matching = np.sum(np.abs(row1.astype(float) - row2.astype(float)) < 10)
        return (matching / len(row1)) >= threshold

    def classify_shape(self, img_rgba: np.ndarray) -> Dict[str, Any]:
        """
        Classifies the shape of the opaque content in the image.
        
        Uses contour analysis and circularity metrics to determine if the
        content is a circle, rectangle, or organic shape.
        
        Args:
            img_rgba: RGBA image as numpy array (H, W, 4)
            
        Returns:
            Shape classification:
            - {"type": "circle", "radius": "50%"}
            - {"type": "rectangle", "corner_radius": 0}
            - {"type": "rounded_rectangle", "corner_radius": 12}
            - {"type": "organic"}
        """
        alpha = img_rgba[:, :, 3]
        
        # Create binary mask of opaque regions
        _, binary = cv2.threshold(alpha, 127, 255, cv2.THRESH_BINARY)
        
        # Find contours
        contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        
        if not contours:
            return {"type": "empty"}
        
        # Get the largest contour (main shape)
        main_contour = max(contours, key=cv2.contourArea)
        area = cv2.contourArea(main_contour)
        perimeter = cv2.arcLength(main_contour, True)
        
        if perimeter == 0:
            return {"type": "organic"}
        
        # Circularity: 4π * area / perimeter²  (1.0 = perfect circle)
        circularity = (4 * np.pi * area) / (perimeter ** 2)
        
        # Get bounding rect for aspect ratio
        x, y, w, h = cv2.boundingRect(main_contour)
        aspect_ratio = min(w, h) / max(w, h) if max(w, h) > 0 else 0
        
        # Rectangularity: area / bounding_rect_area
        rect_area = w * h
        rectangularity = area / rect_area if rect_area > 0 else 0
        
        # Classification logic
        if circularity > 0.85 and aspect_ratio > 0.9:
            # Likely a circle
            radius = max(w, h) / 2
            return {
                "type": "circle",
                "radius": "50%",
                "diameter_px": int(radius * 2)
            }
        elif rectangularity > 0.9:
            # Likely a rectangle - check for rounded corners
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
            # Organic/irregular shape
            return {"type": "organic"}

    def _estimate_corner_radius(
        self, 
        contour: np.ndarray, 
        width: int, 
        height: int
    ) -> int:
        """
        Estimates the corner radius of a rounded rectangle.
        
        Uses the difference between contour area and bounding box area
        to estimate how much the corners are rounded.
        
        Args:
            contour: OpenCV contour
            width, height: Bounding rectangle dimensions
            
        Returns:
            Estimated corner radius in pixels
        """
        area = cv2.contourArea(contour)
        rect_area = width * height
        
        if rect_area == 0:
            return 0
        
        # Area difference due to rounded corners
        area_diff = rect_area - area
        
        # For a rounded rectangle, area removed ≈ (4 - π) * r²
        # Solving for r: r ≈ sqrt(area_diff / (4 - π))
        corner_factor = 4 - np.pi  # ≈ 0.858
        
        if area_diff > 0:
            estimated_r = np.sqrt(area_diff / corner_factor)
            # Clamp to reasonable range
            max_radius = min(width, height) / 2
            return int(min(estimated_r, max_radius))
        
        return 0

    def generate_debug_overlay(
        self,
        img_rgba: np.ndarray,
        safe_zone: Dict[str, int],
        content_zones: Dict[str, int],
        output_path: Path
    ) -> Path:
        """
        Generates a debug visualization with safe_zone and content_zones overlays.
        
        Useful for validating that CV analysis is detecting the correct regions.
        Green = safe_zone (LIR), Red = content_zone boundary (insets).
        
        Args:
            img_rgba: RGBA image as numpy array (H, W, 4)
            safe_zone: LIR result {x, y, width, height}
            content_zones: Inset dict {inset_top, inset_right, inset_bottom, inset_left}
            output_path: Path where the debug image should be saved
            
        Returns:
            Path to the generated debug overlay file
        """
        # Convert RGBA to BGRA for OpenCV
        debug = img_rgba.copy()
        h, w = debug.shape[:2]
        
        # Draw content_zones boundary as red rectangle (edge of insets)
        top = content_zones.get("inset_top", 0)
        right = content_zones.get("inset_right", 0)
        bottom = content_zones.get("inset_bottom", 0)
        left = content_zones.get("inset_left", 0)
        
        # Red rectangle showing content zone boundary
        cv2.rectangle(
            debug,
            (left, top),
            (w - right, h - bottom),
            (0, 0, 255, 255),  # Red (BGRA)
            3
        )
        
        # Draw safe_zone as semi-transparent green filled box
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
                (0, 255, 0, 200),  # Green (BGRA)
                -1  # Filled
            )
            # Blend: 30% green overlay, 70% original
            cv2.addWeighted(overlay, 0.3, debug, 0.7, 0, debug)
            
            # Add green border for clarity
            cv2.rectangle(
                debug,
                (sz_x, sz_y),
                (sz_x + sz_w, sz_y + sz_h),
                (0, 255, 0, 255),
                2
            )
        
        # Ensure output directory exists
        output_path.parent.mkdir(parents=True, exist_ok=True)
        
        # Save as PNG
        cv2.imwrite(str(output_path), debug)
        
        return output_path

    def generate_mask(
        self, 
        img_rgba: np.ndarray, 
        output_path: Path,
        safety_margin_ratio: float = 0.02
    ) -> Path:
        """
        Creates a content-safe clipping mask for organic shapes.
        
        The mask is INVERTED from the alpha channel:
        - White (255) = Safe content area (where text/avatars can go)
        - Black (0) = Frame/painted area (do not place content here)
        
        Applies morphological erosion for a safety margin to prevent
        content from bleeding into fuzzy watercolor edges.
        
        Args:
            img_rgba: RGBA image as numpy array (H, W, 4)
            output_path: Path where the mask should be saved
            safety_margin_ratio: Percentage of dim to erode for safety (default 2%)
            
        Returns:
            Path to the generated mask file
        """
        alpha = img_rgba[:, :, 3]
        h, w = alpha.shape
        
        # INVERT: Void (alpha=0) -> White, Frame (alpha>0) -> Black
        # Threshold at 5% opacity (per research: aggressive threshold)
        void_mask = (alpha < 13).astype(np.uint8) * 255  # 13 = 5% of 255
        
        # Apply morphological erosion for safety margin
        safety_margin = int(min(h, w) * safety_margin_ratio)
        if safety_margin > 0:
            kernel = cv2.getStructuringElement(
                cv2.MORPH_ELLIPSE, 
                (safety_margin * 2 + 1, safety_margin * 2 + 1)
            )
            eroded_mask = cv2.erode(void_mask, kernel)
        else:
            eroded_mask = void_mask
        
        # Ensure output directory exists
        output_path.parent.mkdir(parents=True, exist_ok=True)
        
        # Save as grayscale PNG
        cv2.imwrite(str(output_path), eroded_mask)
        
        return output_path

    def find_largest_inscribed_rectangle(
        self, 
        img_rgba: np.ndarray,
        safety_margin_ratio: float = 0.02,
        shape_type: str = "geometric"
    ) -> Dict[str, int]:
        """
        Finds the Largest Inscribed Rectangle (LIR) within the transparent void.
        
        Uses the monotonic stack histogram algorithm from research for O(N*M) performance.
        This provides the maximum axis-aligned rectangle where content is guaranteed
        to not overlap the painted border.
        
        For organic shapes (watercolor, hand-painted), uses adaptive alpha threshold
        to correctly detect semi-transparent areas as "void" rather than "frame".
        
        Args:
            img_rgba: RGBA image as numpy array (H, W, 4)
            safety_margin_ratio: Percentage of dim to erode for safety (default 2%)
            shape_type: Shape classification ("organic", "geometric", etc.)
            
        Returns:
            Dictionary with rectangle coordinates:
            {"x": int, "y": int, "width": int, "height": int}
        """
        alpha = img_rgba[:, :, 3]
        h, w = alpha.shape
        
        # Calculate transparency distribution for adaptive thresholding
        total_pixels = alpha.size
        semi_transparent_ratio = np.sum((alpha > 0) & (alpha < 255)) / total_pixels
        
        # ADAPTIVE THRESHOLD selection:
        # 1. Organic shapes: watercolor brush strokes have semi-transparent edges
        # 2. High semi-transparency: likely a watercolor/painted style even if classified as geometric
        use_adaptive = shape_type == "organic" or semi_transparent_ratio > 0.5
        
        if use_adaptive:
            # Analyze center region to determine appropriate threshold
            center = alpha[h//4:3*h//4, w//4:3*w//4]
            median_alpha = np.median(center)
            
            # If center is mostly semi-transparent (brush strokes), use aggressive threshold
            if median_alpha < 128:
                void_threshold = 128  # 50% opacity counts as "void"
            else:
                void_threshold = 64   # 25% opacity fallback
        else:
            void_threshold = 13  # 5% - strict for geometric shapes
        
        void_mask = (alpha < void_threshold).astype(np.uint8) * 255
        
        safety_margin = int(min(h, w) * safety_margin_ratio)
        if safety_margin > 0:
            kernel = cv2.getStructuringElement(
                cv2.MORPH_ELLIPSE, 
                (safety_margin * 2 + 1, safety_margin * 2 + 1)
            )
            safe_region = cv2.erode(void_mask, kernel)
        else:
            safe_region = void_mask
        
        # Center-Biased Selection Setup
        center_y, center_x = h / 2.0, w / 2.0
        max_score = 0.0
        best_rect = {"x": 0, "y": 0, "width": 0, "height": 0}
        
        # Cache for column heights
        heights = np.zeros(w, dtype=np.int32)
        
        for row in range(h):
            # Update heights: if pixel is safe (255), increment height; else reset to 0
            row_pixels = (safe_region[row, :] > 127).astype(int)
            heights = (heights + row_pixels) * row_pixels
            
            # Solve "Largest Rectangle in Histogram" using monotonic stack
            stack = []  # Stores tuples: (start_index, height)
            
            # Helper to process a potential rectangle
            def process_rect(idx, h_v, current_idx):
                nonlocal max_score, best_rect
                width_v = current_idx - idx
                area = width_v * h_v
                
                # Center Proximity Score
                rect_cx = idx + width_v / 2.0
                rect_cy = (row - h_v + 1) + h_v / 2.0
                
                # Normalized distance from center
                norm_dx = (rect_cx - center_x) / (w / 2.0)
                norm_dy = (rect_cy - center_y) / (h / 2.0)
                dist_norm = (norm_dx**2 + norm_dy**2) ** 0.5
                
                # Weight: 1.0 at center, penalize distance
                # We want to strongly discourage bottom/corner artifacts.
                # Thresholding: if distance > 0.8 (far corners), weight drops significantly
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
            
            # Process remaining items in stack
            for index, h_val in stack:
                process_rect(index, h_val, w)
        
        return best_rect

    def analyze_full(self, img_rgba: np.ndarray) -> Dict[str, Any]:
        """
        Performs full layout analysis, combining all CV capabilities.
        
        This is the main entry point for the orchestrator to get all
        "Smart Asset" metadata in one call. Classifies shape first to
        enable style-aware content zone padding.
        
        Args:
            img_rgba: RGBA image as numpy array (H, W, 4)
            
        Returns:
            Complete layout metadata dictionary:
            {
                "content_zones": {...},
                "slice_insets": {...},
                "shape_hint": {...},
                "transparency": {...}
            }
        """
        # Classify shape first - needed for style-aware content zone padding
        shape_hint = self.classify_shape(img_rgba)
        shape_type = shape_hint.get("type", "geometric")
        
        # 1. Detect content zones (insets) first
        # This gives us the "Bounding Box" of the potential content area
        content_zones = self.detect_content_zones(img_rgba, shape_type)
        
        # 2. Calculate Layout Bounds (from Content Zones) FIRST
        # Represents the "structural container area" ignoring minor intrusions like vines.
        # Useful for centering the component or loose layout constraints.
        h, w = img_rgba.shape[:2]
        layout_bounds = {
            "x": content_zones["inset_left"],
            "y": content_zones["inset_top"],
            "width": w - content_zones["inset_left"] - content_zones["inset_right"],
            "height": h - content_zones["inset_top"] - content_zones["inset_bottom"]
        }
        
        # 3. Calculate LIR (Strict Safe Zone)
        # Finds largest contiguous void (avoids all intrusions like vines)
        # guaranteed to be strictly empty pixels.
        lir_zone = self.find_largest_inscribed_rectangle(img_rgba, shape_type=shape_type)
        
        # 4. Validate LIR result - detect edge artifacts
        # Whimsical/organic assets may have scattered particles (fireflies, spores) that
        # break contiguity in the center, causing LIR to find edge strips instead.
        # If LIR center is in the outer 25% of the image, fall back to layout_bounds.
        lir_center_y = lir_zone["y"] + lir_zone["height"] / 2
        lir_center_x = lir_zone["x"] + lir_zone["width"] / 2
        
        is_peripheral = (
            lir_center_y < h * 0.25 or lir_center_y > h * 0.75 or  # Top/bottom 25%
            lir_center_x < w * 0.25 or lir_center_x > w * 0.75     # Left/right 25%
        )
        
        if is_peripheral and lir_zone["width"] > 0 and lir_zone["height"] > 0:
            # LIR found an edge artifact (e.g., transparent border strip)
            # Fall back to layout_bounds which tolerates scattered particles
            safe_zone = layout_bounds.copy()
            safe_zone["_fallback"] = "layout_bounds"
        else:
            safe_zone = lir_zone
        
        return {
            "content_zones": content_zones,
            "slice_insets": self.detect_9slice_insets(img_rgba),
            "shape_hint": shape_hint,
            "transparency": self.analyze_transparency(img_rgba),
            "safe_zone": safe_zone,         # STRICT (or fallback if LIR was peripheral)
            "layout_bounds": layout_bounds  # LOOSE: Use for centering/titles
        }
    def _analyze_layout_strategy(self, width: int, height: int) -> Dict[str, str]:
        """
        Suggests a layout strategy for coding agents based on aspect ratio.
        
        Args:
            width: Width of the safe content zone
            height: Height of the safe content zone
            
        Returns:
            Dictionary with layout hints:
            {
                "suggested": "horizontal_row" | "vertical_column" | "centered",
                "avatar_alignment": "left" | "top" | "center",
                "text_alignment": "center-left" | "center-bottom" | "center"
            }
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
