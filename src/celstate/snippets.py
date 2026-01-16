"""
Snippet Generator: Converts raw asset measurements into copy-pasteable code.

This module is the core of the "Fat Response" strategy. It takes the platform-agnostic
measurements (Pixels) and converts them into platform-specific code (Snippets)
for CSS, Tailwind, React Native, Swift, Kotlin, and Internal Mapping.
"""

from typing import Dict, Optional

class SnippetGenerator:
    """
    Generates code snippets for various platforms based on asset layout metrics.
    """

    def generate_all(
        self, 
        safe_zone: Dict[str, int], 
        layout_bounds: Dict[str, int],
        image_size: Optional[tuple[int, int]] = None
    ) -> Dict[str, str]:
        """
        Generates snippets for all supported platforms.
        
        Args:
            safe_zone: LIR result {x, y, width, height}
            layout_bounds: Structural bounds {x, y, width, height}
            image_size: Optional (width, height) of the image for percentage calcs
            
        Returns:
            Dictionary of snippets.
        """
        # We primarily use layout_bounds for positioning content containers
        # as it represents the "structural" box.
        # However, for some strict shapes, safe_zone might be preferred.
        # For snippets, we default to layout_bounds as it's the most common use case
        # (placing a text box inside a frame).
        
        # Determine which metric to use.
        # If safe_zone fell back to layout_bounds (via _fallback key), they are identical.
        # Generally, layout_bounds is safer for "containers".
        
        x = layout_bounds.get("x", 0)
        y = layout_bounds.get("y", 0)
        w = layout_bounds.get("width", 0)
        h = layout_bounds.get("height", 0)
        
        snippets = {
            "css_absolute": self._css_absolute(x, y, w, h),
            "tailwind_absolute": self._tailwind_absolute(x, y, w, h),
            "react_native_absolute": self._react_native_absolute(x, y, w, h),
            "swift_uikit": self._swift_uikit(x, y, w, h),
            "kotlin_compose": self._kotlin_compose(x, y, w, h)
        }
        
        if image_size:
            snippets["internal_content_mapping"] = self._internal_content_mapping(layout_bounds, image_size)
            
        return snippets

    def _internal_content_mapping(self, bounds: Dict[str, int], image_size: tuple[int, int]) -> str:
        """
        Generates a percentage-based mapping JSON for 'Zero-Math' integration.
        Example: {"left": "10%", "top": "5%", "width": "80%", "height": "90%"}
        """
        img_w, img_h = image_size
        if img_w == 0 or img_h == 0:
            return "{}"
            
        left_pct = (bounds.get("x", 0) / img_w) * 100
        top_pct = (bounds.get("y", 0) / img_h) * 100
        width_pct = (bounds.get("width", 0) / img_w) * 100
        height_pct = (bounds.get("height", 0) / img_h) * 100
        
        return (
            "{\n"
            f'  "left": "{left_pct:.1f}%",\n'
            f'  "top": "{top_pct:.1f}%",\n'
            f'  "width": "{width_pct:.1f}%",\n'
            f'  "height": "{height_pct:.1f}%"\n'
            "}"
        )

    def _css_absolute(self, x: int, y: int, w: int, h: int) -> str:
        """Standard CSS position: absolute."""
        return (
            f"position: absolute;\n"
            f"left: {x}px;\n"
            f"top: {y}px;\n"
            f"width: {w}px;\n"
            f"height: {h}px;"
        )

    def _tailwind_absolute(self, x: int, y: int, w: int, h: int) -> str:
        """
        Tailwind Utility Classes.
        Uses arbitrary values `[...]` to ensure pixel-perfect matching with the asset,
        avoiding rounding errors from standard spacing scales (e.g. w-4 = 1rem).
        """
        return f"absolute left-[{x}px] top-[{y}px] w-[{w}px] h-[{h}px]"

    def _react_native_absolute(self, x: int, y: int, w: int, h: int) -> str:
        """React Native / JS Object."""
        return (
            "{\n"
            f"  position: 'absolute',\n"
            f"  left: {x},\n"
            f"  top: {y},\n"
            f"  width: {w},\n"
            f"  height: {h}\n"
            "}"
        )

    def _swift_uikit(self, x: int, y: int, w: int, h: int) -> str:
        """Swift CoreGraphics / UIKit."""
        return f"CGRect(x: {x}, y: {y}, width: {w}, height: {h})"

    def _kotlin_compose(self, x: int, y: int, w: int, h: int) -> str:
        """
        Jetpack Compose Modifier.
        Assumes .dp import or conversion, but generates the precise instruction.
        """
        return f"Modifier.offset(x = {x}.dp, y = {y}.dp).size(width = {w}.dp, height = {h}.dp)"
