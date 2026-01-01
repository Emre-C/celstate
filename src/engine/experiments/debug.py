"""
Debug utilities for the Celstate media pipeline.

These utilities allow testing matting and chroma key processing locally
without making API calls, reducing experimentation costs to $0.
"""

import os
import subprocess
from pathlib import Path
from typing import Dict, Any, Optional
from datetime import datetime

import cv2
import numpy as np


# Reuse constants from processor
CHROMA_COLOR = "0x00FF00"
CHROMA_SIMILARITY = 0.15  # Balanced for muted backgrounds
CHROMA_BLEND = 0.15       # Smooth transition
VIDEO_WIDTH = 512
VIDEO_FPS = 15
VIDEO_QUALITY = 80


class DebugProcessor:
    """Standalone debugging utilities for the media pipeline."""

    def __init__(self, output_base: Optional[Path] = None):
        """Initialize debug processor.
        
        Args:
            output_base: Base directory for debug outputs. Defaults to var/debug/
        """
        self.output_base = output_base or Path(__file__).parent.parent.parent / "var" / "debug"
        self.output_base.mkdir(parents=True, exist_ok=True)

    def _create_debug_session(self, name: str) -> Path:
        """Create a timestamped debug session directory."""
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        session_dir = self.output_base / f"{name}_{timestamp}"
        session_dir.mkdir(parents=True, exist_ok=True)
        return session_dir

    def _detect_background_color(self, video_path: Path) -> str:
        """Samples corners of the first frame to detect background color."""
        cap = cv2.VideoCapture(str(video_path))
        ret, frame = cap.read()
        cap.release()
        
        if not ret:
            return "0x00FF00" # Fallback
            
        # Sample average of 4 corners (10x10 blocks)
        h, w = frame.shape[:2]
        corners = [
            frame[0:10, 0:10],
            frame[0:10, w-10:w],
            frame[h-10:h, 0:10],
            frame[h-10:h, w-10:w]
        ]
        
        avg_bgr = np.mean([np.mean(c, axis=(0, 1)) for c in corners], axis=0)
        # Convert BGR to Hex (0xRRGGBB)
        hex_color = "0x{:02X}{:02X}{:02X}".format(
            int(avg_bgr[2]), int(avg_bgr[1]), int(avg_bgr[0])
        )
        return hex_color

    def test_matting_local(
        self, 
        white_path: Path, 
        black_path: Path, 
        output_dir: Optional[Path] = None
    ) -> Dict[str, Any]:
        """Test difference matting with local images.
        
        Args:
            white_path: Path to white background pass image
            black_path: Path to black background pass image
            output_dir: Optional output directory. Creates debug session if not provided.
            
        Returns:
            Dict with results including paths to debug artifacts and telemetry.
        """
        session_dir = output_dir or self._create_debug_session("matting")
        
        # Read images
        img_w = cv2.imread(str(white_path))
        img_b = cv2.imread(str(black_path))
        
        if img_w is None:
            return {"success": False, "error": f"Cannot read white image: {white_path}"}
        if img_b is None:
            return {"success": False, "error": f"Cannot read black image: {black_path}"}
        
        # Save copies of inputs for reference
        cv2.imwrite(str(session_dir / "input_white.png"), img_w)
        cv2.imwrite(str(session_dir / "input_black.png"), img_b)
        
        # Convert to float for math
        img_w_f = img_w.astype(float)
        img_b_f = img_b.astype(float)
        
        # Alpha recovery: Alpha = 1 - (pixel_distance / 255)
        diff = np.abs(img_w_f - img_b_f)
        alpha = 1.0 - (np.mean(diff, axis=2) / 255.0)
        alpha = np.clip(alpha, 0, 1)
        
        # Save diff visualization
        diff_vis = (np.mean(diff, axis=2)).astype(np.uint8)
        cv2.imwrite(str(session_dir / "debug_diff.png"), diff_vis)
        
        # Save alpha channel as grayscale
        alpha_vis = (alpha * 255).astype(np.uint8)
        cv2.imwrite(str(session_dir / "debug_alpha.png"), alpha_vis)
        
        # Color recovery (un-premultiply from black)
        with np.errstate(divide='ignore', invalid='ignore'):
            color = img_b_f / alpha[:, :, np.newaxis]
        color = np.nan_to_num(color, nan=0.0)
        
        # Construct RGBA
        final_alpha = (alpha * 255).astype(np.uint8)
        final_bgr = np.clip(color, 0, 255).astype(np.uint8)
        rgba = cv2.merge([final_bgr[:,:,0], final_bgr[:,:,1], final_bgr[:,:,2], final_alpha])
        
        # Save final output
        output_path = session_dir / "output.webp"
        cv2.imwrite(str(output_path), rgba, [cv2.IMWRITE_WEBP_QUALITY, 90])
        
        # Also save as PNG for easier inspection
        cv2.imwrite(str(session_dir / "output.png"), rgba)
        
        # Calculate telemetry
        total = alpha.size
        telemetry = {
            "size": f"{rgba.shape[1]}x{rgba.shape[0]}",
            "transparent": f"{np.sum(alpha == 0) / total * 100:.1f}%",
            "semi_transparent": f"{np.sum((alpha > 0) & (alpha < 1)) / total * 100:.1f}%",
            "opaque": f"{np.sum(alpha == 1) / total * 100:.1f}%",
            "mean_alpha": f"{np.mean(alpha) * 100:.1f}%",
        }
        
        # Write report
        report = f"""# Matting Debug Report

## Inputs
- White: {white_path}
- Black: {black_path}

## Telemetry
- Size: {telemetry['size']}
- Fully Transparent: {telemetry['transparent']}
- Semi-Transparent: {telemetry['semi_transparent']}
- Fully Opaque: {telemetry['opaque']}
- Mean Alpha: {telemetry['mean_alpha']}

## Debug Artifacts
- `input_white.png` - Copy of white pass input
- `input_black.png` - Copy of black pass input
- `debug_diff.png` - Pixel difference visualization
- `debug_alpha.png` - Extracted alpha channel (white=opaque, black=transparent)
- `output.webp` - Final output with alpha
- `output.png` - PNG version for inspection
"""
        (session_dir / "report.md").write_text(report)
        
        return {
            "success": True,
            "session_dir": str(session_dir),
            "output": str(output_path),
            "telemetry": telemetry,
            "artifacts": {
                "input_white": str(session_dir / "input_white.png"),
                "input_black": str(session_dir / "input_black.png"),
                "debug_diff": str(session_dir / "debug_diff.png"),
                "debug_alpha": str(session_dir / "debug_alpha.png"),
                "output_webp": str(output_path),
                "output_png": str(session_dir / "output.png"),
                "report": str(session_dir / "report.md"),
            }
        }

    def test_chromakey_local(
        self, 
        video_path: Path, 
        output_dir: Optional[Path] = None
    ) -> Dict[str, Any]:
        """Test chroma key extraction with local video.
        
        Args:
            video_path: Path to green screen video (MP4)
            output_dir: Optional output directory. Creates debug session if not provided.
            
        Returns:
            Dict with results including paths to debug artifacts and telemetry.
        """
        session_dir = output_dir or self._create_debug_session("chromakey")
        
        if not Path(video_path).exists():
            return {"success": False, "error": f"Video not found: {video_path}"}
        
        output_webp = session_dir / "output.webp"
        
        detected_color = self._detect_background_color(video_path)
        
        # Build filter chain (same as processor.py)
        filter_chain = (
            f"chromakey={detected_color}:{CHROMA_SIMILARITY}:{CHROMA_BLEND},"
            f"lutrgb=g='val*0.9':b='val*1.1':r='val*1.1'," 
            f"scale={VIDEO_WIDTH}:-1:flags=lanczos,"
            f"fps={VIDEO_FPS}"
        )
        
        # FFmpeg command with EXPLICIT alpha pixel format (THE FIX)
        cmd = [
            "ffmpeg", "-y",
            "-i", str(video_path),
            "-vf", filter_chain,
            "-pix_fmt", "yuva420p",  # CRITICAL: Explicit alpha pixel format
            "-c:v", "libwebp",
            "-lossless", "0",
            "-quality", str(VIDEO_QUALITY),
            "-loop", "0",
            "-an",
            "-vsync", "0",
            str(output_webp),
        ]
        
        # Also extract first frame for debugging
        first_frame_cmd = [
            "ffmpeg", "-y",
            "-i", str(video_path),
            "-vf", f"{filter_chain},select=eq(n\\,0)",
            "-frames:v", "1",
            "-pix_fmt", "rgba",
            str(session_dir / "first_frame_with_alpha.png"),
        ]
        
        # Extract first frame WITHOUT chroma key for comparison
        first_frame_raw_cmd = [
            "ffmpeg", "-y",
            "-i", str(video_path),
            "-vf", "select=eq(n\\,0)",
            "-frames:v", "1",
            str(session_dir / "first_frame_raw.png"),
        ]
        
        results = {}
        
        # Run main conversion
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            return {
                "success": False, 
                "error": f"FFmpeg failed: {result.stderr}",
                "command": " ".join(cmd)
            }
        
        results["output_webp"] = str(output_webp)
        results["output_size_kb"] = round(os.path.getsize(output_webp) / 1024, 1)
        
        # Run debug frame extractions (ignore failures)
        subprocess.run(first_frame_raw_cmd, capture_output=True)
        subprocess.run(first_frame_cmd, capture_output=True)
        
        # Analyze output for alpha
        # Read first frame back and check alpha
        first_frame_path = session_dir / "first_frame_with_alpha.png"
        if first_frame_path.exists():
            img = cv2.imread(str(first_frame_path), cv2.IMREAD_UNCHANGED)
            if img is not None and img.shape[2] == 4:
                alpha = img[:, :, 3]
                total = alpha.size
                results["telemetry"] = {
                    "has_alpha": True,
                    "transparent": f"{np.sum(alpha == 0) / total * 100:.1f}%",
                    "semi_transparent": f"{np.sum((alpha > 0) & (alpha < 255)) / total * 100:.1f}%",
                    "opaque": f"{np.sum(alpha == 255) / total * 100:.1f}%",
                }
                
                # Save alpha channel visualization
                cv2.imwrite(str(session_dir / "debug_alpha.png"), alpha)
            else:
                results["telemetry"] = {"has_alpha": False, "channels": img.shape[2] if img is not None else 0}
        
        # Write report
        report = f"""# Chroma Key Debug Report

## Input
- Video: {video_path}

## FFmpeg Command
```
{' '.join(cmd)}
```

## Output
- WebP: {output_webp}
- Size: {results.get('output_size_kb', 'N/A')} KB

## Telemetry
{results.get('telemetry', 'Not available')}

## Debug Artifacts
- `first_frame_raw.png` - First frame before chroma key
- `first_frame_with_alpha.png` - First frame after chroma key (with alpha)
- `debug_alpha.png` - Alpha channel visualization
- `output.webp` - Final animated WebP with alpha
"""
        (session_dir / "report.md").write_text(report)
        
        return {
            "success": True,
            "session_dir": str(session_dir),
            **results,
            "artifacts": {
                "first_frame_raw": str(session_dir / "first_frame_raw.png"),
                "first_frame_alpha": str(session_dir / "first_frame_with_alpha.png"),
                "debug_alpha": str(session_dir / "debug_alpha.png"),
                "output_webp": str(output_webp),
                "report": str(session_dir / "report.md"),
            }
        }

    def analyze_studio_passes(self, studio_dir: Path) -> Dict[str, Any]:
        """Analyze existing studio passes from a job.
        
        Args:
            studio_dir: Path to job's studio directory (contains white/black/green passes)
            
        Returns:
            Dict with analysis of each pass found.
        """
        studio_dir = Path(studio_dir)
        if not studio_dir.exists():
            return {"success": False, "error": f"Studio dir not found: {studio_dir}"}
        
        analysis = {"success": True, "passes": {}}
        
        for file in studio_dir.iterdir():
            if file.suffix.lower() in [".png", ".jpg", ".jpeg"]:
                img = cv2.imread(str(file))
                if img is not None:
                    # Analyze image
                    mean_color = np.mean(img, axis=(0, 1))
                    is_likely_white = np.mean(mean_color) > 200
                    is_likely_black = np.mean(mean_color) < 55
                    
                    analysis["passes"][file.name] = {
                        "size": f"{img.shape[1]}x{img.shape[0]}",
                        "mean_bgr": [round(c, 1) for c in mean_color],
                        "likely_pass": "white" if is_likely_white else ("black" if is_likely_black else "unknown"),
                    }
            elif file.suffix.lower() in [".mp4", ".mov", ".webm"]:
                # Check video exists
                analysis["passes"][file.name] = {
                    "type": "video",
                    "size_kb": round(os.path.getsize(file) / 1024, 1),
                }
        
        return analysis

    def generate_debug_report(self, job_id: str, jobs_dir: Optional[Path] = None) -> Dict[str, Any]:
        """Generate a full debug report for an existing job.
        
        Args:
            job_id: The job UUID
            jobs_dir: Base jobs directory. Defaults to var/jobs/
            
        Returns:
            Dict with path to generated report and analysis.
        """
        jobs_dir = jobs_dir or Path(__file__).parent.parent.parent / "var" / "jobs"
        job_dir = jobs_dir / job_id
        
        if not job_dir.exists():
            return {"success": False, "error": f"Job not found: {job_id}"}
        
        studio_dir = job_dir / "studio"
        output_dir = job_dir / "outputs"
        
        session_dir = self._create_debug_session(f"job_{job_id[:8]}")
        
        report_parts = [f"# Debug Report: {job_id}\n"]
        
        # Analyze studio passes
        if studio_dir.exists():
            studio_analysis = self.analyze_studio_passes(studio_dir)
            report_parts.append("## Studio Passes\n")
            for name, info in studio_analysis.get("passes", {}).items():
                report_parts.append(f"- **{name}**: {info}\n")
        
        # Analyze outputs
        if output_dir.exists():
            report_parts.append("\n## Outputs\n")
            for file in output_dir.iterdir():
                if file.suffix.lower() in [".webp", ".png"]:
                    img = cv2.imread(str(file), cv2.IMREAD_UNCHANGED)
                    if img is not None:
                        has_alpha = img.shape[2] == 4 if len(img.shape) == 3 else False
                        report_parts.append(f"- **{file.name}**: {img.shape[1]}x{img.shape[0]}, Alpha: {has_alpha}\n")
        
        report_path = session_dir / "report.md"
        report_path.write_text("".join(report_parts))
        
        return {
            "success": True,
            "report": str(report_path),
            "session_dir": str(session_dir),
        }
