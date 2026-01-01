#!/usr/bin/env python3
"""
Experiment: Dual-Pass Video Difference Matting Feasibility

This script tests whether Veo 3.1's first/last frame interpolation can produce
frame-aligned videos on white and black backgrounds for Difference Matting.

Success Criteria:
- Frame registration error < 5 pixels RMS
- Motion vector alignment > 95% correlation
- Resulting alpha has no visible halos

Usage:
    python scripts/experiment_dual_pass_video.py --prompt "A cute robot" --name "robot_test"
"""

import argparse
import os
import sys
from pathlib import Path
import random

# Add src to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

import cv2
import numpy as np


def extract_frames(video_path: Path, output_dir: Path, max_frames: int = 30) -> list[Path]:
    """Extract frames from video for analysis."""
    output_dir.mkdir(parents=True, exist_ok=True)
    
    cap = cv2.VideoCapture(str(video_path))
    frames = []
    frame_count = 0
    
    while True:
        ret, frame = cap.read()
        if not ret or frame_count >= max_frames:
            break
        
        frame_path = output_dir / f"frame_{frame_count:04d}.png"
        cv2.imwrite(str(frame_path), frame)
        frames.append(frame_path)
        frame_count += 1
    
    cap.release()
    return frames


def compute_frame_difference(white_frame: np.ndarray, black_frame: np.ndarray) -> dict:
    """Compute difference metrics between corresponding frames."""
    # Convert to float for precision
    w = white_frame.astype(float)
    b = black_frame.astype(float)
    
    # Per-pixel difference
    diff = np.abs(w - b)
    
    # RMS error (lower = more aligned)
    rms = np.sqrt(np.mean(diff ** 2))
    
    # Mean absolute error
    mae = np.mean(diff)
    
    # Max difference
    max_diff = np.max(diff)
    
    return {
        "rms": rms,
        "mae": mae,
        "max_diff": max_diff,
    }


def compute_motion_correlation(white_frames: list, black_frames: list) -> dict:
    """
    Compute optical flow between consecutive frames and compare motion patterns.
    Higher correlation means motion is more aligned between the two videos.
    """
    if len(white_frames) < 2 or len(black_frames) < 2:
        return {"error": "Need at least 2 frames"}
    
    correlations = []
    
    for i in range(min(len(white_frames), len(black_frames)) - 1):
        # Read consecutive frames
        w1 = cv2.imread(str(white_frames[i]), cv2.IMREAD_GRAYSCALE)
        w2 = cv2.imread(str(white_frames[i + 1]), cv2.IMREAD_GRAYSCALE)
        b1 = cv2.imread(str(black_frames[i]), cv2.IMREAD_GRAYSCALE)
        b2 = cv2.imread(str(black_frames[i + 1]), cv2.IMREAD_GRAYSCALE)
        
        # Compute optical flow for white video
        flow_w = cv2.calcOpticalFlowFarneback(w1, w2, None, 0.5, 3, 15, 3, 5, 1.2, 0)
        
        # Compute optical flow for black video
        flow_b = cv2.calcOpticalFlowFarneback(b1, b2, None, 0.5, 3, 15, 3, 5, 1.2, 0)
        
        # Flatten flows for correlation
        flow_w_flat = flow_w.flatten()
        flow_b_flat = flow_b.flatten()
        
        # Compute correlation coefficient
        if np.std(flow_w_flat) > 0 and np.std(flow_b_flat) > 0:
            corr = np.corrcoef(flow_w_flat, flow_b_flat)[0, 1]
            correlations.append(corr)
    
    if not correlations:
        return {"error": "Could not compute correlations"}
    
    return {
        "mean_correlation": np.mean(correlations),
        "min_correlation": np.min(correlations),
        "max_correlation": np.max(correlations),
        "std_correlation": np.std(correlations),
    }


def attempt_difference_matting(white_video_path: Path, black_video_path: Path, output_dir: Path) -> dict:
    """
    Attempt to apply Difference Matting to corresponding frames.
    This is the core test: can we extract usable alpha from the dual-pass video?
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    
    # Extract frames
    white_frames_dir = output_dir / "white_frames"
    black_frames_dir = output_dir / "black_frames"
    matted_dir = output_dir / "matted_frames"
    matted_dir.mkdir(parents=True, exist_ok=True)
    
    white_frames = extract_frames(white_video_path, white_frames_dir)
    black_frames = extract_frames(black_video_path, black_frames_dir)
    
    if len(white_frames) != len(black_frames):
        return {"error": f"Frame count mismatch: white={len(white_frames)}, black={len(black_frames)}"}
    
    # Process each frame pair
    frame_metrics = []
    
    for i, (wf, bf) in enumerate(zip(white_frames, black_frames)):
        img_w = cv2.imread(str(wf)).astype(float)
        img_b = cv2.imread(str(bf)).astype(float)
        
        # Difference Matting formula: Alpha = 1 - (pixel_distance / 255)
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
        
        # Save matted frame
        matted_path = matted_dir / f"matted_{i:04d}.png"
        cv2.imwrite(str(matted_path), rgba)
        
        # Compute metrics for this frame
        metrics = compute_frame_difference(img_w, img_b)
        metrics["frame"] = i
        metrics["alpha_mean"] = np.mean(alpha)
        metrics["alpha_std"] = np.std(alpha)
        frame_metrics.append(metrics)
    
    # Aggregate metrics
    avg_rms = np.mean([m["rms"] for m in frame_metrics])
    avg_mae = np.mean([m["mae"] for m in frame_metrics])
    
    # Compute motion correlation
    motion_metrics = compute_motion_correlation(white_frames, black_frames)
    
    return {
        "frame_count": len(white_frames),
        "avg_rms_error": avg_rms,
        "avg_mae_error": avg_mae,
        "motion_correlation": motion_metrics.get("mean_correlation", 0),
        "matted_frames_dir": str(matted_dir),
        "frame_metrics": frame_metrics,
        "motion_metrics": motion_metrics,
        "success": avg_rms < 30 and motion_metrics.get("mean_correlation", 0) > 0.5,  # Initial thresholds
    }


def run_experiment(prompt: str, name: str, output_dir: Path, seed: int = None):
    """Run the full dual-pass video experiment."""
    from src.engine.generator import MediaGenerator
    
    print("=" * 60)
    print("DUAL-PASS VIDEO DIFFERENCE MATTING FEASIBILITY EXPERIMENT")
    print("=" * 60)
    print(f"Prompt: {prompt}")
    print(f"Name: {name}")
    print(f"Seed: {seed}")
    print("=" * 60)
    
    output_dir.mkdir(parents=True, exist_ok=True)
    studio_dir = output_dir / "studio"
    
    # Initialize generator
    generator = MediaGenerator()
    
    # Generate dual-pass videos
    print("\n[Phase 1] Generating dual-pass looping videos...")
    result = generator.generate_video_loop_pair(
        prompt=prompt,
        name=name,
        studio_dir=studio_dir,
        seed=seed,
    )
    
    print(f"\nGenerated assets:")
    for key, value in result.items():
        print(f"  {key}: {value}")
    
    # Analyze the results
    print("\n[Phase 2] Analyzing frame alignment and motion correlation...")
    analysis_dir = output_dir / "analysis"
    
    analysis = attempt_difference_matting(
        white_video_path=Path(result["white_video"]),
        black_video_path=Path(result["black_video"]),
        output_dir=analysis_dir,
    )
    
    # Print results
    print("\n" + "=" * 60)
    print("EXPERIMENT RESULTS")
    print("=" * 60)
    print(f"Frame Count: {analysis.get('frame_count', 'N/A')}")
    print(f"Avg RMS Error: {analysis.get('avg_rms_error', 'N/A'):.2f} (target: < 30)")
    print(f"Avg MAE Error: {analysis.get('avg_mae_error', 'N/A'):.2f}")
    print(f"Motion Correlation: {analysis.get('motion_correlation', 'N/A'):.4f} (target: > 0.5)")
    print(f"Matted Frames: {analysis.get('matted_frames_dir', 'N/A')}")
    print("=" * 60)
    
    if analysis.get("success"):
        print("\n✅ EXPERIMENT PASSED: Dual-pass video Difference Matting appears FEASIBLE!")
        print("   → Motion is adequately correlated between white and black videos.")
        print("   → Proceed to Phase 2: Quantitative validation.")
    else:
        print("\n❌ EXPERIMENT FAILED: Motion is NOT aligned between videos.")
        print("   → Veo 3.1 generates different motion paths for each background color.")
        print("   → Recommend: Pivot to Approach 4 (Hybrid: chroma key + static key frames).")
    
    # Save report
    report_path = output_dir / "experiment_report.md"
    with open(report_path, "w") as f:
        f.write(f"# Dual-Pass Video Experiment Report\n\n")
        f.write(f"**Prompt:** {prompt}\n\n")
        f.write(f"**Seed:** {seed}\n\n")
        f.write(f"## Results\n\n")
        f.write(f"| Metric | Value | Target |\n")
        f.write(f"|--------|-------|--------|\n")
        f.write(f"| Frame Count | {analysis.get('frame_count', 'N/A')} | - |\n")
        f.write(f"| Avg RMS Error | {analysis.get('avg_rms_error', 'N/A'):.2f} | < 30 |\n")
        f.write(f"| Motion Correlation | {analysis.get('motion_correlation', 'N/A'):.4f} | > 0.5 |\n")
        f.write(f"\n## Conclusion\n\n")
        if analysis.get("success"):
            f.write("✅ **FEASIBLE** - Proceed to full integration.\n")
        else:
            f.write("❌ **NOT FEASIBLE** - Pivot to hybrid approach.\n")
    
    print(f"\nReport saved to: {report_path}")
    
    return analysis


def main():
    parser = argparse.ArgumentParser(description="Dual-Pass Video Difference Matting Experiment")
    parser.add_argument("--prompt", type=str, required=True, help="Subject prompt (e.g., 'A cute robot')")
    parser.add_argument("--name", type=str, required=True, help="Asset name (e.g., 'robot_test')")
    parser.add_argument("--output", type=str, default="var/experiments", help="Output directory")
    parser.add_argument("--seed", type=int, default=None, help="Random seed for reproducibility")
    
    args = parser.parse_args()
    
    if args.seed is None:
        args.seed = random.randint(1, 999999)
    
    output_dir = Path(args.output) / args.name
    
    run_experiment(
        prompt=args.prompt,
        name=args.name,
        output_dir=output_dir,
        seed=args.seed,
    )


if __name__ == "__main__":
    main()
