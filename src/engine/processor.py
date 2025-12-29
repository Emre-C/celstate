import os
import subprocess
from pathlib import Path
from typing import Dict, List, Any, Optional

import cv2
import numpy as np

# Manifest version for component output
MANIFEST_VERSION = "0.1"

# Mobile-First Constants
DENSITY_SCALES = {
    "@3x": 1.0,
    "@2x": 2/3,
    "@1x": 1/3,
}

VIDEO_WIDTH = 512
VIDEO_FPS = 15
VIDEO_QUALITY = 80
CHROMA_COLOR = "0x00FF00"
CHROMA_SIMILARITY = 0.1
CHROMA_BLEND = 0.2

class MediaProcessor:
    def __init__(self):
        pass

    def _analyze_transparency(self, img_rgba: np.ndarray) -> Dict[str, Any]:
        alpha = img_rgba[:, :, 3]
        total = alpha.size
        return {
            "size": f"{img_rgba.shape[1]}x{img_rgba.shape[0]}",
            "transparent": f"{np.sum(alpha == 0) / total * 100:.1f}%",
            "semi_transparent": f"{np.sum((alpha > 0) & (alpha < 255)) / total * 100:.1f}%",
            "opaque": f"{np.sum(alpha == 255) / total * 100:.1f}%",
        }

    def process_image(self, white_path: Path, black_path: Path, name: str, output_dir: Path) -> Dict[str, Any]:
        """Difference Matting -> @1x/@2x/@3x WebP variants."""
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
        
        variants = []
        h, w = rgba.shape[:2]
        
        for suffix, scale in DENSITY_SCALES.items():
            new_w, new_h = int(w * scale), int(h * scale)
            resized = cv2.resize(rgba, (new_w, new_h), interpolation=cv2.INTER_LANCZOS4) if scale < 1.0 else rgba
            
            filename = f"{name}{suffix}.webp"
            filepath = output_dir / filename
            cv2.imwrite(str(filepath), resized, [cv2.IMWRITE_WEBP_QUALITY, 90])
            
            variants.append({
                "scale": suffix,
                "size": f"{new_w}x{new_h}",
                "file": str(filepath)
            })
            
        # Build manifest-compliant component structure
        # Primary asset is @3x, others are density variants
        primary_variant = next(v for v in variants if v["scale"] == "@3x")
        width, height = map(int, primary_variant["size"].split("x"))
        
        component = {
            "manifest": {
                "version": MANIFEST_VERSION,
                "id": name,
                "type": "static",  # Single-state for now, "interactive" when multi-state
                "intrinsics": {
                    "size": {"width": width, "height": height},
                    "anchor": {"x": 0.5, "y": 0.5}
                },
                "states": {
                    "idle": {
                        "clip": f"{name}@3x.webp",
                        "loop": False,
                        "variants": {v["scale"]: f"{name}{v['scale']}.webp" for v in variants}
                    }
                },
                "transitions": [],
                "accessibility": {
                    "role": "image",
                    "label": name.replace("_", " ").title()
                }
            },
            "assets": {f"{name}{v['scale']}.webp": None for v in variants},  # URLs populated by API
            "telemetry": self._analyze_transparency(rgba)
        }
        
        return {
            "name": name,
            "variants": variants,
            "component": component,
            "telemetry": self._analyze_transparency(rgba)
        }

    def process_video(self, video_path: Path, name: str, output_dir: Path) -> Dict[str, Any]:
        """Chroma Key -> Optimized animated WebP."""
        output_dir.mkdir(parents=True, exist_ok=True)
        output_file = output_dir / f"{name}.webp"
        
        filter_chain = (
            f"chromakey={CHROMA_COLOR}:{CHROMA_SIMILARITY}:{CHROMA_BLEND},"
            f"scale={VIDEO_WIDTH}:-1:flags=lanczos,"
            f"fps={VIDEO_FPS}"
        )
        
        cmd = [
            "ffmpeg", "-y",
            "-i", str(video_path),
            "-vf", filter_chain,
            "-c:v", "libwebp",
            "-lossless", "0",
            "-quality", str(VIDEO_QUALITY),
            "-loop", "0",
            "-an",
            "-vsync", "0",
            str(output_file),
        ]
        
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            raise RuntimeError(f"FFmpeg failed: {result.stderr}")
            
        size_kb = os.path.getsize(output_file) / 1024
        
        # Build manifest-compliant component structure for video/animation
        component = {
            "manifest": {
                "version": MANIFEST_VERSION,
                "id": name,
                "type": "animated",
                "intrinsics": {
                    "size": {"width": VIDEO_WIDTH, "height": None},  # Height determined by aspect
                    "anchor": {"x": 0.5, "y": 0.5}
                },
                "states": {
                    "idle": {
                        "clip": f"{name}.webp",
                        "loop": True,
                        "fps": VIDEO_FPS
                    }
                },
                "transitions": [],
                "accessibility": {
                    "role": "img",
                    "label": name.replace("_", " ").title()
                }
            },
            "assets": {f"{name}.webp": None},  # URL populated by API
            "telemetry": {"size_kb": round(size_kb, 1)}
        }
        
        return {
            "name": name,
            "file": str(output_file),
            "component": component,
            "size_kb": round(size_kb, 1)
        }
