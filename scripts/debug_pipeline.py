#!/usr/bin/env python3
"""
Debug CLI for the Celstate media pipeline.

This script allows testing matting and chroma key processing locally
without making API calls, reducing experimentation costs to $0.

Usage:
    # Test difference matting with local images
    uv run python scripts/debug_pipeline.py matting \
        --white path/to/white.png \
        --black path/to/black.png

    # Test chroma key with local video
    uv run python scripts/debug_pipeline.py chromakey \
        --video path/to/green_screen.mp4

    # Analyze existing job studio passes
    uv run python scripts/debug_pipeline.py analyze \
        --job-id <uuid>

    # Generate full debug report for a job
    uv run python scripts/debug_pipeline.py report \
        --job-id <uuid>
"""

import argparse
import json
import sys
from pathlib import Path

# Add src to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from src.engine.debug import DebugProcessor


def cmd_matting(args: argparse.Namespace) -> int:
    """Test difference matting with local images."""
    processor = DebugProcessor()
    
    white_path = Path(args.white)
    black_path = Path(args.black)
    
    if not white_path.exists():
        print(f"ERROR: White image not found: {white_path}")
        return 1
    if not black_path.exists():
        print(f"ERROR: Black image not found: {black_path}")
        return 1
    
    print("Testing matting...")
    print(f"  White: {white_path}")
    print(f"  Black: {black_path}")
    
    result = processor.test_matting_local(white_path, black_path)
    
    if not result.get("success"):
        print(f"ERROR: {result.get('error')}")
        return 1
    
    print("\n✓ Success!")
    print(f"  Session: {result['session_dir']}")
    print(f"  Output: {result['output']}")
    print("\nTelemetry:")
    for key, value in result.get("telemetry", {}).items():
        print(f"  {key}: {value}")
    
    print(f"\nArtifacts saved. Open report: {result['artifacts']['report']}")
    return 0


def cmd_chromakey(args: argparse.Namespace) -> int:
    """Test chroma key with local video."""
    processor = DebugProcessor()
    
    video_path = Path(args.video)
    
    if not video_path.exists():
        print(f"ERROR: Video not found: {video_path}")
        return 1
    
    print("Testing chroma key...")
    print(f"  Video: {video_path}")
    
    result = processor.test_chromakey_local(video_path)
    
    if not result.get("success"):
        print(f"ERROR: {result.get('error')}")
        if result.get("command"):
            print(f"Command: {result['command']}")
        return 1
    
    print("\n✓ Success!")
    print(f"  Session: {result['session_dir']}")
    print(f"  Output: {result.get('output_webp')}")
    print(f"  Size: {result.get('output_size_kb')} KB")
    
    telemetry = result.get("telemetry", {})
    if telemetry:
        print("\nTelemetry:")
        for key, value in telemetry.items():
            print(f"  {key}: {value}")
    
    print(f"\nArtifacts saved. Open report: {result['artifacts']['report']}")
    return 0


def cmd_analyze(args: argparse.Namespace) -> int:
    """Analyze existing job studio passes."""
    processor = DebugProcessor()
    
    jobs_dir = Path(__file__).parent.parent / "var" / "jobs"
    studio_dir = jobs_dir / args.job_id / "studio"
    
    if not studio_dir.exists():
        print(f"ERROR: Studio dir not found: {studio_dir}")
        return 1
    
    print(f"Analyzing studio passes for job: {args.job_id}")
    
    result = processor.analyze_studio_passes(studio_dir)
    
    if not result.get("success"):
        print(f"ERROR: {result.get('error')}")
        return 1
    
    print("\nPasses found:")
    for name, info in result.get("passes", {}).items():
        print(f"  {name}: {json.dumps(info)}")
    
    return 0


def cmd_report(args: argparse.Namespace) -> int:
    """Generate full debug report for a job."""
    processor = DebugProcessor()
    
    print(f"Generating debug report for job: {args.job_id}")
    
    result = processor.generate_debug_report(args.job_id)
    
    if not result.get("success"):
        print(f"ERROR: {result.get('error')}")
        return 1
    
    print("\n✓ Report generated!")
    print(f"  Report: {result['report']}")
    print(f"  Session: {result['session_dir']}")
    
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Debug CLI for the Celstate media pipeline",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__
    )
    
    subparsers = parser.add_subparsers(dest="command", help="Command to run")
    
    # matting command
    matting_parser = subparsers.add_parser("matting", help="Test difference matting")
    matting_parser.add_argument("--white", required=True, help="Path to white pass image")
    matting_parser.add_argument("--black", required=True, help="Path to black pass image")
    
    # chromakey command
    chromakey_parser = subparsers.add_parser("chromakey", help="Test chroma key extraction")
    chromakey_parser.add_argument("--video", required=True, help="Path to green screen video")
    
    # analyze command
    analyze_parser = subparsers.add_parser("analyze", help="Analyze job studio passes")
    analyze_parser.add_argument("--job-id", required=True, help="Job UUID")
    
    # report command
    report_parser = subparsers.add_parser("report", help="Generate debug report for a job")
    report_parser.add_argument("--job-id", required=True, help="Job UUID")
    
    args = parser.parse_args()
    
    if args.command is None:
        parser.print_help()
        return 1
    
    commands = {
        "matting": cmd_matting,
        "chromakey": cmd_chromakey,
        "analyze": cmd_analyze,
        "report": cmd_report,
    }
    
    return commands[args.command](args)


if __name__ == "__main__":
    sys.exit(main())
